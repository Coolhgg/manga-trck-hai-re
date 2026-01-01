import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sanitizeInput, checkRateLimit, handleApiError, ApiError, validateOrigin, escapeILikePattern } from '@/lib/api-utils';
import { z } from 'zod';
import { getBestCoversBatch, selectBestCover } from '@/lib/cover-resolver';

const AddToLibrarySchema = z.object({
  seriesId: z.string().uuid('Invalid series ID format'),
  status: z.enum(['reading', 'completed', 'planning', 'dropped', 'paused']).default('reading'),
});

const LibraryQuerySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  sort: z.enum(['updated', 'title', 'rating', 'added']).default('updated'),
  limit: z.coerce.number().min(1).max(200).default(100),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * GET /api/library
 * Returns the user's library entries with filtering and sorting
 */
export async function GET(req: NextRequest) {
  try {
    // Rate limit: 60 requests per minute per IP
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`library-get:${ip}`, 60, 60000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment.' },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate query params
    const searchParams = Object.fromEntries(req.nextUrl.searchParams);
    const validatedParams = LibraryQuerySchema.safeParse(searchParams);
    
    if (!validatedParams.success) {
      return NextResponse.json({ error: validatedParams.error.errors[0].message }, { status: 400 });
    }

    const { q: query, status, sort: sortBy, limit, offset } = validatedParams.data;

    // Build Supabase query
      let supabaseQuery = supabaseAdmin
        .from('library_entries')
        .select(`
          id,
          status,
          last_read_chapter,
          user_rating,
          updated_at,
          added_at,
          series_id,
          series!inner (
            id,
            title,
            cover_url,
            type,
            status,
            content_rating
          )
        `, { count: 'exact' })
        .eq('user_id', user.id);
    
    // Filter by search query if provided
    if (query && query.length >= 2) {
      const sanitizedQuery = sanitizeInput(query, 100);
      const escapedQuery = escapeILikePattern(sanitizedQuery);
      supabaseQuery = supabaseQuery.ilike('series.title', `%${escapedQuery}%`);
    }

    // Filter by status
    if (status && status !== 'all') {
      const validStatuses = ['reading', 'completed', 'planning', 'dropped', 'paused'];
      if (validStatuses.includes(status)) {
        supabaseQuery = supabaseQuery.eq('status', status);
      }
    }

    // Sorting
    let sortColumn = 'updated_at';
    const ascending = false;

    switch (sortBy) {
      case 'title':
        sortColumn = 'series.title';
        break;
      case 'rating':
        sortColumn = 'user_rating';
        break;
      case 'added':
        sortColumn = 'added_at';
        break;
    }

    const { data: results, count, error } = await supabaseQuery
        .order(sortColumn, { ascending: sortBy === 'title' })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Resolve best covers from series_sources
      const seriesIds = (results || []).map((r: any) => r.series_id).filter(Boolean);
      const bestCovers = await getBestCoversBatch(seriesIds);
      
      const entriesWithBestCovers = (results || []).map((entry: any) => {
        const bestCover = bestCovers.get(entry.series_id);
        return {
          ...entry,
          series: entry.series ? {
            ...entry.series,
            cover_url: bestCover?.cover_url || entry.series.cover_url,
          } : null,
        };
      });

      return NextResponse.json({ 
        entries: entriesWithBestCovers,
        pagination: {
          total: count || 0,
          limit,
          offset,
          hasMore: offset + (results?.length || 0) < (count || 0)
        }
      });
  } catch (error: any) {
    console.error('Library fetch error:', error);
    return handleApiError(error);
  }
}

/**
 * POST /api/library
 * Adds a series to the user's library
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401);
    }

    // CSRF Protection
    validateOrigin(req);

    // Rate limit: 30 additions per minute
    if (!checkRateLimit(`library-add:${user.id}`, 30, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400);
    }
    
    const validatedBody = AddToLibrarySchema.safeParse(body);
    if (!validatedBody.success) {
      throw new ApiError(validatedBody.error.errors[0].message, 400);
    }

    const { seriesId, status } = validatedBody.data;

    // Check if series exists
    const { data: series, error: seriesError } = await supabaseAdmin
      .from('series')
      .select('id')
      .eq('id', seriesId)
      .single();

    if (seriesError || !series) {
      throw new ApiError('Series not found', 404);
    }

    // Create library entry
    const { data: entry, error: entryError } = await supabaseAdmin
      .from('library_entries')
      .insert({
        user_id: user.id,
        series_id: seriesId,
        status: status,
        last_read_chapter: 0,
      })
      .select()
      .single();

    if (entryError) {
      if (entryError.code === '23505') {
        return NextResponse.json({ error: 'Series already in library' }, { status: 409 });
      }
      throw entryError;
    }

    // Update follow count
    await supabaseAdmin.rpc('increment_series_follows', { s_id: seriesId });
    
    return NextResponse.json(entry, { status: 201 });

  } catch (error: any) {
    console.error('Library add error:', error);
    return handleApiError(error);
  }
}
