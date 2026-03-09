import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'
import type { PlayJob, EpisodeInfo } from '@/types/media'
import { useSettings } from '@/contexts/SettingsContext'

interface PlayerState {
  job: PlayJob | null
  startPositionTicks: number
  isOpen: boolean
  /** True when mpv is actively playing (VideoPlayer is NOT open in this case) */
  mpvActive: boolean
  episodeList: EpisodeInfo[]
  currentEpisodeId: string
  openPlayer: (job: PlayJob, startPositionTicks?: number, episodes?: EpisodeInfo[], currentEpisodeId?: string) => void
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
  const openPlayer = useCallback((newJob: PlayJob, ticks = 0, episodes: EpisodeInfo[] = [], epId = '') => {
    setJob(newJob)
    setStartPositionTicks(ticks)
    setEpisodeList(episodes)
    setCurrentEpisodeId(epId)

    if (playerEngine === 'mpv') {
      // mpv mode: launch mpv directly, don't open VideoPlayer overlay
      console.log('[PlayerContext] playerEngine=mpv, calling launchMpv')
      launchMpv(newJob, ticks, episodes, epId)
    } else {
      console.log('[PlayerContext] playerEngine=builtin, opening VideoPlayer')
      // Built-in mode: open VideoPlayer overlay as before
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
