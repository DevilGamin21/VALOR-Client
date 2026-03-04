import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import * as api from '@/services/api'
import MediaRow from '@/components/MediaRow'
import MovieCard from '@/components/MovieCard'
import PlayModal from '@/components/PlayModal'
import DynamicHero from '@/components/DynamicHero'
import AnimeToggle from '@/components/AnimeToggle'
import OnDemandToggle from '@/components/OnDemandToggle'
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
    playedPercentage: p.percent,
    positionTicks: p.positionTicks,
    seriesId: p.seriesId,
  }))
}

export default function Home() {
  const { isOpen } = usePlayer()
  const { discordRPC } = useSettings()
  const wasOpenRef = useRef(false)
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') || ''
  const animeOnly = searchParams.get('anime') === '1'
  const onDemandOnly = searchParams.get('ondemand') === '1'

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

  // Check for updates every time the Home page mounts
  useEffect(() => {
    window.electronAPI.updates.check()
  }, [])

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

  // ── Filter helpers ───────────────────────────────────────────────────────
  const filterItems = (items: UnifiedMedia[]) => {
    let filtered = items
    if (animeOnly) filtered = filtered.filter((i) => i.isAnime)
    if (onDemandOnly) filtered = filtered.filter((i) => i.onDemand)
    return filtered
  }

  // ── Normal home view ──────────────────────────────────────────────────────
  return (
    <div className="pb-8">
      {!animeOnly && !onDemandOnly && <DynamicHero items={heroItems} onSelect={setSelected} />}

      <div className="px-6 pt-4 pb-2 flex items-center gap-3">
        <OnDemandToggle />
        <AnimeToggle />
      </div>

      {filterItems(continueWatching).length > 0 && (
        <MediaRow title="Continue Watching" items={filterItems(continueWatching)} onPlay={setSelected} />
      )}

      {filterItems(recentMovies).length > 0 && (
        <MediaRow
          title={animeOnly ? 'Anime Movies' : 'Recently Added Movies'}
          items={filterItems(recentMovies)}
          onPlay={setSelected}
        />
      )}

      {filterItems(recentTV).length > 0 && (
        <MediaRow
          title={animeOnly ? 'Anime Shows' : 'Recently Added TV'}
          items={filterItems(recentTV)}
          onPlay={setSelected}
        />
      )}

      {!animeOnly && !onDemandOnly && trending?.movies && trending.movies.length > 0 && (
        <MediaRow title="Trending Movies" items={trending.movies} onPlay={setSelected} />
      )}

      {!animeOnly && !onDemandOnly && trending?.tv && trending.tv.length > 0 && (
        <MediaRow title="Trending TV" items={trending.tv} onPlay={setSelected} />
      )}

      {!animeOnly && !onDemandOnly && categories?.topRatedMovies && categories.topRatedMovies.length > 0 && (
        <MediaRow title="Top Rated Movies" items={categories.topRatedMovies} onPlay={setSelected} />
      )}

      {!animeOnly && !onDemandOnly && categories?.actionMovies && categories.actionMovies.length > 0 && (
        <MediaRow title="Action Movies" items={categories.actionMovies} onPlay={setSelected} />
      )}

      {!animeOnly && !onDemandOnly && categories?.comedyMovies && categories.comedyMovies.length > 0 && (
        <MediaRow title="Comedy Movies" items={categories.comedyMovies} onPlay={setSelected} />
      )}

      {!animeOnly && !onDemandOnly && categories?.topRatedTv && categories.topRatedTv.length > 0 && (
        <MediaRow title="Top Rated TV" items={categories.topRatedTv} onPlay={setSelected} />
      )}

      {!animeOnly && !onDemandOnly && categories?.sciFiTv && categories.sciFiTv.length > 0 && (
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
