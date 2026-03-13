import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Play, Plus, Check, Loader2, Lock, Wifi, Download, MoreHorizontal, Eye, EyeOff, Star } from 'lucide-react'
import * as api from '@/services/api'
import { usePlayer } from '@/contexts/PlayerContext'
import { useWatchlist } from '@/contexts/WatchlistContext'
import { useAuth } from '@/contexts/AuthContext'
import { useSettings, QUALITY_BITRATES } from '@/contexts/SettingsContext'
import type { UnifiedMedia, Season, Episode, P2PStatus, EpisodeInfo } from '@/types/media'

interface MergedEpisode {
  id: string
  title: string
  episodeNumber: number
  seasonNumber: number
  onDemand: boolean
  jellyfinId?: string
  playedPercentage?: number
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

export default function PlayModal({ item, onClose }: Props) {
  const { openPlayer } = usePlayer()
  const { ids, toggle } = useWatchlist()
  const { directPlay, defaultQuality } = useSettings()
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

  // Movie watched state (on-demand movies only)
  const [movieWatched, setMovieWatched] = useState((item.playedPercentage ?? 0) >= 90)

  // Resume prompt (Jellyfin movies only)
  const [resumeTicks, setResumeTicks] = useState<number | null>(null)
  const [showResume, setShowResume] = useState(false)

  // Resume prompt (TV episodes)
  const [resumeEp, setResumeEp] = useState<{ jellyfinId: string; ticks: number } | null>(null)

  // Pruna (content acquisition)
  const [prunaStatus, setPrunaStatus] = useState<api.PrunaStatus | null>(null)
  const [prunaLoading, setPrunaLoading] = useState(false)

  // Episode context menu — tracked with viewport position so the dropdown
  // can be rendered fixed (avoids overflow-hidden / overflow-y-auto clipping)
  const [activeMenu, setActiveMenu] = useState<{ epId: string; top: number; right: number } | null>(null)

  // P2P
  const [p2pLoading, setP2pLoading] = useState(false)
  const [p2pStatus, setP2pStatus] = useState<P2PStatus | null>(null)
  const [p2pHash, setP2pHash] = useState<string | null>(null)
  const [digitalReleased, setDigitalReleased] = useState<boolean | null>(null)

  // ── Check for resume position (movie only) ──────────────────────────────
  useEffect(() => {
    if (!item.onDemand || item.type === 'tv') return
    // If the item carries positionTicks (from Continue Watching), show resume prompt
    if (item.positionTicks && item.positionTicks > 0) {
      setResumeTicks(item.positionTicks)
      setShowResume(true)
    } else {
      // Otherwise check Jellyfin for saved progress
      api.getItemProgress(String(item.id)).then((progress) => {
        if (progress && progress.percent >= 5 && progress.percent < 90) {
          setResumeTicks(progress.positionTicks)
          setShowResume(true)
        }
      }).catch(() => {})
    }
    // Fetch TMDB poster for Discord Rich Presence (movies need this too)
    api.lookupJellyfinItem(String(item.id)).then((lookup) => {
      if (lookup.posterUrl) setTmdbPosterUrl(lookup.posterUrl)
    }).catch(() => {})
  }, [item])

  // Resolved Jellyfin series ID — populated by the lookup below so episodes
  // can reference the correct ID even when item.id is an episode ID.
  const [resolvedSeriesId, setResolvedSeriesId] = useState<string | null>(null)
  const [tmdbPosterUrl, setTmdbPosterUrl] = useState<string | null>(null)

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
      // Resolve the correct Jellyfin series ID via lookup (matches website behaviour).
      // For episodes (Continue Watching), this returns the parent series ID.
      let seriesJfId = item.seriesId || String(item.id)
      let tmdbId = item.tmdbId
      if (item.onDemand) {
        try {
          const lookup = await api.lookupJellyfinItem(String(item.id))
          if (lookup.seriesId) seriesJfId = lookup.seriesId
          if (lookup.tmdbId) tmdbId = lookup.tmdbId
          if (lookup.posterUrl) setTmdbPosterUrl(lookup.posterUrl)
        } catch {
          // best-effort — fall back to item.id
        }
      }
      setResolvedSeriesId(seriesJfId)

      const [tmdb, jf] = await Promise.all([
        tmdbId
          ? api.getTmdbSeasons(tmdbId).catch(() => [] as api.TmdbSeason[])
          : Promise.resolve([] as api.TmdbSeason[]),
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

  // ── Load episodes when season or Jellyfin seasons change ─────────────────
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
        (() => {
          if (!item.onDemand || !jellyfinSeasons.length) return Promise.resolve([] as Episode[])
          const jSeason = jellyfinSeasons.find((s) => s.seasonNumber === selectedSeason)
          if (!jSeason) return Promise.resolve([] as Episode[])
          const epSeriesId = resolvedSeriesId || item.seriesId || String(item.id)
          return api.getEpisodes(epSeriesId, jSeason.id).catch(() => [] as Episode[])
        })(),
      ])

      if (tmdbEps.length > 0) {
        // TMDB episodes as base, merged with Jellyfin availability
        const jMap = new Map(jfEps.map((ep) => [ep.episodeNumber, ep.id]))
        const jProgressMap = new Map(jfEps.map((ep) => [ep.episodeNumber, ep.playedPercentage]))
        return tmdbEps.map((ep): MergedEpisode => {
          const jId = jMap.get(ep.episodeNumber)
          return {
            id: ep.id,
            title: ep.title,
            episodeNumber: ep.episodeNumber,
            seasonNumber: ep.seasonNumber,
            onDemand: !!jId,
            jellyfinId: jId,
            playedPercentage: jProgressMap.get(ep.episodeNumber),
          }
        })
      }

      // Fallback: Jellyfin-only (no TMDB data)
      return jfEps.map((ep): MergedEpisode => ({
        id: ep.id,
        title: ep.name,
        episodeNumber: ep.episodeNumber,
        seasonNumber: ep.seasonNumber,
        onDemand: true,
        jellyfinId: ep.id,
        playedPercentage: ep.playedPercentage,
      }))
    }

    load()
      .then(setEpisodes)
      .catch(() => setEpisodes([]))
      .finally(() => setLoadingEpisodes(false))
  }, [item, selectedSeason, jellyfinSeasons, resolvedSeriesId])

  // ── Digital release check (non-library movies) ───────────────────────────
  useEffect(() => {
    if (item.onDemand || item.type !== 'movie' || !item.tmdbId) return
    api.checkDigitalRelease(item.tmdbId, item.type)
      .then((r) => setDigitalReleased(r.isReleased))
      .catch(() => setDigitalReleased(true))
  }, [item])

  // ── Pruna status load ────────────────────────────────────────────────────
  useEffect(() => {
    if (item.onDemand || !item.tmdbId) return
    api.getPrunaStatus(item.tmdbId, item.type)
      .then(setPrunaStatus)
      .catch(() => setPrunaStatus({ installed: false, state: null }))
  }, [item])

  // ── Pruna status polling (while in pipeline) ──────────────────────────────
  useEffect(() => {
    if (!prunaStatus?.state || prunaStatus.installed) return
    if (!item.tmdbId) return
    const interval = setInterval(() => {
      api.getPrunaStatus(item.tmdbId!, item.type)
        .then(setPrunaStatus)
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [prunaStatus?.state, prunaStatus?.installed, item])

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
            directPlay,
            maxBitrate: directPlay ? undefined : QUALITY_BITRATES[defaultQuality],
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

  async function play(jellyfinItemId: string, startTicks = 0) {
    setLoadingPlay(true)
    setError('')
    try {
      const job = await api.startPlayJob({
        itemId: jellyfinItemId,
        directPlay,
        maxBitrate: directPlay ? undefined : QUALITY_BITRATES[defaultQuality],
        startTimeTicks: startTicks > 0 ? startTicks : undefined,
      })
      // Prefer TMDB poster (public URL Discord can fetch) over Jellyfin internal URL
      job.posterUrl = tmdbPosterUrl
        || (item.posterUrl?.startsWith('https://image.tmdb.org') ? item.posterUrl : null)
      job.seriesId = resolvedSeriesId || item.seriesId || undefined
      job.tmdbId = item.tmdbId
      openPlayer(job, startTicks)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingPlay(false)
    }
  }

  async function playEpisode(jellyfinId: string, startTicks = 0) {
    setLoadingPlay(true)
    setError('')
    try {
      const job = await api.startPlayJob({
        itemId: jellyfinId,
        directPlay,
        maxBitrate: directPlay ? undefined : QUALITY_BITRATES[defaultQuality],
        startTimeTicks: startTicks > 0 ? startTicks : undefined,
      })
      job.posterUrl = tmdbPosterUrl
        || (item.posterUrl?.startsWith('https://image.tmdb.org') ? item.posterUrl : null)
      job.seriesId = resolvedSeriesId || item.seriesId || undefined
      job.tmdbId = item.tmdbId
      const epInfos: EpisodeInfo[] = episodes
        .filter((ep) => ep.onDemand && ep.jellyfinId)
        .map((ep) => ({
          jellyfinId: ep.jellyfinId!,
          title: ep.title,
          episodeNumber: ep.episodeNumber,
          seasonNumber: ep.seasonNumber,
          playedPercentage: ep.playedPercentage,
        }))
      openPlayer(job, startTicks, epInfos, jellyfinId)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingPlay(false)
    }
  }

  async function handleEpisodePlay(ep: MergedEpisode) {
    if (!ep.jellyfinId) return
    const pct = ep.playedPercentage ?? 0
    if (pct >= 5 && pct < 90) {
      const progress = await api.getItemProgress(ep.jellyfinId).catch(() => null)
      if (progress) {
        setResumeEp({ jellyfinId: ep.jellyfinId, ticks: progress.positionTicks })
        return
      }
    }
    playEpisode(ep.jellyfinId)
  }

  async function handleMovieMarkWatched() {
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

  async function handlePrunaInstall() {
    if (!item.tmdbId) return
    setPrunaLoading(true)
    try {
      await api.prunaInstall({
        tmdbId: item.tmdbId,
        type: item.type,
        title: item.title,
        year: item.year,
        isAnime: item.isAnime,
      })
      const status = await api.getPrunaStatus(item.tmdbId, item.type)
      setPrunaStatus(status)
    } catch {
      // ignore — Pruna may not be configured
    } finally {
      setPrunaLoading(false)
    }
  }

  async function handlePrunaRetry() {
    if (!prunaStatus?.prunaId) return
    try {
      await api.prunaRetryById(prunaStatus.prunaId)
      if (item.tmdbId) {
        const status = await api.getPrunaStatus(item.tmdbId, item.type)
        setPrunaStatus(status)
      }
    } catch {
      // ignore
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

  // Season list: prefer TMDB, fall back to Jellyfin shape
  const displaySeasons: DisplaySeason[] = tmdbSeasons.length > 0
    ? tmdbSeasons
    : jellyfinSeasons.map((s) => ({
        seasonNumber: s.seasonNumber,
        title: s.name,
        key: s.id,
        episodeCount: s.episodeCount,
      }))

  // Show play/P2P action row for movies + non-library TV (library TV uses episode list)
  const showActionRow = item.type === 'movie'

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
                {item.onDemand && (
                  item.premiumOnly ? (
                    <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-500 to-yellow-400 text-black text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                      <Star size={9} fill="currentColor" />
                      Premium
                    </span>
                  ) : (
                    <span className="bg-white text-black text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                      Library
                    </span>
                  )
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

          {/* Resume prompt (Jellyfin movies) */}
          <AnimatePresence>
            {showResume && resumeTicks !== null && item.type === 'movie' && !(item.premiumOnly && !isPremium) && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 flex gap-2"
              >
                <button
                  data-focusable
                  onClick={() => { setShowResume(false); play(String(item.id), resumeTicks!) }}
                  className="flex-1 py-2.5 rounded-lg bg-white text-black font-semibold text-sm hover:bg-white/90 transition"
                >
                  Continue from {formatTicks(resumeTicks)}
                </button>
                <button
                  data-focusable
                  onClick={() => { setShowResume(false); play(String(item.id), 0) }}
                  className="flex-1 py-2.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15 transition"
                >
                  Start from Beginning
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action row: movies + non-library TV */}
          {showActionRow && !showResume && (
            <div className="flex gap-2 mb-4">
              {item.onDemand ? (
                item.premiumOnly && !isPremium ? (
                  /* Premium-only — user is not premium */
                  <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                                  bg-gradient-to-r from-amber-900/30 to-yellow-900/20 border border-amber-600/30
                                  text-amber-300/70 text-sm cursor-not-allowed">
                    <Lock size={14} />
                    Premium Only
                  </div>
                ) : (
                  /* Jellyfin movie — direct play */
                  <button
                    data-focusable
                    onClick={() => play(String(item.id))}
                    disabled={loadingPlay}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                               bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition disabled:opacity-50"
                  >
                    {loadingPlay ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="white" />}
                    Play
                  </button>
                )
              ) : (
                <>
                  {item.type === 'movie' ? (
                    /* Non-library movie: check digital release */
                    <>
                      {digitalReleased === null && (
                        <div className="flex-1 flex items-center justify-center py-2.5">
                          <Loader2 size={16} className="animate-spin text-white/30" />
                        </div>
                      )}
                      {digitalReleased === true && !p2pHash && (
                        <button
                          data-focusable
                          onClick={startP2P}
                          disabled={p2pLoading}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                                     bg-purple-700 hover:bg-purple-600 text-white font-semibold text-sm transition disabled:opacity-50"
                        >
                          {p2pLoading ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}
                          Stream (P2P)
                        </button>
                      )}
                      {digitalReleased === false && (
                        <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                                        bg-white/5 text-white/40 text-sm cursor-not-allowed">
                          <Lock size={14} />
                          Awaiting Release
                        </div>
                      )}
                    </>
                  ) : (
                    /* Non-library TV show: P2P at series level */
                    !p2pHash && (
                      <button
                        data-focusable
                        onClick={startP2P}
                        disabled={p2pLoading}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                                   bg-purple-700 hover:bg-purple-600 text-white font-semibold text-sm transition disabled:opacity-50"
                      >
                        {p2pLoading ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}
                        Stream (P2P)
                      </button>
                    )
                  )}

                  <button
                    data-focusable
                    onClick={() => item.tmdbId && api.requestMedia({ title: item.title, tmdbId: item.tmdbId, type: item.type })}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                               bg-white/10 hover:bg-white/15 text-white text-sm transition"
                  >
                    <Plus size={16} />
                    Request
                  </button>
                </>
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
                    <><Eye size={14} /> Watch</>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Pruna section (non-library items only) */}
          {!item.onDemand && item.tmdbId && (() => {
            const state = prunaStatus?.state?.toLowerCase() ?? null
            const inPipeline = state !== null

            // Derive label, colour scheme, and whether retry makes sense
            let label = ''
            let color: 'green' | 'blue' | 'amber' | 'red' = 'blue'
            let showRetry = false

            if (inPipeline) {
              if (state === 'completed') {
                label = 'Installed'
                color = 'green'
              } else if (state === 'requested' || state === 'indexed') {
                label = 'Queued'
                color = 'blue'
              } else if (state === 'scraped' || state === 'downloaded' || state === 'symlinked') {
                label = 'In Progress'
                color = 'blue'
              } else if (state === 'failed') {
                label = prunaStatus.error ? `Failed — ${prunaStatus.error}` : 'Failed'
                color = 'red'
                showRetry = true
              } else if (state === 'paused') {
                label = 'Paused'
                color = 'amber'
                showRetry = true
              } else {
                label = state ? state.charAt(0).toUpperCase() + state.slice(1) : 'Processing'
                color = 'blue'
              }
            }

            const colorMap = {
              green: { bg: 'bg-green-900/20', border: 'border-green-700/30', text: 'text-green-400', icon: 'text-green-400' },
              blue:  { bg: 'bg-blue-900/20',  border: 'border-blue-700/30',  text: 'text-blue-300',  icon: 'text-blue-400'  },
              amber: { bg: 'bg-amber-900/20', border: 'border-amber-700/30', text: 'text-amber-300', icon: 'text-amber-400' },
              red:   { bg: 'bg-red-900/20',   border: 'border-red-700/30',   text: 'text-red-400',   icon: 'text-red-400'   },
            }
            const c = colorMap[color]

            return (
              <div className="mb-4">
                {inPipeline ? (
                  <div className={`flex items-center gap-3 p-3 rounded-lg ${c.bg} border ${c.border}`}>
                    <Download size={14} className={`${c.icon} flex-shrink-0`} />
                    <p className={`flex-1 text-sm font-medium ${c.text}`}>
                      {label}{color !== 'green' && color !== 'red' && '…'}
                    </p>
                    {showRetry && (
                      <button
                        data-focusable
                        onClick={handlePrunaRetry}
                        className="text-xs text-white/50 hover:text-white px-2 py-1 rounded bg-white/10 transition flex-shrink-0"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ) : isPremium ? (
                  <button
                    data-focusable
                    onClick={handlePrunaInstall}
                    disabled={prunaLoading}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                               bg-emerald-800/30 hover:bg-emerald-800/50 border border-emerald-600/30
                               text-emerald-300 text-sm transition disabled:opacity-50"
                  >
                    {prunaLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    Install
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-2 rounded-lg
                                  bg-white/5 border border-white/10 text-white/30 text-sm cursor-not-allowed">
                    <Lock size={14} />
                    Premium Required
                  </div>
                )}
              </div>
            )
          })()}

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

          {/* TV: seasons + episodes (all TV shows) */}
          {item.type === 'tv' && (
            <div>
              {/* Non-library TV: stream + request buttons (hidden for locally available shows) */}
              {!item.onDemand && !showResume && (
                <div className="flex gap-2 mb-4">
                  {!p2pHash && (
                    <button
                      data-focusable
                      onClick={startP2P}
                      disabled={p2pLoading}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                                 bg-purple-700 hover:bg-purple-600 text-white font-semibold text-sm transition disabled:opacity-50"
                    >
                      {p2pLoading ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}
                      Stream (P2P)
                    </button>
                  )}
                  <button
                    data-focusable
                    onClick={() => item.tmdbId && api.requestMedia({ title: item.title, tmdbId: item.tmdbId, type: item.type })}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                               bg-white/10 hover:bg-white/15 text-white text-sm transition"
                  >
                    <Plus size={16} />
                    Request
                  </button>
                </div>
              )}

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
                        {resumeEp && (
                          <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            className="mb-3 flex gap-2"
                          >
                            <button
                              data-focusable
                              onClick={() => { const ep = resumeEp; setResumeEp(null); playEpisode(ep.jellyfinId, ep.ticks) }}
                              className="flex-1 py-2 rounded-lg bg-white text-black font-semibold text-sm hover:bg-white/90 transition"
                            >
                              Continue from {formatTicks(resumeEp.ticks)}
                            </button>
                            <button
                              data-focusable
                              onClick={() => { const ep = resumeEp; setResumeEp(null); playEpisode(ep.jellyfinId, 0) }}
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
                          const isPlayable = ep.onDemand && ep.jellyfinId && !(item.premiumOnly && !isPremium)
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
                              </div>

                              {/* Title + status */}
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate leading-snug ${ep.onDemand ? 'text-white/90' : 'text-white/30'}`}>
                                  {ep.title}
                                </p>
                                {/* Progress bar */}
                                {hasProgress && (
                                  <div className="mt-2 h-1 w-full max-w-[140px] bg-white/10 rounded-full overflow-hidden">
                                    <div className="h-full bg-red-500 rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                )}
                              </div>

                              {/* Badges */}
                              {isWatched && (
                                <span className="flex-shrink-0 text-[9px] font-semibold tracking-wide uppercase
                                                 text-emerald-400/70 px-1.5 py-0.5 rounded bg-emerald-500/10">
                                  Watched
                                </span>
                              )}
                              {!ep.onDemand && (
                                <Lock size={11} className="flex-shrink-0 text-white/15" />
                              )}
                              {item.premiumOnly && !isPremium && ep.onDemand && (
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
            <div className="fixed inset-0 z-[200]" onClick={() => setActiveMenu(null)} />
            <div
              className="fixed w-44 bg-[#222] border border-white/10 rounded-lg shadow-xl z-[201] overflow-hidden"
              style={{ top: activeMenu.top, right: activeMenu.right }}
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
