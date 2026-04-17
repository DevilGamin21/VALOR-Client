import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Play, RotateCcw, Info } from 'lucide-react'
import * as api from '@/services/api'
import MediaRow from '@/components/MediaRow'
import MovieCard from '@/components/MovieCard'
import PlayModal from '@/components/PlayModal'
import DynamicHero from '@/components/DynamicHero'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings, QUALITY_BITRATES } from '@/contexts/SettingsContext'
import type { UnifiedMedia, TrendingResponse, ProgressItem, PlayJob } from '@/types/media'

function mapContinueWatching(cw: ProgressItem[]): UnifiedMedia[] {
  const seen = new Set<string>()
  const items: UnifiedMedia[] = []
  for (const p of cw) {
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
      source: 'tmdb' as const,
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

function Row({ title, items, onPlay, onRemove }: { title: string; items: UnifiedMedia[]; onPlay: (i: UnifiedMedia) => void; onRemove?: (i: UnifiedMedia) => void }) {
  return <MediaRow title={title} items={items} onPlay={onPlay} onRemove={onRemove} />
}

function Card({ item, onPlay }: { item: UnifiedMedia; onPlay: (i: UnifiedMedia) => void }) {
  return <MovieCard item={item} onPlay={onPlay} />
}

function Hero({ items, onSelect }: { items: UnifiedMedia[]; onSelect: (i: UnifiedMedia) => void }) {
  return <DynamicHero items={items} onSelect={onSelect} />
}

const RESUME_PHASE_LABELS: Record<string, string> = {
  starting: 'Starting…',
  resolving: 'Resolving…',
  checking_cache: 'Checking cache…',
  scraping: 'Searching torrents…',
  adding_to_rd: 'Adding to Real-Debrid…',
  downloading: 'Downloading…',
  unrestricting: 'Getting stream URL…',
  preparing: 'Preparing stream…',
  building: 'Building session…',
}

export default function Home() {
  const { isOpen, openPlayer } = usePlayer()
  const { discordRPC, directPlay, defaultQuality, playerEngine } = useSettings()
  const wasOpenRef = useRef(false)
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') || ''

  const [trending, setTrending] = useState<TrendingResponse | null>(null)
  const [continueWatching, setContinueWatching] = useState<UnifiedMedia[]>([])
  const [categories, setCategories] = useState<api.HomeCategories | null>(null)
  const [selected, setSelected] = useState<UnifiedMedia | null>(null)
  const [loading, setLoading] = useState(true)

  const [resumeItem, setResumeItem] = useState<UnifiedMedia | null>(null)
  const [resumeLoading, setResumeLoading] = useState(false)
  const [resumePhase, setResumePhase] = useState('')
  const [resumeMessage, setResumeMessage] = useState('')
  const [resumeStreamId, setResumeStreamId] = useState<string | null>(null)
  const resumeTicksRef = useRef(0)
  const [selectedResumeHint, setSelectedResumeHint] = useState<{ seasonNumber?: number | null; episodeNumber?: number | null; positionTicks?: number } | undefined>(undefined)

  const [searchResults, setSearchResults] = useState<UnifiedMedia[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  useEffect(() => {
    window.electronAPI.updates.check().catch(() => {})
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

  // Auto-refresh continue watching every 20s so progress from other
  // devices (Android, TV, Connect remote) shows up without a page reload.
  useEffect(() => {
    const id = setInterval(() => {
      api.getContinueWatching()
        .then(async (cw) => {
          let cwItems = mapContinueWatching(cw)
          if (cwItems.length === 0) {
            cwItems = await api.getJellyfinResume().catch(() => [])
          }
          setContinueWatching(cwItems)
        })
        .catch(() => {})
    }, 20_000)
    return () => clearInterval(id)
  }, [])

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

  async function handleCwRemove(item: UnifiedMedia) {
    try {
      // For TV, delete by seriesId to remove the whole series entry
      const deleteId = (item.type === 'tv' && item.seriesId) ? item.seriesId : String(item.id)
      await api.deleteUserProgress(deleteId)
      setContinueWatching((prev) => prev.filter((i) => i.id !== item.id))
    } catch (e) {
      console.error('[Home] Failed to remove from Continue Watching:', e)
    }
  }

  function handleCwClick(item: UnifiedMedia) {
    if ((item.positionTicks && item.positionTicks > 0) || (item.type === 'tv' && item.resumeMediaId)) {
      setResumeItem(item)
    } else {
      setSelected(item)
    }
  }

  // Phase polling for slow-path resume (on-demand stream via RD)
  useEffect(() => {
    if (!resumeStreamId || !resumeItem) return
    const interval = setInterval(async () => {
      try {
        const status = await api.getStreamStatus(resumeStreamId)
        setResumePhase(status.phase)
        setResumeMessage(status.message)
        if (status.phase === 'ready') {
          clearInterval(interval)
          const job: PlayJob = {
            itemId: status.itemId || status.jellyfinItemId || '',
            hlsUrl: status.hlsUrl || '',
            directStreamUrl: status.directStreamUrl,
            playSessionId: status.playSessionId || null,
            deviceId: status.deviceId,
            audioTracks: status.audioTracks || [],
            subtitleTracks: (status.subtitleTracks || []).map(t => ({
              ...t,
              vttUrl: t.vttUrl ?? (t as Record<string, unknown>).url as string | null ?? null,
            })),
            title: status.title || resumeItem.title,
            seriesName: status.seriesName,
            type: status.type || resumeItem.type,
            durationTicks: status.durationTicks,
            introStartSec: status.introStartSec,
            introEndSec: status.introEndSec,
            creditsStartSec: status.creditsStartSec,
            mpvOptions: status.mpvOptions,
          }
          job.posterUrl = resumeItem.posterUrl
          job.seriesId = resumeItem.seriesId || undefined
          job.tmdbId = resumeItem.tmdbId
          job.year = resumeItem.year
          job.seasonNumber = resumeItem.seasonNumber
          job.episodeNumber = resumeItem.episodeNumber
          job.episodeName = resumeItem.episodeName
          openPlayer(job, resumeTicksRef.current)
          setResumeItem(null)
          setResumeStreamId(null)
          setResumePhase('')
          setResumeMessage('')
          setResumeLoading(false)
        } else if (status.phase === 'error') {
          clearInterval(interval)
          setResumePhase('error')
          setResumeMessage(status.error || status.message || 'Stream failed')
          setResumeStreamId(null)
          setResumeLoading(false)
        }
      } catch {
        clearInterval(interval)
        setResumePhase('error')
        setResumeMessage('Lost connection')
        setResumeStreamId(null)
        setResumeLoading(false)
      }
    }, 1500)
    return () => clearInterval(interval)
  }, [resumeStreamId, resumeItem, openPlayer])

  async function handleResume(ticks: number) {
    if (!resumeItem) return
    if (resumeItem.type === 'tv' && !resumeItem.resumeMediaId) {
      setSelectedResumeHint({ seasonNumber: resumeItem.seasonNumber, episodeNumber: resumeItem.episodeNumber, positionTicks: resumeItem.positionTicks })
      setSelected(resumeItem)
      setResumeItem(null)
      return
    }
    setResumeLoading(true)
    setResumePhase('')
    setResumeMessage('')
    resumeTicksRef.current = ticks

    // Fast path: try Jellyfin play-job (instant if item still exists)
    try {
      const playId = resumeItem.resumeMediaId || String(resumeItem.id)
      // Only use directPlay for mpv — built-in player can't decode DTS/AC3/TrueHD
      const useDirect = directPlay && playerEngine === 'mpv'
      const job = await api.startPlayJob({
        itemId: playId,
        directPlay: useDirect,
        maxBitrate: useDirect ? undefined : QUALITY_BITRATES[defaultQuality],
        startTimeTicks: ticks > 0 ? ticks : undefined,
        tmdbId: resumeItem.tmdbId,
      })
      job.posterUrl = resumeItem.posterUrl
      job.seriesId = resumeItem.seriesId || undefined
      job.tmdbId = resumeItem.tmdbId
      job.year = resumeItem.year
      job.seasonNumber = resumeItem.seasonNumber
      job.episodeNumber = resumeItem.episodeNumber
      job.episodeName = resumeItem.episodeName
      openPlayer(job, ticks)
      setResumeItem(null)
      setResumeLoading(false)
      return
    } catch {
      // Fast path failed — item gone from Jellyfin
    }

    // Slow path: on-demand stream via RD (requires tmdbId)
    if (!resumeItem.tmdbId) {
      setSelectedResumeHint({ seasonNumber: resumeItem.seasonNumber, episodeNumber: resumeItem.episodeNumber, positionTicks: resumeItem.positionTicks })
      setSelected(resumeItem)
      setResumeItem(null)
      setResumeLoading(false)
      return
    }
    try {
      setResumePhase('starting')
      setResumeMessage('Starting…')
      const res = await api.startStream({
        tmdbId: resumeItem.tmdbId,
        type: resumeItem.type as 'movie' | 'tv',
        title: resumeItem.title,
        year: resumeItem.year ?? undefined,
        season: resumeItem.seasonNumber ?? undefined,
        episode: resumeItem.episodeNumber ?? undefined,
      })
      setResumeStreamId(res.streamId) // triggers polling effect
    } catch {
      setResumePhase('error')
      setResumeMessage('Failed to start stream')
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
          <h1 className="font-bold text-white text-xl">
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
              <Card key={`${item.id}-${item.type}`} item={item} onPlay={setSelected} />
            ))}
          </div>
        ) : (
          <p className="text-center text-white/30 py-16 text-sm">No results found</p>
        )}

        <AnimatePresence>
          {selected && (
            <PlayModal item={selected} onClose={() => { setSelected(null); setSelectedResumeHint(undefined) }} resumeHint={selectedResumeHint} />
          )}
        </AnimatePresence>
      </div>
    )
  }

  // ── Normal home view ──────────────────────────────────────────────────────
  return (
    <div className="pb-8">
      <Hero items={heroItems} onSelect={setSelected} />

      {continueWatching.length > 0 && (
        <Row title="Continue Watching" items={continueWatching} onPlay={handleCwClick} onRemove={handleCwRemove} />
      )}

      {trending?.movies && trending.movies.length > 0 && (
        <Row title="Trending Movies" items={trending.movies} onPlay={setSelected} />
      )}

      {trending?.tv && trending.tv.length > 0 && (
        <Row title="Trending TV" items={trending.tv} onPlay={setSelected} />
      )}

      {categories?.nowPlayingMovies && categories.nowPlayingMovies.length > 0 && (
        <Row title="Now Playing in Theaters" items={categories.nowPlayingMovies} onPlay={setSelected} />
      )}

      {categories?.topRatedMovies && categories.topRatedMovies.length > 0 && (
        <Row title="Top Rated Movies" items={categories.topRatedMovies} onPlay={setSelected} />
      )}

      {categories?.topRatedTv && categories.topRatedTv.length > 0 && (
        <Row title="Top Rated TV" items={categories.topRatedTv} onPlay={setSelected} />
      )}

      {categories?.actionMovies && categories.actionMovies.length > 0 && (
        <Row title="Action Movies" items={categories.actionMovies} onPlay={setSelected} />
      )}

      {categories?.dramaTv && categories.dramaTv.length > 0 && (
        <Row title="Drama TV" items={categories.dramaTv} onPlay={setSelected} />
      )}

      {categories?.comedyMovies && categories.comedyMovies.length > 0 && (
        <Row title="Comedy Movies" items={categories.comedyMovies} onPlay={setSelected} />
      )}

      {categories?.crimeTv && categories.crimeTv.length > 0 && (
        <Row title="Crime TV" items={categories.crimeTv} onPlay={setSelected} />
      )}

      {categories?.horrorMovies && categories.horrorMovies.length > 0 && (
        <Row title="Horror" items={categories.horrorMovies} onPlay={setSelected} />
      )}

      {categories?.sciFiTv && categories.sciFiTv.length > 0 && (
        <Row title="Sci-Fi & Fantasy" items={categories.sciFiTv} onPlay={setSelected} />
      )}

      {categories?.thrillerMovies && categories.thrillerMovies.length > 0 && (
        <Row title="Thriller" items={categories.thrillerMovies} onPlay={setSelected} />
      )}

      {categories?.actionAdventureTv && categories.actionAdventureTv.length > 0 && (
        <Row title="Action & Adventure TV" items={categories.actionAdventureTv} onPlay={setSelected} />
      )}

      {categories?.romanceMovies && categories.romanceMovies.length > 0 && (
        <Row title="Romance" items={categories.romanceMovies} onPlay={setSelected} />
      )}

      {categories?.mysteryTv && categories.mysteryTv.length > 0 && (
        <Row title="Mystery TV" items={categories.mysteryTv} onPlay={setSelected} />
      )}

      {categories?.animationMovies && categories.animationMovies.length > 0 && (
        <Row title="Animation" items={categories.animationMovies} onPlay={setSelected} />
      )}

      {categories?.documentaryMovies && categories.documentaryMovies.length > 0 && (
        <Row title="Documentaries" items={categories.documentaryMovies} onPlay={setSelected} />
      )}

      {categories?.upcomingMovies && categories.upcomingMovies.length > 0 && (
        <Row title="Upcoming Movies" items={categories.upcomingMovies} onPlay={setSelected} />
      )}

      {/* Resume prompt overlay */}
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
              className="bg-[#181818] rounded-xl border border-white/10 shadow-2xl overflow-hidden w-72"
              onClick={(e) => e.stopPropagation()}
            >
              {resumeItem.posterUrl && (
                <div className="relative overflow-hidden h-24">
                  <img src={resumeItem.backdropUrl || resumeItem.posterUrl} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#181818] to-transparent" />
                </div>
              )}
              <div className="px-4 pb-4 pt-2">
                <p className="font-semibold text-white truncate text-sm">{resumeItem.title}</p>
                {resumeItem.type === 'tv' && resumeItem.seasonNumber != null && resumeItem.episodeNumber != null && (
                  <p className="text-white/40 mt-0.5 truncate text-xs">
                    S{String(resumeItem.seasonNumber).padStart(2, '0')}E{String(resumeItem.episodeNumber).padStart(2, '0')}
                    {resumeItem.episodeName ? ` · ${resumeItem.episodeName}` : ''}
                  </p>
                )}
                <div className="flex flex-col gap-2 mt-3">
                  {/* Phase status during on-demand stream resolution */}
                  {resumePhase && resumePhase !== 'error' && (
                    <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-white/5">
                      <Loader2 size={14} className="text-red-500 animate-spin flex-shrink-0" />
                      <span className="text-xs text-white/70 truncate">
                        {RESUME_PHASE_LABELS[resumePhase] || resumeMessage || 'Loading…'}
                      </span>
                    </div>
                  )}
                  {resumePhase === 'error' && (
                    <div className="py-2 px-3 rounded-lg bg-red-500/10">
                      <p className="text-xs text-red-400">{resumeMessage || 'Stream failed'}</p>
                    </div>
                  )}
                  {!resumePhase && (
                    <>
                      {(resumeItem.playedPercentage ?? 0) >= 5 ? (
                        <>
                          <button
                            data-focusable
                            onClick={() => handleResume(resumeItem.positionTicks!)}
                            disabled={resumeLoading}
                            className="flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:opacity-50 py-2.5 bg-white text-black text-sm hover:bg-white/90"
                          >
                            {resumeLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="black" />}
                            Resume at {formatTicks(resumeItem.positionTicks!)}
                          </button>
                          <button
                            data-focusable
                            onClick={() => handleResume(0)}
                            disabled={resumeLoading}
                            className="flex items-center justify-center gap-2 rounded-lg transition disabled:opacity-50 py-2.5 bg-white/10 text-white text-sm hover:bg-white/15"
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
                          className="flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:opacity-50 py-2.5 bg-white text-black text-sm hover:bg-white/90"
                        >
                          {resumeLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="black" />}
                          Begin Episode
                        </button>
                      )}
                    </>
                  )}
                  <button
                    data-focusable
                    onClick={() => { setSelectedResumeHint({ seasonNumber: resumeItem.seasonNumber, episodeNumber: resumeItem.episodeNumber, positionTicks: resumeItem.positionTicks }); setSelected(resumeItem); setResumeItem(null) }}
                    className="flex items-center justify-center gap-2 rounded-lg transition py-2.5 bg-white/5 text-white/60 text-sm hover:bg-white/10 hover:text-white/80"
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
          <PlayModal item={selected} onClose={() => { setSelected(null); setSelectedResumeHint(undefined) }} resumeHint={selectedResumeHint} />
        )}
      </AnimatePresence>
    </div>
  )
}
