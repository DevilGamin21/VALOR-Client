import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Play, Plus, Check, Loader2, Lock, MoreHorizontal, Eye, EyeOff, Star, Cast } from 'lucide-react'
import * as api from '@/services/api'
import { usePlayer } from '@/contexts/PlayerContext'
import { useWatchlist } from '@/contexts/WatchlistContext'
import { useAuth } from '@/contexts/AuthContext'
import { useConnect } from '@/contexts/ConnectContext'
import type { UnifiedMedia, PlayJob, Season, Episode, EpisodeInfo } from '@/types/media'

interface MergedEpisode {
  id: string
  title: string
  episodeNumber: number
  seasonNumber: number
  jellyfinId?: string
  playedPercentage?: number
  airDate: string | null
  availableAt?: string | null
  overview?: string | null
  stillUrl?: string | null
}

interface DisplaySeason {
  seasonNumber: number
  title: string
  key: string
  episodeCount: number
}

interface ResumeHint {
  seasonNumber?: number | null
  episodeNumber?: number | null
  positionTicks?: number
}

interface Props {
  item: UnifiedMedia
  onClose: () => void
  resumeHint?: ResumeHint
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

export default function PlayModal({ item, onClose, resumeHint }: Props) {
  const { openPlayer } = usePlayer()
  const { ids, toggle } = useWatchlist()
  const { user } = useAuth()
  const connectCtx = useConnect()
  const isPremium = user?.isPremium || user?.role === 'admin'
  const inWatchlist = ids.has(item.id)
  const hasRemoteTarget = !!connectCtx?.targetDevice

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

  // Episode carousel
  const [visibleEpIdx, setVisibleEpIdx] = useState(0)
  const carouselRef = useRef<HTMLDivElement>(null)

  // Episode context menu
  const [activeMenu, setActiveMenu] = useState<{ epId: string; top: number; right: number } | null>(null)

  // Digital release check
  const [digitalRelease, setDigitalRelease] = useState<{ isReleased: boolean; releaseDate?: string } | null>(null)
  const [digitalReleaseLoading, setDigitalReleaseLoading] = useState(false)

  // TMDB detail (rating, genres)
  const [tmdbRating, setTmdbRating] = useState<number | null>(item.rating ?? null)
  const [tmdbGenres, setTmdbGenres] = useState<{ id: number; name: string }[]>([])

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
    } else {
      // Check our progress store for saved position
      api.getUserProgress(String(item.id)).then((progress) => {
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

      // If resumeHint has a season, select it; otherwise pick the first available
      const hintSeason = resumeHint?.seasonNumber
      const hasSeason = hintSeason != null && (tmdb.some(s => s.seasonNumber === hintSeason) || jf.some(s => s.seasonNumber === hintSeason))
      const firstSeason = hasSeason ? hintSeason :
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
      const [tmdbEps, jfEps, watchedEps] = await Promise.all([
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
        // Fetch user-progress watched episodes (e.g. ["S1E1", "S1E3"])
        item.tmdbId
          ? api.getWatchedEpisodes(item.tmdbId!).catch(() => [] as string[])
          : Promise.resolve([] as string[]),
      ])

      // Build a set for O(1) lookup: "S1E3" → watched
      const watchedSet = new Set(watchedEps)

      if (tmdbEps.length > 0) {
        const jMap = new Map(jfEps.map((ep) => [ep.episodeNumber, ep.id]))
        const jProgressMap = new Map(jfEps.map((ep) => [ep.episodeNumber, ep.playedPercentage]))
        return tmdbEps.map((ep): MergedEpisode => {
          const jfProgress = jProgressMap.get(ep.episodeNumber)
          const userWatched = watchedSet.has(`S${ep.seasonNumber}E${ep.episodeNumber}`)
          return {
            id: ep.id,
            title: ep.title,
            episodeNumber: ep.episodeNumber,
            seasonNumber: ep.seasonNumber,
            jellyfinId: jMap.get(ep.episodeNumber),
            playedPercentage: jfProgress ?? (userWatched ? 100 : undefined),
            airDate: ep.airDate,
            availableAt: ep.availableAt,
            overview: ep.overview,
            stillUrl: ep.stillUrl,
          }
        })
      }

      return jfEps.map((ep): MergedEpisode => {
        const userWatched = watchedSet.has(`S${ep.seasonNumber}E${ep.episodeNumber}`)
        return {
          id: ep.id,
          title: ep.name,
          episodeNumber: ep.episodeNumber,
          seasonNumber: ep.seasonNumber,
          jellyfinId: ep.id,
          playedPercentage: ep.playedPercentage ?? (userWatched ? 100 : undefined),
          airDate: null,
        }
      })
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
          job.year = item.year
          // Set episode metadata for mpv title display + subtitle search
          if (pendingEpIdRef.current && pendingEpisodesRef.current.length > 0) {
            const pendingEp = pendingEpisodesRef.current.find(e => e.jellyfinId === pendingEpIdRef.current)
            if (pendingEp) {
              job.seasonNumber = pendingEp.seasonNumber
              job.episodeNumber = pendingEp.episodeNumber
              job.episodeName = pendingEp.title
            }
          }
          // Fallback: use status fields if backend provides them
          if (job.seasonNumber == null && status.seasonNumber != null) job.seasonNumber = status.seasonNumber
          if (job.episodeNumber == null && status.episodeNumber != null) job.episodeNumber = status.episodeNumber
          if (!job.episodeName && status.episodeName) job.episodeName = status.episodeName

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

  // ── Fetch TMDB detail (rating + genres) ──────────────────────────────────
  useEffect(() => {
    if (!item.tmdbId) return
    api.getTmdbDetail(item.tmdbId, item.type).then((detail) => {
      if (detail.rating != null) setTmdbRating(detail.rating)
      if (detail.genres?.length) setTmdbGenres(detail.genres)
      if (detail.backdropUrl && !item.backdropUrl) {
        // Use TMDB backdrop if item doesn't have one
      }
    }).catch(() => {})
  }, [item.tmdbId, item.type])

  // ── Actions ──────────────────────────────────────────────────────────────

  async function play(startTicks = 0) {
    if (!item.tmdbId) {
      setError('Cannot play — missing TMDB ID')
      return
    }
    if (item.type === 'movie' && item.source !== 'jellyfin' && digitalRelease?.isReleased !== true) return
    // Remote play: send to target device instead of playing locally
    if (hasRemoteTarget && connectCtx) {
      connectCtx.playOnTarget({
        tmdbId: item.tmdbId,
        type: item.type,
        title: item.title,
        year: item.year ?? undefined,
        startPositionTicks: startTicks > 0 ? startTicks : undefined,
        isAnime: item.isAnime,
      })
      onClose()
      return
    }
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
    // Remote play: send to target device
    if (hasRemoteTarget && connectCtx) {
      connectCtx.playOnTarget({
        tmdbId: item.tmdbId,
        type: 'tv',
        title: item.title,
        year: item.year ?? undefined,
        season: ep.seasonNumber,
        episode: ep.episodeNumber,
        startPositionTicks: startTicks > 0 ? startTicks : undefined,
        isAnime: item.isAnime,
      })
      onClose()
      return
    }
    setLoadingPlay(true)
    setError('')
    pendingResumeRef.current = startTicks
    // Build episode list for player navigation — use TMDB episode ID as fallback
    pendingEpisodesRef.current = episodes.map((e) => ({
      jellyfinId: e.jellyfinId || e.id,
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
    try {
      if (movieWatched) {
        await api.deleteUserProgress(String(item.id))
      } else {
        // Mark as watched by reporting position = duration (triggers >90% logic on backend)
        await api.reportProgress({
          itemId: String(item.id),
          positionTicks: 1,
          durationTicks: 1,
          isPaused: true,
          playSessionId: '',
          title: item.title,
          posterUrl: item.posterUrl,
          type: item.type,
          year: item.year,
          tmdbId: item.tmdbId,
        })
      }
      setMovieWatched(!movieWatched)
    } catch (e) {
      console.error('[PlayModal] movie markWatched failed:', e)
      setError(`Could not update watch status: ${(e as Error).message}`)
    }
  }

  async function handleMarkWatched(ep: MergedEpisode, watched: boolean) {
    if (!item.tmdbId) return
    const key = `S${ep.seasonNumber}E${ep.episodeNumber}`
    setActiveMenu(null)
    try {
      if (watched) {
        await api.addWatchedEpisodes(item.tmdbId, [key])
      } else {
        await api.removeWatchedEpisodes(item.tmdbId, [key])
      }
      setWatchedEpKeys((prev) => {
        const next = new Set(prev)
        if (watched) next.add(key); else next.delete(key)
        return next
      })
      setEpisodes((prev) =>
        prev.map((e) => e.id === ep.id ? { ...e, playedPercentage: watched ? 100 : 0 } : e)
      )
    } catch (e) {
      console.error('[PlayModal] markWatched failed:', e)
      setError(`Could not update watch status: ${(e as Error).message}`)
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

  // ── Carousel helpers ────────────────────────────────────────────────────
  const scrollToEp = useCallback((idx: number) => {
    const el = carouselRef.current
    if (!el || !el.children[idx]) return
    const card = el.children[idx] as HTMLElement
    // Scroll so the card's left edge aligns with the container's left edge
    el.scrollTo({ left: card.offsetLeft, behavior: 'smooth' })
  }, [])

  // Reset carousel position when episodes change
  useEffect(() => { setVisibleEpIdx(0) }, [episodes])

  // Track which episode is most visible during scroll
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleCarouselScroll = useCallback(() => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      const el = carouselRef.current
      if (!el || !el.children.length) return
      const containerLeft = el.scrollLeft
      const containerCenter = containerLeft + el.clientWidth / 2
      let closestIdx = 0
      let closestDist = Infinity
      for (let i = 0; i < el.children.length; i++) {
        const card = el.children[i] as HTMLElement
        const cardCenter = card.offsetLeft + card.offsetWidth / 2
        const dist = Math.abs(cardCenter - containerCenter)
        if (dist < closestDist) { closestDist = dist; closestIdx = i }
      }
      setVisibleEpIdx(closestIdx)
    }, 60)
  }, [])

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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto
                   bg-[#0e0e0e] rounded-t-2xl sm:rounded-2xl shadow-2xl border border-white/[0.06]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero section — large backdrop with overlaid info */}
        <div className="relative">
          {backdrop ? (
            <div className="relative h-64 sm:h-72 overflow-hidden rounded-t-2xl sm:rounded-t-2xl">
              <img src={backdrop} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e0e] via-[#0e0e0e]/40 to-transparent" />
            </div>
          ) : (
            <div className="h-20" />
          )}

          {/* Close button */}
          <button
            data-focusable
            data-modal-close
            onClick={onClose}
            className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm
                       flex items-center justify-center text-white/70 hover:text-white hover:bg-white/15 transition"
          >
            <X size={16} />
          </button>

          {/* Info overlaid on backdrop */}
          <div className={`px-6 pb-1 ${backdrop ? '-mt-24 relative z-[1]' : 'pt-4'}`}>
            <div className="flex gap-5">
              {item.posterUrl && (
                <img
                  src={item.posterUrl}
                  alt={item.title}
                  className="w-28 h-[168px] rounded-lg object-cover flex-shrink-0 shadow-xl ring-1 ring-white/10"
                />
              )}
              <div className="flex-1 min-w-0 flex flex-col justify-end pb-1">
                <h2 className="text-2xl font-bold text-white leading-tight drop-shadow-lg">{item.title}</h2>
                <div className="flex items-center gap-2.5 mt-2 flex-wrap">
                  {tmdbRating != null && tmdbRating > 0 && (
                    <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-md">
                      <Star size={12} fill="currentColor" />
                      {tmdbRating.toFixed(1)}
                    </span>
                  )}
                  {item.year && <span className="text-sm text-white/50 font-medium">{item.year}</span>}
                  {tmdbGenres.length > 0 && (
                    <span className="text-sm text-white/35">
                      {tmdbGenres.slice(0, 3).map(g => g.name).join(' · ')}
                    </span>
                  )}
                  {item.premiumOnly && (
                    <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-500 to-yellow-400 text-black text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                      <Star size={9} fill="currentColor" />
                      Premium
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pt-3 pb-6">
          {/* Overview */}
          {item.overview && (
            <p className="text-sm text-white/50 leading-relaxed line-clamp-3 mb-5">{item.overview}</p>
          )}

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
            <div className="flex gap-2.5 mb-5">
              {item.premiumOnly && !isPremium ? (
                <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                                bg-gradient-to-r from-amber-900/30 to-yellow-900/20 border border-amber-600/30
                                text-amber-300/70 text-sm cursor-not-allowed">
                  <Lock size={14} />
                  Premium Only
                </div>
              ) : digitalReleaseLoading || (item.source !== 'jellyfin' && item.type === 'movie' && !digitalRelease) ? (
                <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                                bg-white/5 text-white/30 text-sm">
                  <Loader2 size={14} className="animate-spin" />
                  Checking release…
                </div>
              ) : !isMovieReleased ? (
                <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                                bg-white/5 border border-white/10 text-white/30 text-sm cursor-not-allowed">
                  <Lock size={14} />
                  Awaiting Release
                </div>
              ) : (
                <button
                  data-focusable
                  onClick={() => play()}
                  disabled={loadingPlay}
                  className="flex-[2] flex items-center justify-center gap-2 py-3 rounded-xl
                             bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition disabled:opacity-50"
                >
                  {loadingPlay ? <Loader2 size={16} className="animate-spin" /> : hasRemoteTarget ? <Cast size={16} /> : <Play size={16} fill="white" />}
                  {hasRemoteTarget ? `Play on ${connectCtx?.targetDevice?.deviceName}` : 'Play'}
                </button>
              )}

              <button
                data-focusable
                onClick={() => toggle(item)}
                title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                           bg-white/[0.07] hover:bg-white/[0.12] text-white text-sm transition"
              >
                {inWatchlist ? (
                  <><Check size={14} className="text-green-400" /> Saved</>
                ) : (
                  <><Plus size={14} /> Save</>
                )}
              </button>

              {item.type === 'movie' && (
                <button
                  data-focusable
                  onClick={handleMovieMarkWatched}
                  title={movieWatched ? 'Remove from watched' : 'Mark as watched'}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                             bg-white/[0.07] hover:bg-white/[0.12] text-white text-sm transition"
                >
                  {movieWatched ? (
                    <><EyeOff size={14} /> Watched</>
                  ) : (
                    <><Eye size={14} /> Mark watched</>
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

          {/* TV: seasons + episodes */}
          {item.type === 'tv' && (
            <div>
              {/* Action row for TV */}
              <div className="flex gap-2.5 mb-5">
                <button
                  data-focusable
                  onClick={() => toggle(item)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl
                             bg-white/[0.07] hover:bg-white/[0.12] text-white text-sm transition"
                >
                  {inWatchlist ? (
                    <><Check size={14} className="text-green-400" /> Saved</>
                  ) : (
                    <><Plus size={14} /> Save</>
                  )}
                </button>
              </div>

              {/* Season tabs */}
              <div className="flex gap-1.5 mb-4 overflow-x-auto pb-0.5 no-scrollbar">
                {loadingSeasons ? (
                  <Loader2 size={16} className="animate-spin text-white/30 my-1" />
                ) : displaySeasons.map((s) => (
                  <button
                    data-focusable
                    key={s.key}
                    onClick={() => setSelectedSeason(s.seasonNumber)}
                    className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition ${
                      selectedSeason === s.seasonNumber
                        ? 'bg-white text-black'
                        : 'bg-white/[0.07] text-white/50 hover:bg-white/[0.12] hover:text-white/70'
                    }`}
                  >
                    {s.title}
                  </button>
                ))}
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

                      {/* Episode rail — tiny bars showing count + release status */}
                      {episodes.length > 0 && (
                        <div className="flex justify-center mb-3">
                          <div className="flex gap-[3px]" style={{ width: `min(100%, ${episodes.length * 28}px)` }}>
                            {episodes.map((ep, i) => {
                              const isEpReleased = ep.availableAt ? new Date(ep.availableAt) <= new Date() : !ep.airDate || new Date(ep.airDate) <= new Date()
                              const isCurrent = i === visibleEpIdx
                              return (
                                <button
                                  key={ep.id}
                                  onClick={() => { setVisibleEpIdx(i); scrollToEp(i) }}
                                  className={`h-[4px] flex-1 rounded-full transition-all duration-200 ${
                                    isCurrent
                                      ? 'bg-red-500 shadow-[0_0_6px_1px_rgba(239,68,68,0.5)]'
                                      : isEpReleased
                                        ? 'bg-white/25 hover:bg-white/40'
                                        : 'bg-white/[0.06] hover:bg-white/10'
                                  }`}
                                  title={`Episode ${ep.episodeNumber}`}
                                />
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Episode carousel — horizontal scroll */}
                      <div className="relative">
                        <div
                          ref={carouselRef}
                          onScroll={handleCarouselScroll}
                          className="flex gap-3 overflow-x-auto scroll-smooth no-scrollbar pb-1"
                        >
                          {episodes.map((ep) => {
                            const pct = ep.playedPercentage ?? 0
                            const isWatched = pct >= 90
                            const hasProgress = pct >= 5 && pct < 90
                            const isEpReleased = ep.availableAt ? new Date(ep.availableAt) <= new Date() : !ep.airDate || new Date(ep.airDate) <= new Date()
                            const isPlayable = !!(item.tmdbId && !(item.premiumOnly && !isPremium) && isEpReleased)
                            return (
                              <div
                                key={ep.id}
                                data-focusable
                                onClick={isPlayable ? () => { setActiveMenu(null); handleEpisodePlay(ep) } : undefined}
                                onFocus={() => setVisibleEpIdx(episodes.indexOf(ep))}
                                onMouseEnter={() => setVisibleEpIdx(episodes.indexOf(ep))}
                                className={`group relative flex-shrink-0 w-64 rounded-xl overflow-hidden transition ${
                                  isPlayable
                                    ? 'bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer'
                                    : 'bg-white/[0.02] opacity-25 grayscale cursor-default'
                                }`}
                              >
                                {/* Still image or fallback */}
                                <div className="relative h-36 bg-white/[0.03] overflow-hidden">
                                  {ep.stillUrl ? (
                                    <img src={ep.stillUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <span className="text-3xl font-bold text-white/[0.06] tabular-nums">{ep.episodeNumber}</span>
                                    </div>
                                  )}
                                  {/* Play overlay */}
                                  {isPlayable && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition">
                                      <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                                        <Play size={16} fill="black" className="text-black ml-0.5" />
                                      </div>
                                    </div>
                                  )}
                                  {!isEpReleased && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <Lock size={20} className="text-white/20" />
                                    </div>
                                  )}
                                  {/* Progress bar at bottom of image */}
                                  {hasProgress && isEpReleased && (
                                    <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
                                      <div className="h-full bg-red-500" style={{ width: `${pct}%` }} />
                                    </div>
                                  )}
                                  {/* Badges */}
                                  <div className="absolute top-2 right-2 flex gap-1">
                                    {!isEpReleased && (
                                      <span className="text-[9px] font-medium text-white/60 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded">
                                        Upcoming
                                      </span>
                                    )}
                                    {isEpReleased && isWatched && (
                                      <span className="text-[9px] font-medium text-emerald-300 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded">
                                        Watched
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Card body */}
                                <div className="px-3 py-2.5">
                                  <div className="flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-baseline gap-2">
                                        <span className="text-[10px] font-bold text-white/30 tabular-nums flex-shrink-0">
                                          E{ep.episodeNumber}
                                        </span>
                                        <p className={`text-[13px] font-medium truncate ${isPlayable ? 'text-white/80' : 'text-white/30'}`}>
                                          {ep.title}
                                        </p>
                                      </div>
                                      {ep.overview && (
                                        <p className="mt-1 text-[11px] text-white/30 leading-relaxed line-clamp-2">
                                          {ep.overview}
                                        </p>
                                      )}
                                      {!isEpReleased && (ep.availableAt || ep.airDate) && (
                                        <p className="mt-1 text-[10px] text-white/20">
                                          {ep.availableAt
                                            ? new Date(ep.availableAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                                            : new Date(ep.airDate!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </p>
                                      )}
                                    </div>
                                    {/* 3-dot menu */}
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
                                      className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center
                                                 text-white/20 hover:text-white/60 hover:bg-white/10 transition"
                                    >
                                      <MoreHorizontal size={13} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        {episodes.length === 0 && (
                          <p className="text-center text-white/25 text-sm py-8">No episodes found</p>
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
