"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { Search, Star, Users, Loader2, Globe, AlertCircle, RefreshCcw, WifiOff, Info } from "lucide-react"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useDebounce } from "@/hooks/use-performance"
import { createClient } from "@/lib/supabase/client"
import { NSFWCover } from "@/components/ui/nsfw-cover"

interface Series {
  id: string
  title: string
  cover_url: string | null
  type: string
  status: string
  genres: string[]
  average_rating: number | null
  total_follows: number
  updated_at: string
  content_rating: string | null
}

function SeriesSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[3/4] rounded-2xl" />
          <div className="space-y-2 px-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SeriesCard({ series }: { series: Series }) {
  return (
    <div className="group space-y-3 relative">
      <Link href={`/series/${series.id}`} className="block relative">
        <div className="overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all group-hover:ring-2 group-hover:ring-zinc-900 dark:group-hover:ring-zinc-50 shadow-sm group-hover:shadow-md relative">
          <NSFWCover
            src={series.cover_url}
            alt={series.title}
            contentRating={series.content_rating}
            className="transition-transform duration-500 group-hover:scale-110"
            showBadge={true}
          />
          <Badge className="absolute top-2 right-2 capitalize text-[10px]" variant="secondary">
            {series.type}
          </Badge>
        </div>
      </Link>
      <div className="space-y-1 px-1">
        <h3 className="font-bold text-sm leading-tight truncate">{series.title}</h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-medium">
          <span className="flex items-center gap-1">
            <Star className="size-3 text-yellow-500 fill-yellow-500" /> {series.average_rating || "N/A"}
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3" /> {series.total_follows >= 1000 ? `${Math.round(series.total_follows / 1000)}K` : series.total_follows}
          </span>
        </div>
      </div>
    </div>
  )
}

const BrowsePageContent = () => {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Series[]>([])
  const [status, setStatus] = useState<"idle" | "loading" | "resolving" | "done" | "error" | "unavailable">("idle")
  const [error, setError] = useState<string | null>(null)
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null)
  
  const debouncedQuery = useDebounce(query, 500)
  const abortControllerRef = useRef<AbortController | null>(null)
  const supabase = useRef(createClient())

  const performSearch = useCallback(async (searchTerm: string) => {
    if (!searchTerm || searchTerm.length < 2) {
      setResults([])
      setStatus("idle")
      setError(null)
      setUnavailableMessage(null)
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    setStatus("loading")
    setError(null)

    try {
      const res = await fetch(`/api/series/search?q=${encodeURIComponent(searchTerm)}`, {
        signal: abortControllerRef.current.signal
      })
      const data = await res.json()

      if (data.status === "resolving") {
        setStatus("resolving")
        // BUG FIX: Now API returns local results with resolving status
        // Show them immediately while waiting for external results
        setResults(data.results || [])
        setUnavailableMessage(null)
      } else if (data.status === "resolving_unavailable") {
        // Workers are offline - show banner but allow local results
        setStatus("unavailable")
        setResults(data.results || [])
        setUnavailableMessage(data.message || "External search is temporarily unavailable.")
      } else if (!res.ok) {
        setStatus("error")
        setError(data.error || "Failed to search")
      } else {
        setResults(data.results || [])
        setStatus("done")
        setUnavailableMessage(null)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error("Search error:", err)
      setStatus("error")
      setError("An unexpected error occurred")
    }
  }, [])

  useEffect(() => {
    performSearch(debouncedQuery)
  }, [debouncedQuery, performSearch])

  // Real-time subscription for Phase-4 availability
  useEffect(() => {
    let timeoutId: NodeJS.Timeout

    const channel = supabase.current
      .channel('public:series')
      .on('broadcast', { event: 'series.available' }, (payload) => {
        if (status === "resolving" && debouncedQuery) {
          clearTimeout(timeoutId)
          performSearch(debouncedQuery)
        }
      })
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === 'CHANNEL_ERROR' || subscribeStatus === 'TIMED_OUT') {
          // Fallback to polling if realtime fails
          if (status === "resolving") {
            timeoutId = setTimeout(() => performSearch(debouncedQuery), 10000)
          }
        }
      })

    // Safety timeout fallback: if we are still resolving after 30s, try one last search
    if (status === "resolving") {
      timeoutId = setTimeout(() => {
        performSearch(debouncedQuery)
      }, 30000)
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      supabase.current.removeChannel(channel)
    }
  }, [debouncedQuery, status, performSearch])

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto pb-24">
      <div className="space-y-2">
        <h1 className="text-4xl font-extrabold tracking-tight">Browse</h1>
        <p className="text-zinc-500 text-lg">Exhaustive search. Find ANY manga, even if not in our database yet.</p>
      </div>

      <div className="max-w-2xl relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-zinc-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title..."
          className="h-14 pl-12 pr-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-lg"
          autoFocus
        />
        {status === "loading" && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <Loader2 className="size-5 animate-spin text-zinc-400" />
          </div>
        )}
      </div>

      {/* Workers Unavailable Banner - persistent informational banner */}
      {status === "unavailable" && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
          <WifiOff className="size-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1 flex-1">
            <p className="font-bold text-amber-900 dark:text-amber-100 text-sm">External Search Unavailable</p>
            <p className="text-amber-700 dark:text-amber-300 text-sm">
              {unavailableMessage || "External search is temporarily unavailable. Background workers are offline."}
            </p>
            <p className="text-amber-600 dark:text-amber-400 text-xs mt-2">
              Only showing results from our local database. Try again later for MangaDex results.
            </p>
          </div>
          <button 
            onClick={() => performSearch(debouncedQuery)}
            className="shrink-0 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Resolving Banner - shown when external search is in progress */}
      {status === "resolving" && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
          <div className="relative shrink-0">
            <Globe className="size-5 text-blue-500" />
            <div className="absolute -top-0.5 -right-0.5 size-2 bg-blue-500 rounded-full animate-ping" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-blue-900 dark:text-blue-100 text-sm">Searching external sources...</p>
            <p className="text-blue-700 dark:text-blue-300 text-xs">
              {results.length > 0 
                ? `Showing ${results.length} local result${results.length !== 1 ? 's' : ''} while fetching more from MangaDex.`
                : "Checking MangaDex for results. This will only take a moment."
              }
            </p>
          </div>
          <RefreshCcw className="size-4 text-blue-500 animate-spin shrink-0" />
        </div>
      )}

      {/* Full-page resolving state - only when NO local results */}
      {status === "resolving" && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 space-y-6 animate-in fade-in zoom-in duration-500">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full scale-150 animate-pulse" />
            <div className="relative size-20 rounded-3xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center border border-blue-100 dark:border-blue-900">
              <Globe className="size-10 text-blue-500 animate-bounce" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-bold">Searching external sources...</h3>
            <p className="text-zinc-500 max-w-sm mx-auto">
              We couldn&apos;t find this in our local database. We&apos;re now checking MangaDex and other sources. This will only take a moment.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-4 py-2 rounded-full border border-blue-100 dark:border-blue-900/50">
            <RefreshCcw className="size-3 animate-spin" />
            Waiting for results...
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center gap-3 p-6 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
          <AlertCircle className="size-6 text-red-500" />
          <div className="space-y-1">
            <p className="font-bold text-red-900 dark:text-red-100">Search Error</p>
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          </div>
          <button 
            onClick={() => performSearch(debouncedQuery)}
            className="ml-auto bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Show results for done, unavailable, OR resolving (with local results) status */}
      {(status === "done" || status === "unavailable" || (status === "resolving" && results.length > 0)) && results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {results.map((series) => (
            <SeriesCard key={series.id} series={series} />
          ))}
        </div>
      )}

      {/* No results - only show for done status, not unavailable or resolving */}
      {status === "done" && results.length === 0 && debouncedQuery && (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <div className="size-20 rounded-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-300">
            <Search className="size-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold">No series found</h3>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
              We searched our database and external sources but found nothing for &quot;{debouncedQuery}&quot;.
            </p>
          </div>
        </div>
      )}

      {/* No local results when workers are unavailable */}
      {status === "unavailable" && results.length === 0 && debouncedQuery && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="size-16 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
            <Info className="size-8 text-amber-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold">No local results for &quot;{debouncedQuery}&quot;</h3>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto text-sm">
              This series may exist on MangaDex but our background workers are currently offline. 
              Please try again later when external search is available.
            </p>
          </div>
        </div>
      )}

      {status === "loading" && results.length === 0 && <SeriesSkeleton />}
    </div>
  )
}

function BrowsePageSkeleton() {
  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto pb-24">
      <div className="space-y-2">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-96" />
      </div>
      <Skeleton className="h-14 max-w-2xl rounded-2xl" />
      <SeriesSkeleton />
    </div>
  )
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<BrowsePageSkeleton />}>
      <BrowsePageContent />
    </Suspense>
  )
}
