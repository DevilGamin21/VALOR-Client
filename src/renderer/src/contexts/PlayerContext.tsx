import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'
import type { PlayJob, EpisodeInfo } from '@/types/media'
import * as api from '@/services/api'
import { useSettings, QUALITY_BITRATES } from '@/contexts/SettingsContext'
import { useConnect } from '@/contexts/ConnectContext'

interface PlayerState {
  job: PlayJob | null
  startPositionTicks: number
  isOpen: boolean
  /** True when mpv is actively playing (VideoPlayer is NOT open in this case) */
  mpvActive: boolean
  episodeList: EpisodeInfo[]
  currentEpisodeId: string
  openPlayer: (job: PlayJob, startPositionTicks?: number, episodes?: EpisodeInfo[], currentEpisodeId?: string) => Promise<void>

  closePlayer: () => void
  updateJob: (job: PlayJob) => void
  setEpisodeList: (eps: EpisodeInfo[]) => void
  setCurrentEpisodeId: (id: string) => void
}

const PlayerContext = createContext<PlayerState | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { playerEngine } = useSettings()
  const [job, setJob] = useState<PlayJob | null>(null)
  const [startPositionTicks, setStartPositionTicks] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [mpvActive, setMpvActive] = useState(false)
  const [episodeList, setEpisodeList] = useState<EpisodeInfo[]>([])
  const [currentEpisodeId, setCurrentEpisodeId] = useState('')

  // mpv tracking refs — only time/duration needed for stop-reporting in cleanupMpv
  const mpvTimeRef = useRef(0)
  const mpvDurationRef = useRef(0)
  const mpvJobRef = useRef<PlayJob | null>(null)

  // ── mpv cleanup helper ──────────────────────────────────────────────────
  const cleanupMpv = useCallback((_reportStop: boolean) => {
    // Note: the overlay window handles stop-reporting, heartbeat, Discord, and mark-played.
    // PlayerContext just resets its own state when mpv exits.
    window.electronAPI.mpv.removeAllListeners()
    mpvTimeRef.current = 0
    mpvDurationRef.current = 0
    mpvJobRef.current = null
    setMpvActive(false)
    setJob(null)
  }, [])

  // ── mpv launch ──────────────────────────────────────────────────────────
  const launchMpv = useCallback((playJob: PlayJob, ticks: number, episodes: EpisodeInfo[] = [], epId = '') => {
    const mpvApi = window.electronAPI.mpv
    mpvJobRef.current = playJob
    mpvTimeRef.current = 0
    mpvDurationRef.current = 0

    // Subscribe to mpv events (each call replaces old listeners).
    // Note: heartbeat, Discord RPC, and mark-played are handled by the overlay window.
    // PlayerContext only tracks time/duration for stop-reporting on cleanup.
    mpvApi.onReady(() => {
      setMpvActive(true)
    })
    mpvApi.onTime((time) => {
      mpvTimeRef.current = time
    })
    mpvApi.onDuration((dur) => {
      mpvDurationRef.current = dur
    })
    mpvApi.onPaused(() => {})
    mpvApi.onEnded(() => {
      cleanupMpv(true)
    })
    mpvApi.onError((err) => {
      console.error('[mpv]', err)
      cleanupMpv(true)
    })

    // Launch mpv
    const url = playJob.directStreamUrl || playJob.hlsUrl
    console.log('[mpv] Launching —', url?.slice(0, 120), '| ticks:', ticks)
    mpvApi.launch({
      hlsUrl: playJob.hlsUrl,
      title: playJob.seriesName || playJob.title,
      itemId: playJob.itemId,
      playSessionId: playJob.playSessionId || '',
      startPositionTicks: ticks,
      audioTracks: playJob.audioTracks,
      subtitleTracks: playJob.subtitleTracks,
      episodeList: episodes,
      currentEpisodeId: epId,
      job: playJob,
    }).then(() => {
      console.log('[mpv] Launch IPC resolved successfully')
    }).catch((err) => {
      console.error('[mpv] Failed to launch:', err)
      cleanupMpv(false)
    })
  }, [cleanupMpv])

  // ── openPlayer ──────────────────────────────────────────────────────────
  const openPlayer = useCallback(async (newJob: PlayJob, ticks = 0, episodes: EpisodeInfo[] = [], epId = '') => {
    setJob(newJob)
    setStartPositionTicks(ticks)
    setEpisodeList(episodes)
    setCurrentEpisodeId(epId)

    // If mpv is selected, verify it's actually installed before launching.
    // Fall back to built-in when missing so the user still gets playback
    // instead of a silent "nothing happens" failure.
    let useEngine: 'mpv' | 'builtin' = playerEngine
    if (useEngine === 'mpv') {
      const mpvOk = await window.electronAPI.mpv.isAvailable().catch(() => false)
      if (!mpvOk) {
        console.warn('[PlayerContext] playerEngine=mpv but mpv.exe not found — falling back to built-in')
        useEngine = 'builtin'
      }
    }

    if (useEngine === 'mpv') {
      console.log('[PlayerContext] playerEngine=mpv, calling launchMpv')
      launchMpv(newJob, ticks, episodes, epId)
    } else {
      console.log('[PlayerContext] playerEngine=builtin, opening VideoPlayer')
      setIsOpen(true)
    }
  }, [playerEngine, launchMpv])

  const closePlayer = useCallback(() => {
    if (mpvActive) {
      window.electronAPI.mpv.quit().catch(() => {})
      cleanupMpv(true)
      return
    }
    setIsOpen(false)
    // Delay clearing job so the exit animation can play
    setTimeout(() => setJob(null), 350)
  }, [mpvActive, cleanupMpv])

  const updateJob = useCallback((newJob: PlayJob) => {
    setJob(newJob)
    if (mpvJobRef.current) mpvJobRef.current = newJob
  }, [])

  // ── Connect: mpv state push + command relay ──────────────────────────────
  const connectCtx = useConnect()

  // Push mpv state to Connect every 5s while mpv is active
  useEffect(() => {
    if (!mpvActive || !connectCtx?.pushState) return
    const push = () => {
      const j = mpvJobRef.current
      if (!j) return
      connectCtx.pushState({
        playing: true, // if mpvActive, it's playing (paused state comes from overlay)
        positionSeconds: Math.floor(mpvTimeRef.current),
        durationSeconds: Math.floor(mpvDurationRef.current),
        mediaMeta: {
          title: j.seriesName || j.title,
          tmdbId: j.tmdbId,
          type: j.seriesId ? 'tv' : j.type,
          seasonNumber: j.seasonNumber ?? undefined,
          episodeNumber: j.episodeNumber ?? undefined,
          posterUrl: j.posterUrl,
        },
      })
    }
    push()
    const interval = setInterval(push, 5000)
    return () => clearInterval(interval)
  }, [mpvActive, connectCtx])

  // Push idle when mpv stops
  useEffect(() => {
    if (mpvActive) return
    connectCtx?.pushState({ playing: false, mediaMeta: null, positionSeconds: 0, durationSeconds: 0 })
  }, [mpvActive, connectCtx])

  // Handle remote commands for mpv
  useEffect(() => {
    if (!mpvActive || !connectCtx?.setCommandHandler) return
    connectCtx.setCommandHandler((command, payload) => {
      switch (command) {
        case 'play': window.electronAPI.mpv.resume().catch(() => {}); break
        case 'pause': window.electronAPI.mpv.pause().catch(() => {}); break
        case 'seek':
          if (typeof payload.positionSeconds === 'number') {
            window.electronAPI.mpv.seekAbsolute(payload.positionSeconds).catch(() => {})
          }
          break
        case 'resume':
          if (typeof payload.positionSeconds === 'number') {
            window.electronAPI.mpv.seekAbsolute(payload.positionSeconds).catch(() => {})
            window.electronAPI.mpv.resume().catch(() => {})
          }
          break
        case 'getState': break // state is pushed on interval
      }
    })
    return () => { connectCtx.setCommandHandler(null) }
  }, [mpvActive, connectCtx])

  // ── Connect: handle playMedia when idle (host mode) ──────────────────────
  const { directPlay, defaultQuality } = useSettings()
  useEffect(() => {
    // Only register idle handler when no player is active
    // (when mpv is active, the mpv command handler takes over)
    if (mpvActive || isOpen) return
    if (!connectCtx?.setCommandHandler) return

    connectCtx.setCommandHandler((command, payload) => {
      if (command !== 'playMedia') return
      const { tmdbId, type, title, year, season, episode, canonicalSeason, canonicalEpisode, startPositionTicks, isAnime } = payload as {
        tmdbId?: number; type?: string; title?: string; year?: number
        season?: number; episode?: number
        canonicalSeason?: number; canonicalEpisode?: number
        startPositionTicks?: number; isAnime?: boolean
      }
      if (!tmdbId) return
      console.log('[Connect] Received playMedia:', title, season && episode ? `S${season}E${episode}` : '')

      // Start the stream via the on-demand flow
      api.startStream({
        tmdbId,
        type: (type as 'movie' | 'tv') || 'movie',
        title: title || 'Unknown',
        year,
        season,
        episode,
        canonicalSeason,
        canonicalEpisode,
        isAnime,
      }).then(({ streamId }) => {
        // Poll for ready
        const poll = setInterval(async () => {
          try {
            const status = await api.getStreamStatus(streamId)
            if (status.phase === 'ready') {
              clearInterval(poll)
              const playJob: PlayJob = {
                itemId: status.itemId || status.jellyfinItemId || '',
                hlsUrl: status.hlsUrl || '',
                directStreamUrl: status.directStreamUrl,
                playSessionId: status.playSessionId || null,
                deviceId: status.deviceId,
                audioTracks: status.audioTracks || [],
                subtitleTracks: (status.subtitleTracks || []).map(t => ({
                  ...t,
                  vttUrl: t.vttUrl ?? t.url ?? null,
                })),
                title: status.title || title || 'Unknown',
                seriesName: status.seriesName,
                type: status.type || type || 'movie',
                durationTicks: status.durationTicks,
                introStartSec: status.introStartSec,
                introEndSec: status.introEndSec,
                creditsStartSec: status.creditsStartSec,
                mpvOptions: status.mpvOptions,
                tmdbId,
                year,
                seasonNumber: season,
                episodeNumber: episode,
              }
              openPlayer(playJob, startPositionTicks || 0)
            } else if (status.phase === 'error') {
              clearInterval(poll)
              console.error('[Connect] playMedia stream error:', status.error || status.message)
            }
          } catch {
            clearInterval(poll)
          }
        }, 1500)
      }).catch((err) => {
        console.error('[Connect] playMedia failed:', err)
      })
    })
    return () => { connectCtx.setCommandHandler(null) }
  }, [mpvActive, isOpen, connectCtx, openPlayer])

  // Cleanup on unmount
  useEffect(() => {
    return () => { window.electronAPI.mpv.removeAllListeners() }
  }, [])

  return (
    <PlayerContext.Provider
      value={{ job, startPositionTicks, isOpen, mpvActive, episodeList, currentEpisodeId, openPlayer, closePlayer, updateJob, setEpisodeList, setCurrentEpisodeId }}
    >
      {children}
    </PlayerContext.Provider>
  )
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}
