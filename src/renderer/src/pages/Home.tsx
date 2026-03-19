import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Play, RotateCcw, Info } from 'lucide-react'
import * as api from '@/services/api'
import MediaRow from '@/components/MediaRow'
import MovieCard from '@/components/MovieCard'
import PlayModal from '@/components/PlayModal'
import DynamicHero from '@/components/DynamicHero'
import AnimeToggle from '@/components/AnimeToggle'
import OnDemandToggle from '@/components/OnDemandToggle'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings, QUALITY_BITRATES } from '@/contexts/SettingsContext'
import type { UnifiedMedia, TrendingResponse, ProgressItem } from '@/types/media'

function mapContinueWatching(cw: ProgressItem[]): UnifiedMedia[] {
  const seen = new Set<string>()
  const items: UnifiedMedia[] = []
  for (const p of cw) {
    // For TV: use seriesId as dedup key (backend keys by series, but guard against stale episode entries)
    const dedup = (p.type === 'tv' && p.seriesId) ? p.seriesId : p.mediaId
    if (seen.has(dedup)) continue
    seen.add(dedup)
    items.push({
      id: (p.type === 'tv' && p.seriesId) ? p.seriesId : p.mediaId,
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
      resumeMediaId: p.resumeMediaId,
      episodeName: p.episodeName,
      seasonNumber: p.seasonNumber,
      episodeNumber: p.episodeNumber,
    })
  }
  return items
}

export default function Home() {
  const { isOpen, openPlayer } = usePlayer()
  const { discordRPC, directPlay, defaultQuality } = useSettings()
  const wasOpenRef = useRef(false)
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') || ''
  const animeOnly = searchParams.get('anime') === '1'
  const onDemandOnly = searchParams.get('ondemand') === '1'

  const [trending, setTrending] = useState<TrendingResponse | null>(null)
  const [continueWatching, setContinueWatching] = useState<UnifiedMedia[]>([])
  const [categories, setCategories] = useState<api.HomeCategories | null>(null)
  const [selected, setSelected] = useState<UnifiedMedia | null>(null)
  const [loading, setLoading] = useState(true)

  // Resume prompt overlay
  const [resumeItem, setResumeItem] = useState<UnifiedMedia | null>(null)
  const [resumeLoading, setResumeLoading] = useState(false)

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
    ])
      .then(async ([t, cw]) => {
        setTrending(t)
        // Prefer VALOR progress store; fall back to Jellyfin native resume if empty
        // (covers items watched from Jellyfin directly or other clients)
        let cwItems = mapContinueWatching(cw)
        if (cwItems.length === 0) {
          cwItems = await api.getJellyfinResume().catch(() => [])
        }
        setContinueWatching(cwItems)
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

  function formatTicks(ticks: number) {
    const s = Math.floor(ticks / 10_000_000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  // Click handler for Continue Watching items — shows resume prompt
  function handleCwClick(item: UnifiedMedia) {
    // Show resume overlay for items with progress OR "begin next episode" TV entries
    if ((item.positionTicks && item.positionTicks > 0) || (item.type === 'tv' && item.resumeMediaId)) {
      setResumeItem(item)
    } else {
      setSelected(item)
    }
  }

  async function handleResume(ticks: number) {
    if (!resumeItem) return
    // For TV without a resumeMediaId we can't determine which episode — go to Details
    if (resumeItem.type === 'tv' && !resumeItem.resumeMediaId) {
      setSelected(resumeItem)
      setResumeItem(null)
      return
    }
    setResumeLoading(true)
    try {
      // For TV: resumeMediaId points to the actual episode; id is the seriesId
      const playId = resumeItem.resumeMediaId || String(resumeItem.id)
      const job = await api.startPlayJob({
        itemId: playId,
        directPlay,
        maxBitrate: directPlay ? undefined : QUALITY_BITRATES[defaultQuality],
        startTimeTicks: ticks > 0 ? ticks : undefined,
      })
      // Prefer existing TMDB poster; otherwise look one up for Discord RPC
      let poster = resumeItem.posterUrl?.startsWith('https://image.tmdb.org') ? resumeItem.posterUrl : null
      if (!poster) {
        try {
          const lookup = await api.lookupJellyfinItem(String(resumeItem.resumeMediaId || resumeItem.id))
          if (lookup.posterUrl) poster = lookup.posterUrl
        } catch { /* best-effort */ }
      }
      job.posterUrl = poster
      job.seriesId = resumeItem.seriesId || undefined
      job.tmdbId = resumeItem.tmdbId
      openPlayer(job, ticks)
      setResumeItem(null)
    } catch (e) {
      console.error('[Home] Resume failed:', e)
      // Fallback to PlayModal on error
      setSelected(resumeItem)
      setResumeItem(null)
    } finally {
      setResumeLoading(false)
    }
  }

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
        <MediaRow title="Continue Watching" items={filterItems(continueWatching)} onPlay={handleCwClick} />
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

      {/* Resume prompt overlay for Continue Watching */}
      <AnimatePresence>
        {resumeItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            onClick={() => setResumeItem(null)}
            data-modal-close
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="w-72 bg-[#181818] rounded-xl border border-white/10 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Poster strip */}
              {resumeItem.posterUrl && (
                <div className="relative h-24 overflow-hidden">
                  <img src={resumeItem.backdropUrl || resumeItem.posterUrl} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#181818] to-transparent" />
                </div>
              )}
              <div className="px-4 pb-4 pt-2">
                <p className="text-sm font-semibold text-white truncate">{resumeItem.title}</p>
                {resumeItem.type === 'tv' && resumeItem.seasonNumber != null && resumeItem.episodeNumber != null && (
                  <p className="text-xs text-white/40 mt-0.5 truncate">
                    S{String(resumeItem.seasonNumber).padStart(2, '0')}E{String(resumeItem.episodeNumber).padStart(2, '0')}
                    {resumeItem.episodeName ? ` · ${resumeItem.episodeName}` : ''}
                  </p>
                )}
                <div className="flex flex-col gap-2 mt-3">
                  {(resumeItem.playedPercentage ?? 0) >= 5 ? (
                    <>
                      <button
                        data-focusable
                        onClick={() => handleResume(resumeItem.positionTicks!)}
                        disabled={resumeLoading}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-lg
                                   bg-white text-black font-semibold text-sm hover:bg-white/90 transition disabled:opacity-50"
                      >
                        {resumeLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="black" />}
                        Resume at {formatTicks(resumeItem.positionTicks!)}
                      </button>
                      <button
                        data-focusable
                        onClick={() => handleResume(0)}
                        disabled={resumeLoading}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-lg
                                   bg-white/10 text-white text-sm hover:bg-white/15 transition disabled:opacity-50"
                      >
                        <RotateCcw size={14} />
                        Start from Beginning
                      </button>
                    </>
                  ) : (
                    <button
                      data-focusable
                      onClick={() => handleResume(0)}
                      disabled={resumeLoading}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-lg
                                 bg-white text-black font-semibold text-sm hover:bg-white/90 transition disabled:opacity-50"
                    >
                      {resumeLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="black" />}
                      Begin Episode
                    </button>
                  )}
                  <button
                    data-focusable
                    onClick={() => { setSelected(resumeItem); setResumeItem(null) }}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-lg
                               bg-white/5 text-white/60 text-sm hover:bg-white/10 hover:text-white/80 transition"
                  >
                    <Info size={14} />
                    Details
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selected && (
          <PlayModal item={selected} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
