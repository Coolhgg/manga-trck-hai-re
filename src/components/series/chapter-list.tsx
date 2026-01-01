"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Check, Loader2, ExternalLink } from "lucide-react"
import { updateProgress } from "@/lib/actions/library"
import { toast } from "sonner"

interface Chapter {
  id: string
  chapter_number: number
  chapter_title: string | null
  chapter_url: string
  published_at: string | null
}

export function ChapterList({ 
  seriesId, 
  libraryEntry,
}: { 
  seriesId: string
  libraryEntry: any
}) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    async function fetchChapters() {
      try {
        const res = await fetch(`/api/series/${seriesId}/chapters`)
        if (res.ok) {
          const data = await res.json()
          setChapters(data.chapters || [])
        }
      } catch (error) {
        console.error("Failed to fetch chapters:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchChapters()
  }, [seriesId])

  const handleRead = async (chapterNumber: number, chapterId: string) => {
    if (!libraryEntry) {
      toast.error("Add to library first to track progress")
      return
    }
    
    setLoadingId(chapterId)
    try {
      const result = await updateProgress(libraryEntry.id, chapterNumber, seriesId)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(`Marked chapter ${chapterNumber} as read (+${result.xp_gained} XP)`)
      }
    } catch (error) {
      toast.error("Failed to update progress")
    } finally {
      setLoadingId(null)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Unknown"
    const date = new Date(dateString)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString()
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="animate-pulse flex items-center justify-between p-4 rounded-xl border border-zinc-100 dark:border-zinc-900">
            <div className="flex items-center gap-4">
              <div className="size-10 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
              <div className="space-y-2">
                <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
                <div className="h-3 w-16 bg-zinc-100 dark:bg-zinc-900 rounded" />
              </div>
            </div>
            <div className="h-8 w-24 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p>No chapters available yet</p>
      </div>
    )
  }

  const displayChapters = showAll ? chapters : chapters.slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2">
        {displayChapters.map((chapter) => {
          const chapterNum = Number(chapter.chapter_number)
          const isRead = libraryEntry?.last_read_chapter >= chapterNum

          return (
            <div 
              key={chapter.id} 
              className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                isRead 
                  ? 'bg-zinc-50 dark:bg-zinc-900/50 border-zinc-100 dark:border-zinc-800 opacity-60' 
                  : 'border-zinc-100 dark:border-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-900 group'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`size-10 rounded-lg flex items-center justify-center text-sm font-bold transition-colors ${
                  isRead 
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500' 
                    : 'bg-zinc-100 dark:bg-zinc-800 group-hover:bg-zinc-900 group-hover:text-zinc-50 dark:group-hover:bg-zinc-50 dark:group-hover:text-zinc-900'
                }`}>
                  {chapterNum}
                </div>
                <div>
                  <p className={`font-bold text-sm ${isRead ? 'text-zinc-500' : ''}`}>
                    Chapter {chapterNum}
                    {chapter.chapter_title && <span className="font-normal text-zinc-500 ml-2">- {chapter.chapter_title}</span>}
                  </p>
                  <p className="text-xs text-zinc-500">{formatDate(chapter.published_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a 
                  href={chapter.chapter_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="size-4" />
                </a>
                <Button 
                  variant={isRead ? "ghost" : "outline"} 
                  size="sm" 
                  className={`text-xs font-bold rounded-full ${isRead ? 'text-green-500' : 'border-zinc-200 dark:border-zinc-800'}`}
                  onClick={() => handleRead(chapterNum, chapter.id)}
                  disabled={loadingId === chapter.id}
                >
                  {loadingId === chapter.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isRead ? (
                    <Check className="size-3 mr-1" />
                  ) : null}
                  {isRead ? "READ" : "MARK READ"}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      
      {chapters.length > 10 && !showAll && (
        <Button 
          variant="outline" 
          className="w-full rounded-xl"
          onClick={() => setShowAll(true)}
        >
          Show all {chapters.length} chapters
        </Button>
      )}
    </div>
  )
}
