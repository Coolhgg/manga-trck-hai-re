import { supabaseAdmin } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, sanitizeInput, handleApiError, escapeILikePattern } from "@/lib/api-utils"
import { z } from "zod"
import { checkSourceQueue, isQueueHealthy } from "@/lib/queues"
import { areWorkersOnline, redis, waitForRedis, REDIS_KEY_PREFIX } from "@/lib/redis"
import { detectSearchIntent } from "@/lib/search-intent"
import { recordSearchEvent } from "@/lib/analytics"
import { getBestCoversBatch } from "@/lib/cover-resolver"

const SearchQuerySchema = z.object({
  q: z.string().optional(),
  type: z.enum(['manga', 'manhwa', 'manhua', 'webtoon', 'novel', 'light_novel']).optional(),
  status: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled']).optional(),
  genres: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  sort: z.enum(['relevance', 'rating', 'updated', 'views', 'title']).default('relevance'),
})

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  let query: string | null = null
  let intent = 'PARTIAL_TITLE'
  
  try {
    // Rate limit: 60 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
    if (!checkRateLimit(`search:${ip}`, 60, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      )
    }

    const searchParams = Object.fromEntries(request.nextUrl.searchParams)
    const validatedParams = SearchQuerySchema.safeParse(searchParams)

    if (!validatedParams.success) {
      return NextResponse.json(
        { error: validatedParams.error.errors[0].message },
        { status: 400 }
      )
    }

    const { q: rawQuery, type, status, genres: genresRaw, limit, offset, sort: sortBy } = validatedParams.data
    const genres = genresRaw?.split(',').filter(Boolean)

    // Sanitize and validate query
    query = rawQuery ? sanitizeInput(rawQuery, 200) : null

    // Validate minimum query length
    if (query && query.length < 2) {
      const response = { 
        results: [], 
        total: 0,
        message: 'Search query must be at least 2 characters' 
      }
      
      recordSearchEvent({
        normalized_query: query.toLowerCase().trim(),
        intent_type: 'INVALID',
        local_hit: false,
        external_attempted: false,
        results_count: 0,
        resolution_time_ms: Date.now() - startTime,
        status: 'invalid_query'
      })

      return NextResponse.json(response)
    }

    if (!query && !type && !status && (!genres || genres.length === 0)) {
      return NextResponse.json({ 
        results: [], 
        total: 0,
        message: 'No filters provided' 
      })
    }

    // Build Supabase query
    let supabaseQuery: any

    if (query) {
      supabaseQuery = supabaseAdmin.rpc('search_series_extended', { search_query: query }, { count: 'exact' })
    } else {
      supabaseQuery = supabaseAdmin
        .from('series')
        .select(`
          id,
          title,
          alternative_titles,
          description,
          cover_url,
          type,
          status,
          genres,
          content_rating,
          total_follows,
          total_views,
          average_rating,
          updated_at
        `, { count: 'exact' })
    }

    if (type) {
      supabaseQuery = supabaseQuery.eq('type', type)
    }

    if (status) {
      supabaseQuery = supabaseQuery.eq('status', status)
    }

    if (genres && genres.length > 0) {
      supabaseQuery = supabaseQuery.contains('genres', genres)
    }

    // Sorting
    let sortColumn = 'total_follows'
    let ascending = false

    switch (sortBy) {
      case 'rating':
        sortColumn = 'average_rating'
        break
      case 'updated':
        sortColumn = 'updated_at'
        break
      case 'views':
        sortColumn = 'total_views'
        break
      case 'title':
        sortColumn = 'title'
        ascending = true
        break
    }

    const { data: localResults, count, error } = await supabaseQuery
      .order(sortColumn, { ascending })
      .range(offset, offset + limit - 1)

      if (error) throw error

      // Resolve best covers from series_sources
      const seriesIds = (localResults || []).map((r: any) => r.id)
      const bestCovers = await getBestCoversBatch(seriesIds)
      
      const resultsWithBestCovers = (localResults || []).map((r: any) => {
        const bestCover = bestCovers.get(r.id)
        return {
          ...r,
          cover_url: bestCover?.cover_url || r.cover_url,
          cover_source: bestCover?.source_name || null,
          source: 'local',
        }
      })

      // Intent Detection
      intent = query ? detectSearchIntent(query, localResults || []) : 'PARTIAL_TITLE'
      
      if (query) {
        console.log(`[Search] Intent: ${intent} for "${query}" (Local: ${localResults?.length || 0})`)
      }

      // 1) NOISE / INVALID: Return early with UI-safe response
      if (intent === 'NOISE') {
        const response = {
          results: resultsWithBestCovers,
          total: count || 0,
          limit,
          offset,
          has_more: offset + (localResults?.length || 0) < (count || 0),
          message: query ? "Query too short or invalid" : undefined
        }

        recordSearchEvent({
          normalized_query: query ? query.toLowerCase().trim() : 'none',
          intent_type: intent,
          local_hit: (localResults?.length || 0) > 0,
          external_attempted: false,
          results_count: localResults?.length || 0,
          resolution_time_ms: Date.now() - startTime,
          status: 'noise'
        })

        return NextResponse.json(response)
      }

      // Phase-4 Asynchronous Flow
      // For first-page queries, attempt external resolution regardless of local results (unless NOISE)
      if (query && offset === 0) {
        // 1) Per-query cooldown: Prevent same IP from spamming same query within 30s
        const queryHash = Buffer.from(query.toLowerCase().trim()).toString('base64').slice(0, 32)
        const cooldownKey = `${REDIS_KEY_PREFIX}cooldown:search:${ip}:${queryHash}`
        
        await waitForRedis(2000)
        const isCoolingDown = await redis.get(cooldownKey)
        
        if (isCoolingDown) {
          console.log(`[Search] Cooldown active for "${query}" from ${ip}`)
          return NextResponse.json({
            status: "complete",
            results: resultsWithBestCovers,
            total: count || 0,
            limit,
            offset,
            has_more: offset + (localResults?.length || 0) < (count || 0),
            message: "Results are up to date."
          })
        }

        // 2) Backpressure & Worker Check
        const [workersOnline, queueHealthy] = await Promise.all([
          areWorkersOnline(),
          isQueueHealthy(checkSourceQueue, 5000)
        ])
        
        if (!workersOnline || !queueHealthy) {
          const reason = !workersOnline ? 'Workers offline' : 'Queue saturated'
          console.warn(`[Search] ${reason}. External search unavailable for "${query}".`)
          
          const response = {
            status: "resolving_unavailable",
            results: resultsWithBestCovers,
            total: count || 0,
            limit,
            offset,
            has_more: offset + (localResults?.length || 0) < (count || 0),
          message: "External search is temporarily unavailable due to high load. Try again later."
        }

        recordSearchEvent({
          normalized_query: query.toLowerCase().trim(),
          intent_type: intent,
          local_hit: (localResults?.length || 0) > 0,
          external_attempted: true,
          results_count: localResults?.length || 0,
          resolution_time_ms: Date.now() - startTime,
          status: 'resolving_unavailable'
        })

        return NextResponse.json(response)
      }

      // 3) Intent-based Throttling
      // KEYWORD_EXPLORATION → lower priority
      // NOISE → already blocked by early return
      const jobPriority = intent === 'KEYWORD_EXPLORATION' ? 5 : 1
      const jobId = `search_${queryHash}`
      
      try {
        await checkSourceQueue.add('check-source', {
          query,
          intent,
          trigger: 'user_search',
        }, {
          jobId,
          priority: jobPriority,
          removeOnComplete: true,
        })

        // Set cooldown after successful enqueue
        await redis.set(cooldownKey, "1", "EX", 30)

        console.log(`[Search] Job enqueued: ${jobId} (Priority: ${jobPriority})`)

        const status = "resolving"
        recordSearchEvent({
          normalized_query: query.toLowerCase().trim(),
          intent_type: intent,
          local_hit: (localResults?.length || 0) > 0,
          external_attempted: true,
          results_count: localResults?.length || 0,
          resolution_time_ms: Date.now() - startTime,
          status
        })

          return NextResponse.json({
            status,
            results: resultsWithBestCovers,
            total: count || 0,
            limit,
            offset,
            has_more: offset + (localResults?.length || 0) < (count || 0),
            query,
            message: "Searching external sources for more results..."
          })
        } catch (queueError: any) {
          console.error(`[Search] Queue error for "${query}":`, queueError.message)
          return NextResponse.json({
            status: "resolving_unavailable",
            results: resultsWithBestCovers,
            total: count || 0,
            limit,
            offset,
            has_more: offset + (localResults?.length || 0) < (count || 0),
            message: "External search is temporarily unavailable."
          })
        }
      }

      const resultsCount = localResults?.length || 0
      
      recordSearchEvent({
        normalized_query: query ? query.toLowerCase().trim() : (type || status || 'filters'),
        intent_type: intent,
        local_hit: resultsCount > 0,
        external_attempted: false,
        results_count: resultsCount,
        resolution_time_ms: Date.now() - startTime,
        status: 'complete'
      })

      // Non-first-page queries or filter-only queries return local results directly
      return NextResponse.json({
        results: resultsWithBestCovers,
        total: count || 0,
        limit,
        offset,
        has_more: offset + (localResults?.length || 0) < (count || 0)
      })

  } catch (error: any) {
    return handleApiError(error)
  }
}
