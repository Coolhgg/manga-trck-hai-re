import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Star, Users, Calendar, Share2, MoreHorizontal } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SeriesActions } from "@/components/series/series-actions"
import { ChapterList } from "@/components/series/chapter-list"
import { notFound } from "next/navigation"
import { selectBestCover } from "@/lib/cover-resolver"

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: series } = await supabase
    .from('series')
    .select('*, series_sources(*)')
    .eq('id', id)
    .single()

  if (!series) {
    notFound()
  }

  const bestCover = selectBestCover(series.series_sources || [])
  const coverUrl = bestCover?.cover_url || series.cover_url

  let libraryEntry = null
  if (user) {
    const { data } = await supabase
      .from('library_entries')
      .select('*')
      .eq('series_id', id)
      .eq('user_id', user.id)
      .single()
    libraryEntry = data
  }

  const { count: chapterCount } = await supabase
    .from('chapters')
    .select('*', { count: 'exact', head: true })
    .eq('series_id', id)

  const year = series.created_at ? new Date(series.created_at).getFullYear() : "N/A"

    return (
      <div className="flex flex-col min-h-full bg-white dark:bg-zinc-950">
        <div className="relative h-[250px] md:h-[350px] w-full">
          <div className="absolute inset-0 bg-gradient-to-t from-white via-white/50 to-transparent dark:from-zinc-950 dark:via-zinc-950/50 z-10" />
          {coverUrl && (
            <img 
              src={coverUrl} 
              className="w-full h-full object-cover blur-sm opacity-30 scale-110"
              alt=""
            />
          )}
          
          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-12 z-20 max-w-7xl mx-auto w-full flex flex-col md:flex-row items-end gap-8">
            <div className="hidden md:block w-[200px] shrink-0 aspect-[3/4] rounded-2xl overflow-hidden border-4 border-white dark:border-zinc-950 shadow-2xl shadow-zinc-500/20">
              {coverUrl && (
                <img src={coverUrl} className="w-full h-full object-cover" alt={series.title} />
              )}
          </div>
          <div className="flex-1 space-y-4 pb-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 capitalize">{series.type}</Badge>
              <Badge variant="secondary" className="bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 capitalize">{series.status}</Badge>
              {chapterCount && chapterCount > 0 && (
                <Badge variant="secondary" className="bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                  {chapterCount} Chapters
                </Badge>
              )}
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 leading-tight">
              {series.title}
            </h1>
            <div className="flex items-center gap-6 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1.5"><Star className="size-4 text-yellow-500 fill-yellow-500" /> {series.average_rating || "N/A"}</span>
              <span className="flex items-center gap-1.5"><Users className="size-4" /> {series.total_follows ? `${(series.total_follows / 1000).toFixed(1)}K` : "0"} Followers</span>
              <span className="flex items-center gap-1.5"><Calendar className="size-4" /> {year}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 pb-4">
            <SeriesActions seriesId={series.id} libraryEntry={libraryEntry} />
            <Button variant="outline" size="icon" className="rounded-full border-zinc-200 dark:border-zinc-800">
              <Share2 className="size-4" />
            </Button>
            <Button variant="outline" size="icon" className="rounded-full border-zinc-200 dark:border-zinc-800">
              <MoreHorizontal className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-12 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-12">
          <Tabs defaultValue="chapters" className="w-full">
            <TabsList className="bg-transparent border-b border-zinc-100 dark:border-zinc-900 w-full justify-start rounded-none h-auto p-0 gap-8">
              <TabsTrigger value="chapters" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 dark:data-[state=active]:border-zinc-50 px-0 pb-4 font-bold text-lg">Chapters</TabsTrigger>
              <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 dark:data-[state=active]:border-zinc-50 px-0 pb-4 font-bold text-lg">Details</TabsTrigger>
            </TabsList>
            
            <TabsContent value="chapters" className="pt-8 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Latest Chapters</h3>
                {series.series_sources?.[0] && (
                  <Badge variant="outline" className="border-zinc-200 dark:border-zinc-800 capitalize">
                    {series.series_sources[0].source_name}
                  </Badge>
                )}
              </div>
              
              <ChapterList 
                seriesId={series.id} 
                libraryEntry={libraryEntry} 
              />
            </TabsContent>

            <TabsContent value="details" className="pt-8 space-y-8">
              <div className="space-y-4">
                <h3 className="text-xl font-bold">Description</h3>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-2xl">
                  {series.description || "No description available."}
                </p>
              </div>
              {series.genres && series.genres.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">Genres</h3>
                  <div className="flex flex-wrap gap-2">
                    {series.genres.map((genre: string) => (
                      <Badge key={genre} variant="outline" className="border-zinc-200 dark:border-zinc-800">{genre}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {series.tags && series.tags.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {series.tags.map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="bg-zinc-100 dark:bg-zinc-800">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-8">
          {series.series_sources && series.series_sources.length > 0 && (
            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
              <h3 className="font-bold">Available Sources</h3>
              <div className="space-y-4">
                {series.series_sources.map((source: any) => (
                  <div key={source.id} className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-[10px] font-bold">
                        {source.source_name[0].toUpperCase()}
                      </div>
                      <span className="text-sm font-bold capitalize">{source.source_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-green-500">
                      <div className="size-1.5 rounded-full bg-green-500" />
                      {Math.round(Number(source.trust_score) * 10)}% Trust
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
            <h3 className="font-bold">Information</h3>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Type</span>
                <span className="font-bold capitalize">{series.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Status</span>
                <span className="font-bold capitalize">{series.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Chapters</span>
                <span className="font-bold">{chapterCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Views</span>
                <span className="font-bold">{series.total_views?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Rating</span>
                <span className="font-bold">{series.content_rating || "Not Rated"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
