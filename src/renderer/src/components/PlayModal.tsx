import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Play, Plus, Check, Loader2, Lock, Wifi, MoreHorizontal, Eye, EyeOff, Star } from 'lucide-react'
import * as api from '@/services/api'
import { usePlayer } from '@/contexts/PlayerContext'
import { useWatchlist } from '@/contexts/WatchlistContext'
import { useAuth } from '@/contexts/AuthContext'
import type { UnifiedMedia, PlayJob, Season, Episode, P2PStatus, EpisodeInfo } from '@/types/media'

interface MergedEpisode {
  id: string
  title: string
  episodeNumber: number
  seasonNumber: number
  jellyfinId?: string
  playedPercentage?: number
  airDate: string | null
}

interface DisplaySeason {
  seasonNumber: number
  title: string
  key: string
  episodeCount: number
}

interface Props {
  item: UnifiedMedia
  onClose: () => void
}

// Phase display labels for the on-demand stream resolution progress
const PHASE_LABELS: Record<string, string> = {
  starting: 'Starting…',
  resolving: 'Resolving identifiers…',
  checking_cache: 'Checking Real-Debrid cache…',
  scraping: 'Searching for torrents…',
  adding_to_rd: 'Adding to Real-Debrid…',
  downloading: 'Downloading…',
  unrestricting: 'Getting stream URL…',
  preparing: 'Preparing stream…',
  building: 'Building play session…',
}

export default function PlayModal({ item, onClose }: Props) {
  const { openPlayer } = usePlayer()
  const { ids, toggle } = useWatchlist()
  const { user } = useAuth()
  const isPremium = user?.isPremium || user?.role === 'admin'
  const inWatchlist = ids.has(item.id)

  const [tmdbSeasons, setTmdbSeasons] = useState<api.TmdbSeason[]>([])
  const [jellyfinSeasons, setJellyfinSeasons] = useState<Season[]>([])
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [episodes, setEpisodes] = useState<MergedEpisode[]>([])
  const [loadingSeasons, setLoadingSeasons] = useState(false)
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)
  const [loadingPlay, setLoadingPlay] = useState(false)
  const [error, setError] = useState('')

  // Movie watched state
  const [movieWatched, setMovieWatched] = useState((item.playedPercentage ?? 0) >= 90)

  // Resume prompt (movies)
  const [resumeTicks, setResumeTicks] = useState<number | null>(null)
  const [showResume, setShowResume] = useState(false)

  // Resume prompt (TV episodes)
  const [resumeEp, setResumeEp] = useState<{ episodeNumber: number; seasonNumber: number; ticks: number; jellyfinId?: string } | null>(null)

  // On-demand stream resolution
  const [streamId, setStreamId] = useState<string | null>(null)
  const [streamPhase, setStreamPhase] = useState('')
  const [streamMessage, setStreamMessage] = useState('')
  const pendingResumeRef = useRef(0)
  const pendingEpisodesRef = useRef<EpisodeInfo[]>([])
  const pendingEpIdRef = useRef<string | undefined>(undefined)

  // Episode context menu
  const [activeMenu, setActiveMenu] = useState<{ epId: string; top: number; right: number } | null>(null)

  // Digital release check
  const [digitalRelease, setDigitalRelease] = useState<{ isReleased: boolean; releaseDate?: string } | null>(null)
  const [digitalReleaseLoading, setDigitalReleaseLoading] = useState(false)

  // P2P
  const [p2pLoading, setP2pLoading] = useState(false)
  const [p2pStatus, setP2pStatus] = useState<P2PStatus | null>(null)
  const [p2pHash, setP2pHash] = useState<string | null>(null)

  // Resolved Jellyfin series ID
  const [resolvedSeriesId, setResolvedSeriesId] = useState<string | null>(null)
  const [tmdbPosterUrl, setTmdbPosterUrl] = useState<string | null>(null)

  // ── Check for resume position (movie only) ──────────────────────────────
  useEffect(() => {
    if (item.type === 'tv') return
    if (!item.tmdbId) return
    // If the item carries positionTicks (from Continue Watching), show resume prompt
    if (item.positionTicks && item.positionTicks > 0) {
      setResumeTicks(item.positionTicks)
      setShowResume(true)
    } else if (item.onDemand) {
      // Check Jellyfin for saved progress (only possible if item has a Jellyfin ID)
      api.getItemProgress(String(item.id)).then((progress) => {
        if (progress && progress.percent >= 5 && progress.percent < 90) {
          setResumeTicks(progress.positionTicks)
          setShowResume(true)
        }
      }).catch(() => {})
    }
    // Fetch TMDB poster for Discord Rich Presence (only if item came from Jellyfin)
    if (item.onDemand) {
      api.lookupJellyfinItem(String(item.id)).then((lookup) => {
        if (lookup.posterUrl) setTmdbPosterUrl(lookup.posterUrl)
      }).catch(() => {})
    } else if (item.posterUrl?.startsWith('https://image.tmdb.org')) {
      // TMDB-sourced items already have a public poster URL
      setTmdbPosterUrl(item.posterUrl)
    }
  }, [item])

  // ── Digital release check (movies only — TV checked per-episode via airDate) ─
  useEffect(() => {
    if (item.type !== 'movie' || !item.tmdbId) return
    // Items from Jellyfin library (source === 'jellyfin') are always playable
    if (item.source === 'jellyfin') { setDigitalRelease({ isReleased: true }); return }
    setDigitalReleaseLoading(true)
    api.checkDigitalRelease(item.tmdbId, 'movie')
      .then(setDigitalRelease)
      .catch(() => setDigitalRelease({ isReleased: true })) // fail-open
      .finally(() => setDigitalReleaseLoading(false))
  }, [item])

  // ── Load seasons for all TV shows ────────────────────────────────────────
  useEffect(() => {
    if (item.type !== 'tv') return
    setLoadingSeasons(true)
    setTmdbSeasons([])
    setJellyfinSeasons([])
    setSelectedSeason(null)
    setEpisodes([])
    setResolvedSeriesId(null)
    setTmdbPosterUrl(null)

    async function loadSeasons() {
      let seriesJfId = item.seriesId || String(item.id)
      let tmdbId = item.tmdbId

      // If item came from Jellyfin (Continue Watching), resolve the series-level info
      if (item.onDemand) {
        try {
          const lookup = await api.lookupJellyfinItem(String(item.id))
          if (lookup.seriesId) seriesJfId = lookup.seriesId
          if (lookup.tmdbId) tmdbId = lookup.tmdbId
          if (lookup.posterUrl) setTmdbPosterUrl(lookup.posterUrl)
        } catch {
          // best-effort
        }
      } else if (item.posterUrl?.startsWith('https://image.tmdb.org')) {
        setTmdbPosterUrl(item.posterUrl)
      }
      setResolvedSeriesId(seriesJfId)

      const [tmdb, jf] = await Promise.all([
        tmdbId
          ? api.getTmdbSeasons(tmdbId).catch(() => [] as api.TmdbSeason[])
          : Promise.resolve([] as api.TmdbSeason[]),
        // Fetch Jellyfin seasons for progress data (best-effort, won't exist for fresh TMDB items)
        item.onDemand
          ? api.getSeasons(seriesJfId).catch(() => [] as Season[])
          : Promise.resolve([] as Season[]),
      ])

      setTmdbSeasons(tmdb)
      setJellyfinSeasons(jf)

      const firstSeason =
        tmdb.length > 0 ? tmdb[0].seasonNumber :
        jf.length > 0 ? jf[0].seasonNumber :
        null
      setSelectedSeason(firstSeason)
    }

    loadSeasons().finally(() => setLoadingSeasons(false))
  }, [item])

  // ── Load episodes when season changes ─────────────────────────────────────
  useEffect(() => {
    if (item.type !== 'tv' || selectedSeason === null) return

    setLoadingEpisodes(true)
    setEpisodes([])
    setResumeEp(null)

    async function load() {
      const [tmdbEps, jfEps] = await Promise.all([
        item.tmdbId
          ? api.getTmdbEpisodes(item.tmdbId!, selectedSeason!).catch(() => [] as api.TmdbEpisode[])
          : Promise.resolve([] as api.TmdbEpisode[]),
        // Fetch Jellyfin episodes for progress data (best-effort)
        (() => {
          if (!jellyfinSeasons.length) return Promise.resolve([] as Episode[])
          const jSeason = jellyfinSeasons.find((s) => s.seasonNumber === selectedSeason)
          if (!jSeason) return Promise.resolve([] as Episode[])
          const epSeriesId = resolvedSeriesId || item.seriesId || String(item.id)
          return api.getEpisodes(epSeriesId, jSeason.id).catch(() => [] as Episode[])
        })(),
      ])

      if (tmdbEps.length > 0) {
        const jMap = new Map(jfEps.map((ep) => [ep.episodeNumber, ep.id]))
        const jProgressMap = new Map(jfEps.map((ep) => [ep.episodeNumber, ep.playedPercentage]))
        return tmdbEps.map((ep): MergedEpisode => ({
          id: ep.id,
          title: ep.title,
          episodeNumber: ep.episodeNumber,
          seasonNumber: ep.seasonNumber,
          jellyfinId: jMap.get(ep.episodeNumber),
          playedPercentage: jProgressMap.get(ep.episodeNumber),
          airDate: ep.airDate,
        }))
      }

      return jfEps.map((ep): MergedEpisode => ({
        id: ep.id,
        title: ep.name,
        episodeNumber: ep.episodeNumber,
        seasonNumber: ep.seasonNumber,
        jellyfinId: ep.id,
        playedPercentage: ep.playedPercentage,
        airDate: null,
      }))
    }

    load()
      .then(setEpisodes)
      .catch(() => setEpisodes([]))
      .finally(() => setLoadingEpisodes(false))
  }, [item, selectedSeason, jellyfinSeasons, resolvedSeriesId])

  // ── On-demand stream polling ──────────────────────────────────────────────
  useEffect(() => {
    if (!streamId) return
    const interval = setInterval(async () => {
      try {
        const status = await api.getStreamStatus(streamId)
        setStreamPhase(status.phase)
        setStreamMessage(status.message)

        if (status.phase === 'ready') {
          clearInterval(interval)
          const job: PlayJob = {
            itemId: status.itemId || status.jellyfinItemId || '',
            hlsUrl: status.hlsUrl || '',
            playSessionId: status.playSessionId || null,
            deviceId: status.deviceId,
            audioTracks: status.audioTracks || [],
            subtitleTracks: (status.subtitleTracks || []).map(t => ({
              ...t,
              vttUrl: t.vttUrl ?? (t as Record<string, unknown>).url as string | null ?? null,
            })),
            title: status.title || item.title,
            seriesName: status.seriesName,
            type: status.type || item.type,
            durationTicks: status.durationTicks,
            introStartSec: status.introStartSec,
            introEndSec: status.introEndSec,
            creditsStartSec: status.creditsStartSec,
          }
          job.posterUrl = tmdbPosterUrl
            || (item.posterUrl?.startsWith('https://image.tmdb.org') ? item.posterUrl : null)
          job.seriesId = resolvedSeriesId || item.seriesId || undefined
          job.tmdbId = item.tmdbId

          openPlayer(job, pendingResumeRef.current, pendingEpisodesRef.current, pendingEpIdRef.current)
          onClose()
        } else if (status.phase === 'error') {
          clearInterval(interval)
          setError(status.error || status.message || 'Stream resolution failed')
          setStreamId(null)
          setStreamPhase('')
          setStreamMessage('')
          setLoadingPlay(false)
        }
      } catch {
        clearInterval(interval)
        setError('Lost connection to stream')
        setStreamId(null)
        setStreamPhase('')
        setStreamMessage('')
        setLoadingPlay(false)
      }
    }, 1500)
    return () => clearInterval(interval)
  }, [streamId, openPlayer, onClose, item, tmdbPosterUrl, resolvedSeriesId])

  // ── P2P polling ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!p2pHash) return
    const interval = setInterval(async () => {
      try {
        const status = await api.getP2PStatus(p2pHash)
        setP2pStatus(status)
        if (status.ready && status.jellyfinItemId) {
          clearInterval(interval)
          const job = await api.startPlayJob({
            itemId: status.jellyfinItemId,
          })
          openPlayer(job)
          onClose()
        }
      } catch {
        clearInterval(interval)
      }
    }, 1500)
    return () => clearInterval(interval)
  }, [p2pHash, openPlayer, onClose])

  // ── Actions ──────────────────────────────────────────────────────────────

  async function play(startTicks = 0) {
    if (!item.tmdbId) {
      setError('Cannot play — missing TMDB ID')
      return
    }
    if (item.type === 'movie' && item.source !== 'jellyfin' && digitalRelease?.isReleased !== true) return
    setLoadingPlay(true)
    setError('')
    pendingResumeRef.current = startTicks
    pendingEpisodesRef.current = []
    pendingEpIdRef.current = undefined
    try {
      const res = await api.startStream({
        tmdbId: item.tmdbId,
        type: item.type,
        title: item.title,
        year: item.year ?? undefined,
        isAnime: item.isAnime,
      })
      setStreamId(res.streamId)
      setStreamPhase('starting')
      setStreamMessage('Starting…')
    } catch (e) {
      setError((e as Error).message)
      setLoadingPlay(false)
    }
  }

  async function playEpisode(ep: MergedEpisode, startTicks = 0) {
    if (!item.tmdbId) {
      setError('Cannot play — missing TMDB ID')
      return
    }
    setLoadingPlay(true)
    setError('')
    pendingResumeRef.current = startTicks
    // Build episode list for player navigation (only episodes with jellyfinId)
    pendingEpisodesRef.current = episodes
      .filter((e) => e.jellyfinId)
      .map((e) => ({
        jellyfinId: e.jellyfinId!,
        title: e.title,
        episodeNumber: e.episodeNumber,
        seasonNumber: e.seasonNumber,
        playedPercentage: e.playedPercentage,
      }))
    pendingEpIdRef.current = ep.jellyfinId
    try {
      const res = await api.startStream({
        tmdbId: item.tmdbId,
        type: 'tv',
        title: item.title,
        year: item.year ?? undefined,
        season: ep.seasonNumber,
        episode: ep.episodeNumber,
        isAnime: item.isAnime,
      })
      setStreamId(res.streamId)
      setStreamPhase('starting')
      setStreamMessage('Starting…')
    } catch (e) {
      setError((e as Error).message)
      setLoadingPlay(false)
    }
  }

  async function handleEpisodePlay(ep: MergedEpisode) {
    // Check for resume position if we have a jellyfinId
    if (ep.jellyfinId) {
      const pct = ep.playedPercentage ?? 0
      if (pct >= 5 && pct < 90) {
        const progress = await api.getItemProgress(ep.jellyfinId).catch(() => null)
        if (progress) {
          setResumeEp({
            episodeNumber: ep.episodeNumber,
            seasonNumber: ep.seasonNumber,
            ticks: progress.positionTicks,
            jellyfinId: ep.jellyfinId,
          })
          return
        }
      }
    }
    playEpisode(ep)
  }

  async function handleMovieMarkWatched() {
    if (!item.onDemand) return
    try {
      if (movieWatched) {
        await api.markItemUnplayed(String(item.id))
      } else {
        await api.markItemPlayed(String(item.id))
      }
      setMovieWatched(!movieWatched)
    } catch (e) {
      console.error('[PlayModal] movie markWatched failed:', e)
      setError(`Could not update watch status: ${(e as Error).message}`)
    }
  }

  async function handleMarkWatched(ep: MergedEpisode, watched: boolean) {
    if (!ep.jellyfinId) return
    setActiveMenu(null)
    try {
      if (watched) {
        await api.markItemPlayed(ep.jellyfinId)
      } else {
        await api.markItemUnplayed(ep.jellyfinId)
      }
      setEpisodes((prev) =>
        prev.map((e) => e.id === ep.id ? { ...e, playedPercentage: watched ? 100 : 0 } : e)
      )
    } catch (e) {
      console.error('[PlayModal] markWatched failed:', e)
      setError(`Could not update watch status: ${(e as Error).message}`)
    }
  }

  async function startP2P() {
    setP2pLoading(true)
    setError('')
    try {
      const res = await api.startP2P({
        title: item.title,
        year: item.year ?? undefined,
        type: item.type,
        tmdbId: item.tmdbId
      } as Parameters<typeof api.startP2P>[0])
      setP2pHash(res.infoHash)
    } catch (e) {
      setError((e as Error).message)
      setP2pLoading(false)
    }
  }

  function formatTicks(ticks: number) {
    const s = Math.floor(ticks / 10_000_000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  // ── Derived display state ─────────────────────────────────────────────────
  const backdrop = item.backdropUrl || item.posterUrl
  const isStreaming = loadingPlay && !!streamId

  // Merge TMDB + Jellyfin seasons — TMDB is primary, Jellyfin fills gaps
  const displaySeasons: DisplaySeason[] = (() => {
    if (tmdbSeasons.length === 0) {
      return jellyfinSeasons.map((s) => ({
        seasonNumber: s.seasonNumber,
        title: s.name,
        key: s.id,
        episodeCount: s.episodeCount,
      }))
    }
    const tmdbNums = new Set(tmdbSeasons.map((s) => s.seasonNumber))
    const jfExtra = jellyfinSeasons
      .filter((s) => !tmdbNums.has(s.seasonNumber))
      .map((s): DisplaySeason => ({
        seasonNumber: s.seasonNumber,
        title: s.name,
        key: s.id,
        episodeCount: s.episodeCount,
      }))
    return [...tmdbSeasons, ...jfExtra].sort((a, b) => a.seasonNumber - b.seasonNumber)
  })()

  const showActionRow = item.type === 'movie'
  // Movie is released only when the check explicitly confirms it (not during loading/null state)
  const isMovieReleased = item.type !== 'movie' || item.source === 'jellyfin' || digitalRelease?.isReleased === true

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto
                   bg-[#111] rounded-xl shadow-2xl border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          data-focusable
          data-modal-close
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/60
                     flex items-center justify-center text-white/70 hover:text-white transition"
        >
          <X size={16} />
        </button>

        {/* Backdrop */}
        {backdrop && (
          <div className="relative h-48 overflow-hidden rounded-t-xl">
            <img src={backdrop} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111] to-transparent" />
          </div>
        )}

        <div className="p-6 pt-4">
          {/* Poster + info */}
          <div className="flex gap-4 mb-4">
            {item.posterUrl && (
              <img
                src={item.posterUrl}
                alt={item.title}
                className="w-24 h-36 rounded-lg object-cover flex-shrink-0 -mt-12 relative z-10 shadow-lg"
              />
            )}
            <div className="flex-1 min-w-0 pt-1">
              <h2 className="text-xl font-bold text-white leading-tight">{item.title}</h2>
              <div className="flex items-center gap-2 mt-1 text-sm text-white/40">
                {item.year && <span>{item.year}</span>}
                <span className="uppercase text-xs">{item.type}</span>
                {item.premiumOnly && (
                  <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-500 to-yellow-400 text-black text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                    <Star size={9} fill="currentColor" />
                    Premium
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-white/60 line-clamp-3">{item.overview}</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="mb-4 text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Stream resolution progress */}
          {isStreaming && (
            <div className="mb-4 p-3 rounded-lg bg-blue-900/20 border border-blue-700/30">
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-blue-300">
                    {PHASE_LABELS[streamPhase] || streamMessage || 'Preparing…'}
                  </p>
                  {streamPhase === 'downloading' && streamMessage && (
                    <p className="text-xs text-blue-300/60 mt-0.5">{streamMessage}</p>
                  )}
                </div>
              </div>
              {/* Phase dots */}
              <div className="flex gap-1.5 mt-2.5">
                {Object.keys(PHASE_LABELS).map((phase) => (
                  <div
                    key={phase}
                    className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                      phase === streamPhase
                        ? 'bg-blue-400'
                        : Object.keys(PHASE_LABELS).indexOf(phase) < Object.keys(PHASE_LABELS).indexOf(streamPhase)
                          ? 'bg-blue-500/40'
                          : 'bg-white/10'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Resume prompt (movies) */}
          <AnimatePresence>
            {showResume && resumeTicks !== null && item.type === 'movie' && !(item.premiumOnly && !isPremium) && !isStreaming && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 flex gap-2"
              >
                <button
                  data-focusable
                  onClick={() => { setShowResume(false); play(resumeTicks!) }}
                  className="flex-1 py-2.5 rounded-lg bg-white text-black font-semibold text-sm hover:bg-white/90 transition"
                >
                  Continue from {formatTicks(resumeTicks)}
                </button>
                <button
                  data-focusable
                  onClick={() => { setShowResume(false); play(0) }}
                  className="flex-1 py-2.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15 transition"
                >
                  Start from Beginning
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action row: movies */}
          {showActionRow && !showResume && !isStreaming && (
            <div className="flex gap-2 mb-4">
              {item.premiumOnly && !isPremium ? (
                <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                                bg-gradient-to-r from-amber-900/30 to-yellow-900/20 border border-amber-600/30
                                text-amber-300/70 text-sm cursor-not-allowed">
                  <Lock size={14} />
                  Premium Only
                </div>
              ) : digitalReleaseLoading || (item.source !== 'jellyfin' && item.type === 'movie' && !digitalRelease) ? (
                <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                                bg-white/5 text-white/30 text-sm">
                  <Loader2 size={14} className="animate-spin" />
                  Checking release…
                </div>
              ) : !isMovieReleased ? (
                <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                                bg-white/5 border border-white/10 text-white/30 text-sm cursor-not-allowed">
                  <Lock size={14} />
                  Awaiting Release
                </div>
              ) : (
                <button
                  data-focusable
                  onClick={() => play()}
                  disabled={loadingPlay}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                             bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition disabled:opacity-50"
                >
                  {loadingPlay ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="white" />}
                  Play
                </button>
              )}

              {/* P2P fallback */}
              {!p2pHash && !loadingPlay && isMovieReleased && (
                <button
                  data-focusable
                  onClick={startP2P}
                  disabled={p2pLoading}
                  title="Stream via P2P (WebTorrent)"
                  className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg
                             bg-white/10 hover:bg-white/15 text-white/60 text-sm transition disabled:opacity-50"
                >
                  {p2pLoading ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                  P2P
                </button>
              )}

              <button
                data-focusable
                onClick={() => toggle(item)}
                title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                           bg-white/10 hover:bg-white/15 text-white text-sm transition"
              >
                {inWatchlist ? (
                  <><Check size={14} className="text-green-400" /> Saved</>
                ) : (
                  <><Plus size={14} /> Save</>
                )}
              </button>

              {item.onDemand && item.type === 'movie' && (
                <button
                  data-focusable
                  onClick={handleMovieMarkWatched}
                  title={movieWatched ? 'Remove from watched' : 'Mark as watched'}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                             bg-white/10 hover:bg-white/15 text-white text-sm transition"
                >
                  {movieWatched ? (
                    <><EyeOff size={14} /> Watched</>
                  ) : (
                    <><Eye size={14} /> Mark as watched</>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Release date hint for unreleased movies */}
          {showActionRow && !isMovieReleased && digitalRelease?.releaseDate && (
            <p className="text-xs text-white/30 mb-4 -mt-2">
              Expected digital release: {new Date(digitalRelease.releaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}

          {/* P2P progress */}
          {p2pHash && p2pStatus && (
            <div className="mb-4 p-3 rounded-lg bg-purple-900/20 border border-purple-700/30">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-purple-300">Buffering P2P stream…</span>
                <span className="text-white/50 text-xs">
                  {(p2pStatus.downloadSpeed / 1024).toFixed(0)} KB/s
                </span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-500"
                  style={{ width: `${p2pStatus.bufferPercent}%` }}
                />
              </div>
              <p className="text-xs text-white/30 mt-1">
                {p2pStatus.bufferPercent.toFixed(1)}% buffered
              </p>
            </div>
          )}

          {/* TV: seasons + episodes */}
          {item.type === 'tv' && (
            <div>
              {/* Seasons row: watchlist button + season tabs */}
              <div className="flex items-center gap-2 mb-4">
                <button
                  data-focusable
                  onClick={() => toggle(item)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                             bg-white/10 hover:bg-white/15 text-white/70 text-sm transition"
                >
                  {inWatchlist ? (
                    <><Check size={14} className="text-green-400" /> Saved</>
                  ) : (
                    <><Plus size={14} /> Save</>
                  )}
                </button>
                <div className="h-4 w-px bg-white/10 flex-shrink-0" />
                <div className="flex gap-2 overflow-x-auto pb-0 no-scrollbar">
                  {loadingSeasons ? (
                    <Loader2 size={16} className="animate-spin text-white/30 my-1" />
                  ) : displaySeasons.map((s) => (
                    <button
                      data-focusable
                      key={s.key}
                      onClick={() => setSelectedSeason(s.seasonNumber)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        selectedSeason === s.seasonNumber
                          ? 'bg-red-600 text-white'
                          : 'bg-white/10 text-white/60 hover:bg-white/15'
                      }`}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>

              {loadingSeasons ? (
                <div className="flex justify-center py-6">
                  <Loader2 size={20} className="animate-spin text-white/30" />
                </div>
              ) : displaySeasons.length > 0 ? (
                <>
                  {/* Episode list */}
                  {loadingEpisodes ? (
                    <div className="flex justify-center py-8">
                      <Loader2 size={20} className="animate-spin text-white/30" />
                    </div>
                  ) : (
                    <>
                      {/* Episode resume prompt */}
                      <AnimatePresence>
                        {resumeEp && !isStreaming && (
                          <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            className="mb-3 flex gap-2"
                          >
                            <button
                              data-focusable
                              onClick={() => {
                                const ep = resumeEp
                                setResumeEp(null)
                                const merged = episodes.find(
                                  (e) => e.episodeNumber === ep.episodeNumber && e.seasonNumber === ep.seasonNumber
                                )
                                if (merged) playEpisode(merged, ep.ticks)
                              }}
                              className="flex-1 py-2 rounded-lg bg-white text-black font-semibold text-sm hover:bg-white/90 transition"
                            >
                              Continue from {formatTicks(resumeEp.ticks)}
                            </button>
                            <button
                              data-focusable
                              onClick={() => {
                                const ep = resumeEp
                                setResumeEp(null)
                                const merged = episodes.find(
                                  (e) => e.episodeNumber === ep.episodeNumber && e.seasonNumber === ep.seasonNumber
                                )
                                if (merged) playEpisode(merged, 0)
                              }}
                              className="flex-1 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15 transition"
                            >
                              Start from Beginning
                            </button>
                            <button
                              onClick={() => setResumeEp(null)}
                              className="px-3 py-2 rounded-lg bg-white/5 text-white/50 text-sm hover:bg-white/10 transition"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto pr-1">
                        {episodes.map((ep) => {
                          const pct = ep.playedPercentage ?? 0
                          const isWatched = pct >= 90
                          const hasProgress = pct >= 5 && pct < 90
                          // Episode is released if: no airDate (fail-open), or airDate <= today
                          const isEpReleased = !ep.airDate || new Date(ep.airDate) <= new Date()
                          const isPlayable = item.tmdbId && !(item.premiumOnly && !isPremium) && isEpReleased
                          return (
                            <div
                              key={ep.id}
                              data-focusable={isPlayable ? true : undefined}
                              onClick={isPlayable ? () => { setActiveMenu(null); handleEpisodePlay(ep) } : undefined}
                              className={`group relative flex items-center gap-3 pl-0 pr-3 py-3.5 rounded-lg transition overflow-hidden ${
                                isPlayable
                                  ? 'bg-white/[0.03] hover:bg-white/[0.08] cursor-pointer'
                                  : 'bg-white/[0.02] opacity-50'
                              }`}
                            >
                              {/* Episode number + play icon overlay */}
                              <div className="ep-num-box flex-shrink-0 w-10 h-10 rounded-md bg-white/[0.06] flex items-center justify-center relative transition">
                                <span className={`ep-num-text text-sm font-bold tabular-nums transition ${
                                  isPlayable ? 'text-white/40 group-hover:opacity-0' : 'text-white/20'
                                }`}>
                                  {ep.episodeNumber}
                                </span>
                                {isPlayable && (
                                  <Play size={14} fill="white" className="text-white absolute opacity-0 group-hover:opacity-100 transition ml-0.5" />
                                )}
                                {!isEpReleased && (
                                  <Lock size={12} className="text-white/20 absolute" />
                                )}
                              </div>

                              {/* Title + status + air date */}
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate leading-snug ${isPlayable ? 'text-white/90' : 'text-white/30'}`}>
                                  {ep.title}
                                </p>
                                {!isEpReleased && ep.airDate && (
                                  <p className="text-[11px] text-white/25 mt-0.5">
                                    {new Date(ep.airDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </p>
                                )}
                                {hasProgress && isEpReleased && (
                                  <div className="mt-2 h-1 w-full max-w-[140px] bg-white/10 rounded-full overflow-hidden">
                                    <div className="h-full bg-red-500 rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                )}
                              </div>

                              {/* Badges */}
                              {!isEpReleased && (
                                <span className="flex-shrink-0 text-[9px] font-semibold tracking-wide uppercase
                                                 text-white/20 px-1.5 py-0.5 rounded bg-white/5">
                                  Upcoming
                                </span>
                              )}
                              {isEpReleased && isWatched && (
                                <span className="flex-shrink-0 text-[9px] font-semibold tracking-wide uppercase
                                                 text-emerald-400/70 px-1.5 py-0.5 rounded bg-emerald-500/10">
                                  Watched
                                </span>
                              )}
                              {item.premiumOnly && !isPremium && (
                                <Lock size={11} className="flex-shrink-0 text-amber-400/40" />
                              )}

                              {/* 3-dot menu */}
                              {ep.jellyfinId && (
                                <button
                                  data-focusable
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (activeMenu?.epId === ep.id) {
                                      setActiveMenu(null)
                                    } else {
                                      const rect = e.currentTarget.getBoundingClientRect()
                                      setActiveMenu({ epId: ep.id, top: rect.bottom + 4, right: window.innerWidth - rect.right })
                                    }
                                  }}
                                  className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center
                                             text-white/15 hover:text-white/60 hover:bg-white/10 transition opacity-0 group-hover:opacity-100"
                                >
                                  <MoreHorizontal size={13} />
                                </button>
                              )}
                            </div>
                          )
                        })}
                        {episodes.length === 0 && (
                          <p className="text-center text-white/30 text-sm py-6">No episodes found</p>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-center text-white/30 text-sm py-6">No season data available</p>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Episode context menu — fixed-position so it escapes all overflow clipping */}
      {activeMenu && (() => {
        const menuEp = episodes.find((e) => e.id === activeMenu.epId)
        if (!menuEp) return null
        const isWatched = (menuEp.playedPercentage ?? 0) >= 90
        return (
          <>
            <div className="fixed inset-0 z-[200]" onClick={(e) => { e.stopPropagation(); setActiveMenu(null) }} />
            <div
              className="fixed w-44 bg-[#222] border border-white/10 rounded-lg shadow-xl z-[201] overflow-hidden"
              style={{ top: activeMenu.top, right: activeMenu.right }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                data-focusable
                onClick={() => handleMarkWatched(menuEp, !isWatched)}
                className="w-full text-left px-3 py-2.5 text-xs text-white/70
                           hover:bg-white/8 hover:text-white transition flex items-center gap-2"
              >
                {isWatched
                  ? <><EyeOff size={12} className="flex-shrink-0" /> Remove from watched</>
                  : <><Eye size={12} className="flex-shrink-0" /> Mark as watched</>
                }
              </button>
            </div>
          </>
        )
      })()}
    </motion.div>
  )
}
