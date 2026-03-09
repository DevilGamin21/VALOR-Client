import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'
import type { PlayJob, EpisodeInfo } from '@/types/media'
import * as api from '@/services/api'
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
  const { playerEngine, discordRPC } = useSettings()
  const [job, setJob] = useState<PlayJob | null>(null)
  const [startPositionTicks, setStartPositionTicks] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [mpvActive, setMpvActive] = useState(false)
  const [episodeList, setEpisodeList] = useState<EpisodeInfo[]>([])
  const [currentEpisodeId, setCurrentEpisodeId] = useState('')

  // mpv background tracking refs
  const mpvTimeRef = useRef(0)
  const mpvDurationRef = useRef(0)
  const mpvHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mpvMarkedPlayedRef = useRef(false)
  const mpvJobRef = useRef<PlayJob | null>(null)

  // ── mpv cleanup helper ──────────────────────────────────────────────────
  const cleanupMpv = useCallback((reportStop: boolean) => {
    const mpvJob = mpvJobRef.current
    if (mpvHeartbeatRef.current) {
      clearInterval(mpvHeartbeatRef.current)
      mpvHeartbeatRef.current = null
    }
    window.electronAPI.mpv.removeAllListeners()

    // Report final stop position
    if (reportStop && mpvJob) {
      const curTimeSecs = mpvTimeRef.current
      const durSecs = mpvDurationRef.current || (mpvJob.durationTicks ?? 0) / 10_000_000
      const posTicks = Math.floor(curTimeSecs * 10_000_000)
      const durTicks = Math.floor(durSecs * 10_000_000)
      if (durTicks > 0) {
        api.reportProgress({
          itemId: mpvJob.itemId,
          positionTicks: posTicks,
          durationTicks: durTicks,
          isPaused: true,
          playSessionId: mpvJob.playSessionId,
          isStopped: true,
        }).catch(() => {})
        api.reportUserProgress({
          mediaId: mpvJob.itemId,
          positionTicks: posTicks,
          durationTicks: durTicks,
          title: mpvJob.seriesName || mpvJob.title,
          posterUrl: mpvJob.posterUrl,
          type: mpvJob.seriesId ? 'tv' : mpvJob.type,
          tmdbId: mpvJob.tmdbId,
          seriesId: mpvJob.seriesId,
          isStopped: true,
        }).catch(() => {})
        // Mark as played if >90%
        const pct = durTicks > 0 ? (posTicks / durTicks) * 100 : 0
        if (pct > 90 && !mpvMarkedPlayedRef.current) {
          api.markItemPlayed(mpvJob.itemId).catch(() => {})
        }
      }
    }

    if (discordRPC) window.electronAPI.discord.clearActivity().catch(() => {})

    mpvTimeRef.current = 0
    mpvDurationRef.current = 0
    mpvMarkedPlayedRef.current = false
    mpvJobRef.current = null
    setMpvActive(false)
    setJob(null)
  }, [discordRPC])

  // ── mpv launch ──────────────────────────────────────────────────────────
  const launchMpv = useCallback((playJob: PlayJob, ticks: number) => {
    const mpvApi = window.electronAPI.mpv
    mpvJobRef.current = playJob
    mpvTimeRef.current = 0
    mpvDurationRef.current = 0
    mpvMarkedPlayedRef.current = false

    // Subscribe to mpv events (each call replaces old listeners)
    mpvApi.onReady(() => {
      setMpvActive(true)
    })
    mpvApi.onTime((time) => {
      mpvTimeRef.current = time
    })
    mpvApi.onDuration((dur) => {
      mpvDurationRef.current = dur
    })
    mpvApi.onPaused((paused) => {
      // Update discord presence
      if (discordRPC) {
        const currentJob = mpvJobRef.current
        if (!currentJob) return
        const curTime = mpvTimeRef.current
        const durSecs = mpvDurationRef.current || (currentJob.durationTicks ?? 0) / 10_000_000
        const details = currentJob.seriesName || currentJob.title
        const nowSec = Math.floor(Date.now() / 1000)
        window.electronAPI.discord.setActivity({
          details: details.length > 128 ? details.slice(0, 125) + '...' : details,
          state: paused
            ? `Paused · ${fmtTime(curTime)} / ${fmtTime(durSecs)}`
            : (currentJob.seriesName || currentJob.title),
          startTimestamp: !paused && !durSecs ? nowSec - Math.floor(curTime) : undefined,
          endTimestamp: !paused && durSecs > 0 ? nowSec + Math.max(0, Math.floor(durSecs - curTime)) : undefined,
          largeImageKey: currentJob.posterUrl || undefined,
          largeImageText: currentJob.posterUrl ? (currentJob.seriesName || currentJob.title) : undefined,
          instance: false,
          buttons: [{ label: 'Get VALOR', url: 'https://github.com/DevilGamin21/VALOR-Client/releases/latest/download/VALOR-Setup.exe' }],
        }).catch(() => {})
      }
    })
    mpvApi.onEnded(() => {
      // mpv exited (user closed window, EOF, etc.)
      cleanupMpv(true)
    })
    mpvApi.onError((err) => {
      console.error('[mpv]', err)
      cleanupMpv(true)
    })

    // Start heartbeat for progress reporting
    mpvHeartbeatRef.current = setInterval(() => {
      const currentJob = mpvJobRef.current
      if (!currentJob) return
      const curTimeSecs = mpvTimeRef.current
      const durSecs = mpvDurationRef.current || (currentJob.durationTicks ?? 0) / 10_000_000
      if (!durSecs) return
      const posTicks = Math.floor(curTimeSecs * 10_000_000)
      const durTicks = Math.floor(durSecs * 10_000_000)
      api.reportProgress({
        itemId: currentJob.itemId,
        positionTicks: posTicks,
        durationTicks: durTicks,
        isPaused: false,
        playSessionId: currentJob.playSessionId,
      }).catch(() => {})
      api.reportUserProgress({
        mediaId: currentJob.itemId,
        positionTicks: posTicks,
        durationTicks: durTicks,
        title: currentJob.seriesName || currentJob.title,
        posterUrl: currentJob.posterUrl,
        type: currentJob.seriesId ? 'tv' : currentJob.type,
        tmdbId: currentJob.tmdbId,
        seriesId: currentJob.seriesId,
      }).catch(() => {})
      const pct = durTicks > 0 ? (posTicks / durTicks) * 100 : 0
      if (pct > 90 && !mpvMarkedPlayedRef.current) {
        mpvMarkedPlayedRef.current = true
        api.markItemPlayed(currentJob.itemId).catch(() => {})
      }
    }, 10_000)

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
      episodeList: [],
      currentEpisodeId: '',
      job: playJob,
    }).then(() => {
      console.log('[mpv] Launch IPC resolved successfully')
    }).catch((err) => {
      console.error('[mpv] Failed to launch:', err)
      cleanupMpv(false)
    })
  }, [discordRPC, cleanupMpv])

  // ── openPlayer ──────────────────────────────────────────────────────────
  const openPlayer = useCallback((newJob: PlayJob, ticks = 0, episodes: EpisodeInfo[] = [], epId = '') => {
    setJob(newJob)
    setStartPositionTicks(ticks)
    setEpisodeList(episodes)
    setCurrentEpisodeId(epId)

    if (playerEngine === 'mpv') {
      // mpv mode: launch mpv directly, don't open VideoPlayer overlay
      console.log('[PlayerContext] playerEngine=mpv, calling launchMpv')
      launchMpv(newJob, ticks)
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
    return () => {
      if (mpvHeartbeatRef.current) clearInterval(mpvHeartbeatRef.current)
      window.electronAPI.mpv.removeAllListeners()
    }
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

function fmtTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
