import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import * as api from '@/services/api'
import MediaRow from '@/components/MediaRow'
import MovieCard from '@/components/MovieCard'
import PlayModal from '@/components/PlayModal'
import DynamicHero from '@/components/DynamicHero'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'
import type { UnifiedMedia, TrendingResponse, ProgressItem } from '@/types/media'

function mapContinueWatching(cw: ProgressItem[]): UnifiedMedia[] {
  return cw.map((p) => ({
    id: p.mediaId,
    title: p.title,
    type: p.type as 'movie' | 'tv',
    posterUrl: p.posterUrl,
    backdropUrl: null,
    overview: '',
    year: p.year,
    tmdbId: p.tmdbId,
    onDemand: true,
    source: 'jellyfin' as const,
    playedPercentage: p.percent
  }))
}

export default function Home() {
  const { isOpen } = usePlayer()
  const { discordRPC } = useSettings()
  const wasOpenRef = useRef(false)
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') || ''

  const [trending, setTrending] = useState<TrendingResponse | null>(null)
  const [continueWatching, setContinueWatching] = useState<UnifiedMedia[]>([])
  const [recentMovies, setRecentMovies] = useState<UnifiedMedia[]>([])
  const [recentTV, setRecentTV] = useState<UnifiedMedia[]>([])
  const [categories, setCategories] = useState<api.HomeCategories | null>(null)
  const [selected, setSelected] = useState<UnifiedMedia | null>(null)
  const [loading, setLoading] = useState(true)

  // Search
  const [searchResults, setSearchResults] = useState<UnifiedMedia[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  useEffect(() => {
    if (isOpen || !discordRPC) return
    window.electronAPI.discord.setActivity({
      details: 'VALOR',
      state: 'Browsing for content',
      largeImageKey: 'logo',
      largeImageText: 'VALOR',
    }).catch(() => {})
  }, [isOpen, discordRPC])

  useEffect(() => {
    Promise.all([
      api.getTrending(),
      api.getContinueWatching(),
      api.getJellyfinLatest(60),
    ])
      .then(async ([t, cw, latest]) => {
        setTrending(t)
        // Prefer VALOR progress store; fall back to Jellyfin native resume if empty
        // (covers items watched from Jellyfin directly or other clients)
        let cwItems = mapContinueWatching(cw)
        if (cwItems.length === 0) {
          cwItems = await api.getJellyfinResume().catch(() => [])
        }
        setContinueWatching(cwItems)
        setRecentMovies(latest.filter((i) => i.type === 'movie'))
        setRecentTV(latest.filter((i) => i.type === 'tv'))
      })
      .catch(console.error)
      .finally(() => setLoading(false))

    api.getHomeCategories().then(setCategories).catch(() => {})
  }, [])

  // Refresh continue watching when the player closes (isOpen: true → false)
  // Small delay lets the stop-progress report reach the server before we re-fetch.
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      const tid = setTimeout(() => {
        api.getContinueWatching()
          .then(async (cw) => {
            let cwItems = mapContinueWatching(cw)
            if (cwItems.length === 0) {
              cwItems = await api.getJellyfinResume().catch(() => [])
            }
            setContinueWatching(cwItems)
          })
          .catch(() => {})
      }, 600)
      wasOpenRef.current = isOpen
      return () => clearTimeout(tid)
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  // Search when query param changes
  useEffect(() => {
    if (!query) {
      setSearchResults([])
      return
    }
    setSearchLoading(true)
    api.searchItems(query)
      .then(setSearchResults)
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false))
  }, [query])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-red-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  const heroItems = [
    ...(trending?.movies ?? []),
    ...(trending?.tv ?? []),
  ].filter((i) => i.backdropUrl)

  // ── Search results view ────────────────────────────────────────────────────
  if (query) {
    return (
      <div className="pb-8">
        <div className="px-6 pt-6 pb-4">
          <h1 className="text-xl font-bold text-white">
            Results for &ldquo;{query}&rdquo;
          </h1>
        </div>

        {searchLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={24} className="animate-spin text-white/30" />
          </div>
        ) : searchResults.length > 0 ? (
          <div className="px-6 grid grid-cols-[repeat(auto-fill,minmax(144px,1fr))] gap-4">
            {searchResults.map((item) => (
              <MovieCard key={`${item.id}-${item.type}`} item={item} onPlay={setSelected} />
            ))}
          </div>
        ) : (
          <p className="text-center text-white/30 text-sm py-16">No results found</p>
        )}

        <AnimatePresence>
          {selected && (
            <PlayModal item={selected} onClose={() => setSelected(null)} />
          )}
        </AnimatePresence>
      </div>
    )
  }

  // ── Normal home view ──────────────────────────────────────────────────────
  return (
    <div className="pb-8">
      <DynamicHero items={heroItems} onSelect={setSelected} />

      {continueWatching.length > 0 && (
        <MediaRow title="Continue Watching" items={continueWatching} onPlay={setSelected} />
      )}

      {recentMovies.length > 0 && (
        <MediaRow title="Recently Added Movies" items={recentMovies} onPlay={setSelected} />
      )}

      {recentTV.length > 0 && (
        <MediaRow title="Recently Added TV" items={recentTV} onPlay={setSelected} />
      )}

      {trending?.movies && trending.movies.length > 0 && (
        <MediaRow title="Trending Movies" items={trending.movies} onPlay={setSelected} />
      )}

      {trending?.tv && trending.tv.length > 0 && (
        <MediaRow title="Trending TV" items={trending.tv} onPlay={setSelected} />
      )}

      {categories?.topRatedMovies && categories.topRatedMovies.length > 0 && (
        <MediaRow title="Top Rated Movies" items={categories.topRatedMovies} onPlay={setSelected} />
      )}

      {categories?.actionMovies && categories.actionMovies.length > 0 && (
        <MediaRow title="Action Movies" items={categories.actionMovies} onPlay={setSelected} />
      )}

      {categories?.comedyMovies && categories.comedyMovies.length > 0 && (
        <MediaRow title="Comedy Movies" items={categories.comedyMovies} onPlay={setSelected} />
      )}

      {categories?.topRatedTv && categories.topRatedTv.length > 0 && (
        <MediaRow title="Top Rated TV" items={categories.topRatedTv} onPlay={setSelected} />
      )}

      {categories?.sciFiTv && categories.sciFiTv.length > 0 && (
        <MediaRow title="Sci-Fi & Fantasy" items={categories.sciFiTv} onPlay={setSelected} />
      )}

      <AnimatePresence>
        {selected && (
          <PlayModal item={selected} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
