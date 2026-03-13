import { useEffect, useRef, useState, useCallback } from 'react'
import Hls from 'hls.js'
import { motion } from 'framer-motion'
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipForward,
  SkipBack,
  Settings,
  Subtitles,
  Loader2,
  List,
  Moon,
  Globe,
  Search,
  Check,
} from 'lucide-react'
import * as api from '@/services/api'
import type { PlayJob, AudioTrack, SubtitleTrack, EpisodeInfo } from '@/types/media'
import type { OsSubtitleResult } from '@/services/api'
import { API_BASE } from '@/services/api'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings, QUALITY_BITRATES, type SubtitleSize } from '@/contexts/SettingsContext'
import { useGamepad } from '@/hooks/useGamepad'

interface Props {
  job: PlayJob
  startPositionTicks: number
  onClose: () => void
}

interface VttCue {
  start: number
  end: number
  text: string
}

function parseVttCues(vttText: string): VttCue[] {
  const cues: VttCue[] = []
  const blocks = vttText.split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim())
    const toSec = (t: string) => {
      const parts = t.replace(',', '.').split(':').map(Number)
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
      return parts[0] * 60 + parts[1]
    }
    const textLines = lines.slice(lines.indexOf(timeLine) + 1)
    cues.push({ start: toSec(startStr), end: toSec(endStr), text: textLines.join('\n') })
  }
  return cues
}

const QUALITY_PRESETS = [
  { label: 'Original', maxBitrate: 0 },
  { label: '1440p', maxBitrate: 20_000_000 },
  { label: '1080p', maxBitrate: 10_000_000 },
  { label: '720p',  maxBitrate: 4_000_000 },
  { label: '480p',  maxBitrate: 2_000_000 },
]

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]


type SleepOption = 'off' | '5' | '10' | '15' | '30' | '60' | '90' | 'end'
const SLEEP_OPTIONS: { value: SleepOption; label: string }[] = [
  { value: 'off',  label: 'Off' },
  { value: '5',   label: '5 minutes' },
  { value: '10',  label: '10 minutes' },
  { value: '15',  label: '15 minutes' },
  { value: '30',  label: '30 minutes' },
  { value: '60',  label: '1 hour' },
  { value: '90',  label: '1 hour 30 min' },
  { value: 'end', label: 'End of episode' },
]

const SUBTITLE_FONT_SIZE: Record<SubtitleSize, string> = {
  small:  '0.875rem',
  medium: '1rem',
  large:  '1.375rem',
  xl:     '1.875rem',
}

export default function VideoPlayer({ job, startPositionTicks, onClose }: Props) {
  const { episodeList, currentEpisodeId, updateJob, setEpisodeList, setCurrentEpisodeId } = usePlayer()
  const { autoplayNext, preferredAudioLang, preferredSubtitleLang, directPlay: settingsDirectPlay, defaultQuality, subtitleSize, subtitleBgOpacity, discordRPC } = useSettings()

  const isDirectPlay = !!job.directStreamUrl

  // Persist audio/subtitle preferences per series (TV) or per item (movie)
  const avPrefsKey = job.seriesId || job.itemId
  function saveAvPrefs(audio: number, sub: number | null) {
    try { localStorage.setItem(`av-prefs-${avPrefsKey}`, JSON.stringify({ audio, sub })) } catch {}
  }
  function loadAvPrefs(): { audio: number; sub: number | null } | null {
    try {
      const raw = localStorage.getItem(`av-prefs-${avPrefsKey}`)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const markedPlayedRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [buffering, setBuffering] = useState(true)
  const [error, setError] = useState('')

  // Sleep timer
  const [sleepOption, setSleepOption] = useState<SleepOption>('off')
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null)

  // Settings panels
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'audio' | 'quality' | 'speed' | 'sleep'>('audio')
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false)
  const [showEpisodePanel, setShowEpisodePanel] = useState(false)
  const [localEpId, setLocalEpId] = useState(currentEpisodeId)

  // Up Next auto-play
  const [upNextVisible, setUpNextVisible] = useState(false)
  const [upNextDismissed, setUpNextDismissed] = useState(false)
  const upNextDismissedRef = useRef(false)

  // OpenSubtitles search
  const [osSearchOpen, setOsSearchOpen] = useState(false)
  const [osQuery, setOsQuery] = useState('')
  const [osSearching, setOsSearching] = useState(false)
  const [osResults, setOsResults] = useState<OsSubtitleResult[]>([])
  const [osError, setOsError] = useState('')
  const [activeOsSubId, setActiveOsSubId] = useState<string | null>(null)

  // Auto-populate OS subtitle query with show name + episode code (e.g. "The Pitt S01E05")
  useEffect(() => {
    if (job.type === 'tv' && episodeList.length > 0) {
      const ep = episodeList.find((e) => e.jellyfinId === localEpId)
      if (ep) {
        const s = String(ep.seasonNumber).padStart(2, '0')
        const e = String(ep.episodeNumber).padStart(2, '0')
        const base = job.seriesName || job.title
        setOsQuery(`${base} S${s}E${e}`)
        return
      }
    }
    setOsQuery(job.seriesName || job.title)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.itemId, localEpId])

  // Track selections
  const [activeAudio, setActiveAudio] = useState(0)
  const [activeSub, setActiveSub] = useState<number | null>(null)
  const [activeQuality, setActiveQuality] = useState(0)
  const [activeSpeed, setActiveSpeed] = useState(1)

  // Subtitle rendering
  const [vttCues, setVttCues] = useState<VttCue[]>([])
  const [activeCue, setActiveCue] = useState<string | null>(null)

  // ─── Derived: next episode in list ─────────────────────────────────────────
  const nextEpisode = (() => {
    if (job.type !== 'tv' || episodeList.length === 0) return null
    const idx = episodeList.findIndex((ep) => ep.jellyfinId === localEpId)
    if (idx === -1 || idx >= episodeList.length - 1) return null
    return episodeList[idx + 1]
  })()

  // ─── Load HLS source ────────────────────────────────────────────────────────

  const loadSrc = useCallback((hlsUrl: string, seekToSeconds?: number) => {
    const video = videoRef.current
    if (!video) return

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (!Hls.isSupported()) {
      // Safari native HLS
      video.src = hlsUrl
      video.load()
      return
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false
    })
    hlsRef.current = hls

    hls.on(Hls.Events.MANIFEST_LOADING, (_e, data) => {
      console.log('[HLS] MANIFEST_LOADING →', data.url)
    })

    hls.on(Hls.Events.MANIFEST_LOADED, (_e, data) => {
      console.log('[HLS] MANIFEST_LOADED — levels:', data.levels?.length ?? 0)
    })

    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      const audioCodecs = data.levels?.map((l: { audioCodec?: string }) => l.audioCodec).filter(Boolean)
      const videoCodecs = data.levels?.map((l: { videoCodec?: string }) => l.videoCodec).filter(Boolean)
      console.log('[HLS] MANIFEST_PARSED — levels:', data.levels?.length,
        '| video codecs:', [...new Set(videoCodecs)].join(', ') || 'none',
        '| audio codecs:', [...new Set(audioCodecs)].join(', ') || 'none')
      const seekTarget = seekToSeconds ?? (startPositionTicks > 0 ? startPositionTicks / 10_000_000 : 0)
      if (seekTarget > 0) video.currentTime = seekTarget
      video.muted = false
      video.volume = video.volume > 0 ? video.volume : 1
      video.play().catch((err) => console.warn('[HLS] play() rejected:', err))
    })

    hls.on(Hls.Events.AUDIO_TRACK_LOADED, (_e, data) => {
      console.log('[HLS] AUDIO_TRACK_LOADED — track:', data.id)
    })

    hls.on(Hls.Events.ERROR, (_e, data) => {
      console.error('[HLS] ERROR —', 'fatal:', data.fatal, '| type:', data.type, '| details:', data.details, '| url:', (data as { url?: string }).url ?? '', data)
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        console.warn('[HLS] Attempting media error recovery…')
        hls.recoverMediaError()
      } else {
        // Network errors: show message instead of retrying indefinitely
        setError(`Stream error (${data.details ?? 'network'}). Please try again.`)
        setBuffering(false)
      }
    })

    hls.loadSource(hlsUrl)
    hls.attachMedia(video)
  }, [startPositionTicks])

  // Initial load
  useEffect(() => {
    const video = videoRef.current

    // Check upfront if we need an audio switch — if so, skip the initial loadSrc
    // to avoid a race condition where HLS.js starts loading the first URL, then
    // the audio switch kills that session and causes a fragLoaderror.
    const savedPrefs = loadAvPrefs()
    let needsAudioSwitch = false
    let targetAudioIndex: number | undefined

    // Priority 1: saved per-series/item audio pref
    if (savedPrefs?.audio && savedPrefs.audio > 0 && job.audioTracks.some((t) => t.index === savedPrefs.audio)) {
      needsAudioSwitch = true
      targetAudioIndex = savedPrefs.audio
    }
    // Priority 2: preferred audio language setting
    else if (preferredAudioLang !== 'auto' && preferredAudioLang !== '' && job.audioTracks.length > 1) {
      const match = job.audioTracks.find(
        (t) => t.language?.toLowerCase().startsWith(preferredAudioLang.toLowerCase()) && !t.isDefault
      )
      if (match) {
        needsAudioSwitch = true
        targetAudioIndex = match.index
      }
    }

    if (job.directStreamUrl) {
      // Direct play: bypass HLS entirely (no audio switching in direct play mode)
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
      if (video) {
        video.src = job.directStreamUrl
        if (startPositionTicks > 0) video.currentTime = startPositionTicks / 10_000_000
        video.muted = false
        video.volume = video.volume > 0 ? video.volume : 1
        video.play().catch(() => {})
      }
    } else if (needsAudioSwitch && targetAudioIndex != null) {
      // Need audio switch — start play-job with correct audio directly, skip initial loadSrc
      setActiveAudio(targetAudioIndex)
      setBuffering(true)
      api.startPlayJob({
        itemId: job.itemId,
        audioStreamIndex: targetAudioIndex,
        maxBitrate: QUALITY_BITRATES[defaultQuality],
        startTimeTicks: startPositionTicks > 0 ? startPositionTicks : undefined,
        previousPlaySessionId: job.playSessionId || undefined,
        previousDeviceId: job.deviceId,
      }).then((newJob) => {
        updateJob(newJob)
        loadSrc(newJob.hlsUrl)
      }).catch(() => {
        // Fallback: load original URL if audio switch fails
        loadSrc(job.hlsUrl)
      })
    } else {
      // No audio switch needed — load directly
      loadSrc(job.hlsUrl)
    }

    // Restore subtitle preference
    let restoredSub = false
    if (savedPrefs?.sub !== null && savedPrefs?.sub !== undefined) {
      const subTrack = job.subtitleTracks.find((t) => t.index === savedPrefs.sub)
      if (subTrack && !subTrack.isImageBased) {
        restoredSub = true
        setActiveSub(subTrack.index)
        const subPath = `/jellyfin/subtitle-vtt/${job.itemId}/${subTrack.index}`
        api.fetchText(subPath).then((text) => setVttCues(parseVttCues(text))).catch(() => {})
      }
    }

    // Auto-select preferred subtitle (text-based only) — only if no saved pref was restored
    if (!restoredSub && preferredSubtitleLang !== 'off' && preferredSubtitleLang !== 'auto' && video) {
      const match = job.subtitleTracks.find(
        (t) => t.language?.toLowerCase().startsWith(preferredSubtitleLang) && !t.isImageBased
      )
      if (match) {
        setActiveSub(match.index)
        const subPath = `/jellyfin/subtitle-vtt/${job.itemId}/${match.index}`
        api.fetchText(subPath).then((text) => setVttCues(parseVttCues(text))).catch(() => {})
      }
    }

    return () => { hlsRef.current?.destroy() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.itemId])

  // ─── Heartbeat ──────────────────────────────────────────────────────────────

  useEffect(() => {
    heartbeatRef.current = setInterval(() => {
      const video = videoRef.current
      if (!video) return
      const curTimeSecs = video.currentTime
      const durSecs = isFinite(video.duration) && video.duration > 0
        ? video.duration
        : (job.durationTicks ?? 0) / 10_000_000
      const isPaused = video.paused

      if (!durSecs) return
      const posTicks = Math.floor(curTimeSecs * 10_000_000)
      const durTicks = Math.floor(durSecs * 10_000_000)
      api.reportProgress({
        itemId: job.itemId,
        positionTicks: posTicks,
        durationTicks: durTicks,
        isPaused,
        playSessionId: job.playSessionId
      }).catch(() => {})
      api.reportUserProgress({
        mediaId: job.itemId,
        positionTicks: posTicks,
        durationTicks: durTicks,
        title: job.seriesName || job.title,
        posterUrl: job.posterUrl,
        type: job.seriesId ? 'tv' : job.type,
        tmdbId: job.tmdbId,
        seriesId: job.seriesId,
      }).catch(() => {})
      // Mark as played in Jellyfin when >90% watched
      const pct = durTicks > 0 ? (posTicks / durTicks) * 100 : 0
      if (pct > 90 && !markedPlayedRef.current) {
        markedPlayedRef.current = true
        api.markItemPlayed(job.itemId).catch(() => {})
      }
    }, 10_000)

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [job])

  // ─── Sleep timer countdown ───────────────────────────────────────────────────

  // Start/reset countdown when option changes
  useEffect(() => {
    if (sleepOption === 'off' || sleepOption === 'end') {
      setSleepRemaining(null)
      return
    }
    setSleepRemaining(parseInt(sleepOption) * 60)
  }, [sleepOption])

  // Tick once per second
  useEffect(() => {
    if (sleepRemaining === null || sleepRemaining <= 0) return
    const t = setTimeout(() => setSleepRemaining((prev) => (prev !== null ? prev - 1 : null)), 1000)
    return () => clearTimeout(t)
  }, [sleepRemaining])

  // Stop heartbeat + report stop on unmount
  const handleClose = useCallback(() => {
    // Report final position
    let curTimeSecs = 0
    let durSecs = (job.durationTicks ?? 0) / 10_000_000

    const video = videoRef.current
    if (video) {
      video.pause()
      curTimeSecs = video.currentTime
      durSecs = isFinite(video.duration) && video.duration > 0 ? video.duration : durSecs
    }

    const posTicks = Math.floor(curTimeSecs * 10_000_000)
    const durTicks = Math.floor(durSecs * 10_000_000)
    if (durTicks > 0) {
      api.reportProgress({
        itemId: job.itemId,
        positionTicks: posTicks,
        durationTicks: durTicks,
        isPaused: true,
        playSessionId: job.playSessionId,
        isStopped: true
      }).catch(() => {})
      api.reportUserProgress({
        mediaId: job.itemId,
        positionTicks: posTicks,
        durationTicks: durTicks,
        title: job.seriesName || job.title,
        posterUrl: job.posterUrl,
        type: job.seriesId ? 'tv' : job.type,
        tmdbId: job.tmdbId,
        seriesId: job.seriesId,
        isStopped: true,
      }).catch(() => {})
    }
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    hlsRef.current?.destroy()
    if (discordRPC) window.electronAPI.discord.clearActivity().catch(() => {})
    onClose()
  }, [job, onClose])

  // Fire sleep action when countdown reaches 0
  useEffect(() => {
    if (sleepRemaining !== 0) return
    setSleepRemaining(null)
    setSleepOption('off')
    handleClose()
    setTimeout(() => window.electronAPI.system.sleep().catch(() => {}), 800)
  }, [sleepRemaining, handleClose])

  // ─── Discord Rich Presence ──────────────────────────────────────────────────

  function updateDiscordPresence(isPaused: boolean): void {
    const video = videoRef.current
    const currentTimeSecs = video?.currentTime ?? 0
    const durationSecs = (video && isFinite(video.duration) && video.duration > 0)
      ? video.duration
      : (job.durationTicks ?? 0) / 10_000_000
    const hasDuration = durationSecs > 0

    // ── Build details (line 1) — just the show/movie name ────────────────────
    let details: string = job.seriesName || job.title
    if (details.length > 128) details = details.slice(0, 125) + '...'

    // ── Resolve episode label (S01E05 - Title) ────────────────────────────────
    let epLabel = ''
    if (job.type === 'tv' && episodeList.length > 0) {
      const ep = episodeList.find((e) => e.jellyfinId === localEpId)
      if (ep) {
        const s = String(ep.seasonNumber).padStart(2, '0')
        const e = String(ep.episodeNumber).padStart(2, '0')
        epLabel = `S${s}E${e} - ${ep.title || 'Episode ' + ep.episodeNumber}`
      }
    }

    // ── Build state (line 2) ─────────────────────────────────────────────────
    // Playing: "S01E05 - Episode Title" (TV) or show/movie title
    // Paused: "Paused · current / total"
    let state: string
    if (isPaused) {
      const pos = hasDuration ? `${fmt(currentTimeSecs)} / ${fmt(durationSecs)}` : fmt(currentTimeSecs)
      state = `Paused · ${pos}`
    } else {
      state = epLabel || (job.seriesName || job.title)
    }
    if (state.length < 2) state = '  '  // Discord minimum 2 chars

    // ── Timestamps ───────────────────────────────────────────────────────────
    // Playing with known duration: endTimestamp so Discord shows "X:XX left"
    // Playing without duration: startTimestamp so Discord shows "X:XX elapsed"
    // Paused: no timestamp
    const nowSec = Math.floor(Date.now() / 1000)
    let startTimestamp: number | undefined
    let endTimestamp: number | undefined
    if (!isPaused) {
      if (hasDuration) {
        endTimestamp = nowSec + Math.max(0, Math.floor(durationSecs - currentTimeSecs))
      } else {
        startTimestamp = nowSec - Math.floor(currentTimeSecs)
      }
    }

    if (!discordRPC) return
    window.electronAPI.discord.setActivity({
      details,
      state,
      startTimestamp,
      endTimestamp,
      largeImageKey: job.posterUrl || 'logo',
      largeImageText: job.seriesName || job.title,
      smallImageKey: job.posterUrl ? 'logo' : undefined,
      smallImageText: job.posterUrl ? 'VALOR' : undefined,
      instance: false,
      buttons: [{ label: 'Get VALOR', url: 'https://valor.dawn-star.co.uk/downloads/' }],
    }).catch(() => {})
  }

  // ─── Video event handlers ───────────────────────────────────────────────────

  function onTimeUpdate() {
    const video = videoRef.current
    if (!video) return
    setCurrentTime(video.currentTime)

    // Subtitle cue matching
    if (vttCues.length) {
      const cue = vttCues.find(
        (c) => video.currentTime >= c.start && video.currentTime <= c.end
      )
      setActiveCue(cue?.text ?? null)
    }

    // Up Next trigger — 2 min before end for TV episodes
    if (nextEpisode && autoplayNext && !upNextDismissedRef.current) {
      const durSecs = isFinite(video.duration) && video.duration > 0
        ? video.duration
        : (job.durationTicks ?? 0) / 10_000_000
      if (durSecs > 0) {
        const remaining = durSecs - video.currentTime
        if (remaining <= 120 && remaining > 0) {
          if (!upNextVisible) setUpNextVisible(true)
        } else if (upNextVisible) {
          // User seeked back past threshold
          setUpNextVisible(false)
        }
      }
    }
  }

  function onDurationChange() {
    if (videoRef.current) setDuration(videoRef.current.duration)
  }

  function onPlay() {
    setPlaying(true)
    setBuffering(false)
    updateDiscordPresence(false)
    // After a long pause (>30 s) on HLS streams, the A/V decoder can drift out of
    // sync. A small backward seek forces the demuxer to re-sync before playback resumes.
    if (!isDirectPlay && pausedAtRef.current !== null) {
      const pausedMs = Date.now() - pausedAtRef.current
      if (pausedMs > 30_000) {
        const video = videoRef.current
        if (video && isFinite(video.currentTime) && video.currentTime > 1) {
          video.currentTime = video.currentTime - 0.5
        }
      }
    }
    pausedAtRef.current = null
  }
  function onPause() {
    setPlaying(false)
    pausedAtRef.current = Date.now()
    updateDiscordPresence(true)
  }
  function onWaiting() { setBuffering(true) }
  function onPlaying() { setBuffering(false) }

  function onEnded() {
    // Mark as played when video reaches the end
    if (!markedPlayedRef.current) {
      markedPlayedRef.current = true
      api.markItemPlayed(job.itemId).catch(() => {})
    }
    // Sleep timer takes priority over autoplay
    if (sleepOption === 'end') {
      handleClose()
      setTimeout(() => window.electronAPI.system.sleep().catch(() => {}), 800)
      return
    }
    // Up Next auto-advance (if not dismissed)
    if (nextEpisode && autoplayNext && !upNextDismissedRef.current) {
      switchEpisode(nextEpisode)
      return
    }
    // Legacy fallback
    if (!autoplayNext || episodeList.length === 0) return
    const currentIdx = episodeList.findIndex((ep) => ep.jellyfinId === localEpId)
    if (currentIdx === -1 || currentIdx >= episodeList.length - 1) return
    switchEpisode(episodeList[currentIdx + 1])
  }

  // ─── Controls ───────────────────────────────────────────────────────────────

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play() : v.pause()
  }

  function seek(delta: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta))
  }

  function seekTo(frac: number) {
    const v = videoRef.current
    if (!v || !v.duration) return
    v.currentTime = frac * v.duration
  }

  function changeVolume(val: number) {
    const v = videoRef.current
    if (!v) return
    v.volume = val
    setVolume(val)
    setMuted(val === 0)
  }

  function toggleMute() {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  function toggleFullscreen() {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen()
      setFullscreen(true)
    } else {
      document.exitFullscreen()
      setFullscreen(false)
    }
  }

  // ─── Track / quality switching ──────────────────────────────────────────────

  async function switchAudio(track: AudioTrack) {
    const savedTime = videoRef.current?.currentTime ?? 0
    setActiveAudio(track.index)
    saveAvPrefs(track.index, activeSub)
    setShowSettings(false)
    setBuffering(true)
    try {
      // Audio switching always requires transcoding — never send directPlay: true
      const newJob = await api.startPlayJob({
        itemId: job.itemId,
        audioStreamIndex: track.index,
        maxBitrate: QUALITY_PRESETS[activeQuality].maxBitrate || undefined,
        startTimeTicks: savedTime > 0 ? Math.floor(savedTime * 10_000_000) : undefined,
        previousPlaySessionId: job.playSessionId || undefined,
        previousDeviceId: job.deviceId,
      })
      updateJob(newJob)
      loadSrc(newJob.hlsUrl, savedTime)
    } catch {
      setError('Failed to switch audio track')
    }
  }

  async function switchSubtitle(track: SubtitleTrack | null) {
    setActiveSub(track?.index ?? null)
    saveAvPrefs(activeAudio, track?.index ?? null)
    setVttCues([])
    setActiveCue(null)
    setActiveOsSubId(null)
    if (!track) return

    if (track.isImageBased) {
      // Image-based (PGS) → server-side burn-in via stream restart
      const savedTime = videoRef.current?.currentTime ?? 0
      setBuffering(true)
      try {
        const newJob = await api.startPlayJob({
          itemId: job.itemId,
          subtitleStreamIndex: track.index,
          audioStreamIndex: activeAudio,
          maxBitrate: QUALITY_PRESETS[activeQuality].maxBitrate || undefined,
          startTimeTicks: savedTime > 0 ? Math.floor(savedTime * 10_000_000) : undefined,
          previousPlaySessionId: job.playSessionId || undefined,
          previousDeviceId: job.deviceId,
        })
        updateJob(newJob)
        loadSrc(newJob.hlsUrl, savedTime)
      } catch {
        setError('Failed to switch subtitle')
      }
      return
    }

    // VTT subtitle → fetch via backend proxy (requires auth)
    const subPath = `/jellyfin/subtitle-vtt/${job.itemId}/${track.index}`
    try {
      const text = await api.fetchText(subPath)
      setVttCues(parseVttCues(text))
    } catch {
      // Don't block playback — just deactivate the subtitle track
      setActiveSub(null)
    }
  }

  async function switchQuality(preset: typeof QUALITY_PRESETS[number], index: number) {
    const savedTime = videoRef.current?.currentTime ?? 0
    setActiveQuality(index)
    setShowSettings(false)
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: job.itemId,
        maxBitrate: preset.maxBitrate || undefined,
        audioStreamIndex: activeAudio,
        startTimeTicks: savedTime > 0 ? Math.floor(savedTime * 10_000_000) : undefined,
        previousPlaySessionId: job.playSessionId || undefined,
        previousDeviceId: job.deviceId,
      })
      updateJob(newJob)
      loadSrc(newJob.hlsUrl, savedTime)
    } catch {
      setError('Failed to switch quality')
    }
  }

  function changeSpeed(speed: number) {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = speed
    setActiveSpeed(speed)
  }

  async function switchToTranscoded() {
    const savedTime = videoRef.current?.currentTime ?? 0
    setShowSettings(false)
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: job.itemId,
        maxBitrate: QUALITY_BITRATES[defaultQuality],
        startTimeTicks: savedTime > 0 ? Math.floor(savedTime * 10_000_000) : undefined,
      })
      updateJob(newJob)
      loadSrc(newJob.hlsUrl, savedTime)
    } catch {
      setError('Failed to switch to transcoded stream')
      setBuffering(false)
    }
  }

  async function switchEpisode(ep: EpisodeInfo) {
    // Reset Up Next state
    setUpNextVisible(false)
    setUpNextDismissed(false)
    upNextDismissedRef.current = false
    markedPlayedRef.current = false

    setShowEpisodePanel(false)
    setBuffering(true)
    setLocalEpId(ep.jellyfinId)
    try {
      const newJob = await api.startPlayJob({
        itemId: ep.jellyfinId,
        directPlay: settingsDirectPlay,
        maxBitrate: settingsDirectPlay ? undefined : QUALITY_BITRATES[defaultQuality],
        previousPlaySessionId: job.playSessionId || undefined,
        previousDeviceId: job.deviceId,
      })
      updateJob(newJob)

      if (newJob.directStreamUrl) {
        const video = videoRef.current
        if (video) {
          video.src = newJob.directStreamUrl
          video.currentTime = 0
          video.muted = false
          video.volume = video.volume > 0 ? video.volume : 1
          video.play().catch(() => {})
        }
        setBuffering(false)
      } else {
        loadSrc(newJob.hlsUrl, 0)
      }
    } catch {
      setError('Failed to load episode')
      setBuffering(false)
    }
  }

  // ─── OpenSubtitles ──────────────────────────────────────────────────────────

  async function searchOsSubs(query?: string) {
    setOsSearching(true)
    setOsError('')
    setOsResults([])
    try {
      // Find current episode's season/episode numbers for precise matching
      const curEp = job.type === 'tv' && episodeList.length > 0
        ? episodeList.find((e) => e.jellyfinId === localEpId)
        : null
      const results = await api.searchSubtitles({
        query: query || osQuery.trim() || undefined,
        tmdbId: job.tmdbId ?? undefined,
        type: job.type === 'tv' ? 'tv' : 'movie',
        season: curEp?.seasonNumber,
        episode: curEp?.episodeNumber,
      })
      // Sort by download count descending (most popular first)
      results.sort((a, b) => b.downloadCount - a.downloadCount)
      setOsResults(results)
      if (results.length === 0 && query) setOsError('No subtitles found')
    } catch {
      if (query) setOsError('Search failed')
    } finally {
      setOsSearching(false)
    }
  }

  // Auto-fetch OpenSubtitles on player open (Stremio-style)
  // For TV: wait until episodeList is populated so season/episode numbers are available
  const osFetchedRef = useRef(false)
  useEffect(() => {
    if (osFetchedRef.current) return
    if (job.type === 'tv' && episodeList.length === 0) return // wait for episode list
    osFetchedRef.current = true
    searchOsSubs(job.seriesName || job.title)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.itemId, episodeList.length])

  // Reset auto-fetch flag on episode switch
  useEffect(() => {
    osFetchedRef.current = false
  }, [localEpId])

  // Auto-fetch episode list when opened for a TV show without episodes (e.g. from Continue Watching)
  useEffect(() => {
    if (episodeList.length > 0 || job.type !== 'tv' || !job.seriesId) return
    let cancelled = false
    ;(async () => {
      try {
        const seasons = await api.getSeasons(job.seriesId!)
        if (cancelled || seasons.length === 0) return
        // Find the season that contains the current episode — try each season
        for (const season of seasons) {
          const eps = await api.getEpisodes(job.seriesId!, season.id)
          if (cancelled) return
          const match = eps.find((e) => e.jellyfinId === job.itemId)
          if (match) {
            const epInfos: EpisodeInfo[] = eps
              .filter((e) => e.onDemand && e.jellyfinId)
              .map((e) => ({
                jellyfinId: e.jellyfinId!,
                title: e.name,
                episodeNumber: e.episodeNumber,
                seasonNumber: e.seasonNumber,
                playedPercentage: e.playedPercentage,
              }))
            setEpisodeList(epInfos)
            setCurrentEpisodeId(job.itemId)
            setLocalEpId(job.itemId)
            break
          }
        }
      } catch {}
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.itemId])

  // Auto-select from OpenSubtitles when results arrive (if no subtitle already active)
  const osAutoSelectedRef = useRef(false)
  useEffect(() => {
    if (osAutoSelectedRef.current) return
    if (osResults.length === 0) return
    // Don't auto-select if user already has a subtitle active
    if (activeSub !== null || activeOsSubId !== null) return
    // Don't auto-select if preferred lang is off
    if (preferredSubtitleLang === 'off') return
    // Check if an embedded track already matched (it would have been set in the init effect)
    const hasEmbeddedMatch = preferredSubtitleLang !== 'auto' && job.subtitleTracks.some(
      (t) => t.language?.toLowerCase().startsWith(preferredSubtitleLang) && !t.isImageBased
    )
    if (hasEmbeddedMatch) return
    // Find a matching OS result
    const lang = preferredSubtitleLang === 'auto' ? 'en' : preferredSubtitleLang
    const match = osResults.find(
      (s) => s.language?.toLowerCase().startsWith(lang) && s.fileId
    )
    if (match) {
      osAutoSelectedRef.current = true
      applyOsSub(match)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osResults])

  async function applyOsSub(sub: OsSubtitleResult) {
    if (!sub.fileId) { setOsError('No file ID for this subtitle'); return }
    setVttCues([])
    setActiveCue(null)
    setActiveSub(null)
    setOsError('')
    try {
      const vttText = await api.downloadSubtitle(sub.fileId, sub.language)
      setVttCues(parseVttCues(vttText))
      setActiveOsSubId(sub.id)
      setShowSubtitlePanel(false)
    } catch {
      setOsError('Failed to download subtitle')
      setActiveOsSubId(null)
    }
  }

  // ─── Controls auto-hide ─────────────────────────────────────────────────────

  function showControls() {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!showSettings && !showSubtitlePanel && !showEpisodePanel) setControlsVisible(false)
    }, 3000)
  }

  // ─── Format helpers ─────────────────────────────────────────────────────────

  function fmt(sec: number) {
    if (!sec || isNaN(sec)) return '0:00'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const progress = duration > 0 ? currentTime / duration : 0

  // ─── Gamepad / controller support (TV-remote style) ────────────────────────
  // Any DPad input shows HUD. Two focus rows: seek bar + controls bar.
  // DPad up/down moves between rows. Left/right seeks (on seek row) or
  // navigates buttons (on controls row). When a panel is open, DPad navigates
  // within the panel. Volume button opens a vertical slider popup.
  //
  // Focus zones: 'none' | 'seek' | 'controls' | 'panel' | 'volume' | 'upnext'

  const currentEpIdx = episodeList.findIndex((ep) => ep.jellyfinId === localEpId)
  const gpFocusRef = useRef<HTMLElement | null>(null)
  const [gpZone, setGpZone] = useState<'none' | 'seek' | 'controls' | 'panel' | 'volume' | 'upnext'>('none')
  const [gpControlIdx, setGpControlIdx] = useState(0)
  const [showVolumePopup, setShowVolumePopup] = useState(false)
  const panelOpen = showSettings || showSubtitlePanel || showEpisodePanel
  const seekHoldCount = useRef(0)

  const gpSetFocus = useCallback((el: HTMLElement | null) => {
    if (gpFocusRef.current) gpFocusRef.current.classList.remove('gp-focused')
    gpFocusRef.current = el
    if (el) {
      el.classList.add('gp-focused')
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }, [])

  // Clear gamepad focus on mouse move inside player
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const onMouse = () => {
      gpSetFocus(null)
      setGpZone('none')
      setShowVolumePopup(false)
    }
    c.addEventListener('mousemove', onMouse, { passive: true })
    return () => c.removeEventListener('mousemove', onMouse)
  }, [gpSetFocus])

  // Get visible panel focusable items
  const gpGetPanelItems = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return []
    // Find the active panel container (settings, subtitle, or episode panel)
    const panels = containerRef.current.querySelectorAll<HTMLElement>('.z-30 [data-focusable]')
    return Array.from(panels).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
  }, [])

  // Get control bar buttons (data-gp-control)
  const gpGetControlButtons = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return []
    return Array.from(containerRef.current.querySelectorAll<HTMLElement>('[data-gp-control]')).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
  }, [])

  // Spatial nav within panel
  const gpPanelMove = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    const items = gpGetPanelItems()
    if (items.length === 0) return
    const current = gpFocusRef.current
    if (!current || !items.includes(current)) {
      gpSetFocus(items[0])
      return
    }
    const from = current.getBoundingClientRect()
    const fc = { x: from.left + from.width / 2, y: from.top + from.height / 2 }
    let best: HTMLElement | null = null
    let bestScore = Infinity
    for (const el of items) {
      if (el === current) continue
      const r = el.getBoundingClientRect()
      const tc = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      if (dir === 'up' && tc.y >= fc.y - 1) continue
      if (dir === 'down' && tc.y <= fc.y + 1) continue
      if (dir === 'left' && tc.x >= fc.x - 1) continue
      if (dir === 'right' && tc.x <= fc.x + 1) continue
      const mainDist = (dir === 'up' || dir === 'down') ? Math.abs(tc.y - fc.y) : Math.abs(tc.x - fc.x)
      const crossDist = (dir === 'up' || dir === 'down') ? Math.abs(tc.x - fc.x) : Math.abs(tc.y - fc.y)
      const score = mainDist + crossDist * 3
      if (score < bestScore) { bestScore = score; best = el }
    }
    if (best) gpSetFocus(best)
  }, [gpGetPanelItems, gpSetFocus])

  // Main DPad handler
  const gpDpad = useCallback((dir: 'up' | 'down' | 'left' | 'right', isRepeat = false) => {
    showControls()

    // Volume popup mode: up/down adjusts volume, any other direction closes
    if (gpZone === 'volume' && showVolumePopup) {
      if (dir === 'up') {
        changeVolume(Math.min(1, (muted ? 0 : volume) + 0.05))
        if (muted) setMuted(false)
      } else if (dir === 'down') {
        changeVolume(Math.max(0, (muted ? 0 : volume) - 0.05))
      } else {
        // Left/right exits volume popup back to controls
        setShowVolumePopup(false)
        setGpZone('controls')
      }
      return
    }

    // Up Next overlay: navigate between Play Now and Dismiss buttons
    if (upNextVisible && nextEpisode) {
      if (gpZone !== 'upnext') {
        setGpZone('upnext')
        const playBtn = containerRef.current?.querySelector<HTMLElement>('[data-upnext-play]')
        if (playBtn) gpSetFocus(playBtn)
        return
      }
      // Left/right switches between Play Now and Dismiss
      if (dir === 'left' || dir === 'right') {
        const overlay = containerRef.current?.querySelector<HTMLElement>('[data-upnext-overlay]')
        if (overlay) {
          const btns = Array.from(overlay.querySelectorAll<HTMLElement>('[data-focusable]'))
          const idx = btns.indexOf(gpFocusRef.current!)
          const next = dir === 'right' ? Math.min(btns.length - 1, idx + 1) : Math.max(0, idx - 1)
          gpSetFocus(btns[next])
        }
      }
      return
    }

    // Panel mode: spatial navigation
    if (panelOpen) {
      if (gpZone !== 'panel') {
        setGpZone('panel')
        const items = gpGetPanelItems()
        if (items.length > 0) gpSetFocus(items[0])
        return
      }
      gpPanelMove(dir)
      return
    }

    // No HUD visible yet — show it and focus controls
    if (gpZone === 'none') {
      setGpZone('controls')
      // Focus first control button
      const btns = gpGetControlButtons()
      if (btns.length > 0) {
        setGpControlIdx(0)
        gpSetFocus(btns[0])
      }
      return
    }

    // Seek bar row
    if (gpZone === 'seek') {
      if (dir === 'left' || dir === 'right') {
        if (isRepeat) seekHoldCount.current++
        else seekHoldCount.current = 0
        const delta = seekHoldCount.current > 3 ? 30 : 10
        seek(dir === 'left' ? -delta : delta)
      } else if (dir === 'down') {
        setGpZone('controls')
        gpSetFocus(null)
        const btns = gpGetControlButtons()
        if (btns.length > 0) {
          const idx = Math.min(gpControlIdx, btns.length - 1)
          setGpControlIdx(idx)
          gpSetFocus(btns[idx])
        }
      }
      // Up from seek = do nothing (top row)
      return
    }

    // Controls bar row
    if (gpZone === 'controls') {
      if (dir === 'left' || dir === 'right') {
        const btns = gpGetControlButtons()
        if (btns.length === 0) return
        const nextIdx = dir === 'left'
          ? Math.max(0, gpControlIdx - 1)
          : Math.min(btns.length - 1, gpControlIdx + 1)
        setGpControlIdx(nextIdx)
        gpSetFocus(btns[nextIdx])
      } else if (dir === 'up') {
        // Move to seek bar
        setGpZone('seek')
        gpSetFocus(null) // Seek bar uses its own highlight, not gp-focused on a button
      } else if (dir === 'down') {
        // Hide controls
        setGpZone('none')
        gpSetFocus(null)
        setControlsVisible(false)
      }
      return
    }
  }, [gpZone, panelOpen, showVolumePopup, volume, muted, gpControlIdx,
      upNextVisible, nextEpisode,
      gpGetControlButtons, gpGetPanelItems, gpSetFocus, gpPanelMove])

  const gpActivate = useCallback(() => {
    // Volume popup: A closes it
    if (gpZone === 'volume' && showVolumePopup) {
      setShowVolumePopup(false)
      setGpZone('controls')
      return
    }
    // Up Next: click focused button (Play Now or Dismiss)
    if (gpZone === 'upnext' && gpFocusRef.current && document.body.contains(gpFocusRef.current)) {
      gpFocusRef.current.click()
      return
    }
    // Panel: click focused item
    if (gpZone === 'panel' && gpFocusRef.current && document.body.contains(gpFocusRef.current)) {
      gpFocusRef.current.click()
      return
    }
    // Controls: click focused button
    if (gpZone === 'controls' && gpFocusRef.current && document.body.contains(gpFocusRef.current)) {
      gpFocusRef.current.click()
      return
    }
    // Seek bar or none: play/pause
    togglePlay()
  }, [gpZone, showVolumePopup, togglePlay])

  const gpBack = useCallback(() => {
    gpSetFocus(null)
    // Up Next overlay visible — close player directly
    if (upNextVisible && gpZone === 'upnext') {
      upNextDismissedRef.current = true
      setUpNextDismissed(true)
      setUpNextVisible(false)
      setControlsVisible(false)
      setGpZone('none')
      handleClose()
      return
    }
    // Close volume popup
    if (showVolumePopup) { setShowVolumePopup(false); setGpZone('controls'); return }
    // Close panels
    if (showSettings) { setShowSettings(false); setGpZone('controls'); return }
    if (showSubtitlePanel) { setShowSubtitlePanel(false); setGpZone('controls'); return }
    if (showEpisodePanel) { setShowEpisodePanel(false); setGpZone('controls'); return }
    // Nothing open — close the player directly
    setControlsVisible(false)
    setGpZone('none')
    handleClose()
  }, [showVolumePopup, showSettings, showSubtitlePanel, showEpisodePanel,
      upNextVisible, gpZone, controlsVisible, handleClose, gpSetFocus])

  // When panels open/close, sync zone
  useEffect(() => {
    if (panelOpen) setGpZone('panel')
    else if (gpZone === 'panel') setGpZone('controls')
  }, [panelOpen])

  // Auto-focus Up Next "Play Now" button when overlay appears (gamepad users)
  useEffect(() => {
    if (upNextVisible && gpZone !== 'none') {
      setGpZone('upnext')
      // Small delay to let the overlay render
      setTimeout(() => {
        const playBtn = containerRef.current?.querySelector<HTMLElement>('[data-upnext-play]')
        if (playBtn) gpSetFocus(playBtn)
      }, 100)
    } else if (!upNextVisible && gpZone === 'upnext') {
      setGpZone('none')
      gpSetFocus(null)
    }
  }, [upNextVisible])

  // Volume popup opener (called from volume button click)
  const openVolumePopup = useCallback(() => {
    setShowVolumePopup(true)
    setGpZone('volume')
  }, [])

  useGamepad({
    buttons: {
      0:  { onPress: gpActivate },                                             // A — activate / play-pause
      1:  { onPress: gpBack },                                                 // B — close panel / HUD / player
      2:  { onPress: toggleMute },                                             // X — mute
      3:  { onPress: toggleFullscreen },                                       // Y — fullscreen
      4:  { onPress: () => { if (currentEpIdx > 0) switchEpisode(episodeList[currentEpIdx - 1]) } },         // LB — prev episode
      5:  { onPress: () => { if (currentEpIdx < episodeList.length - 1) switchEpisode(episodeList[currentEpIdx + 1]) } }, // RB — next episode
      6:  { onPress: () => { seek(-30); showControls() } },                    // LT — big skip back
      7:  { onPress: () => { seek(30); showControls() } },                     // RT — big skip forward
      12: { onPress: () => gpDpad('up'),    onRepeat: () => gpDpad('up', true),    repeatDelay: 400, repeatInterval: 150 }, // DPad Up
      13: { onPress: () => gpDpad('down'),  onRepeat: () => gpDpad('down', true),  repeatDelay: 400, repeatInterval: 150 }, // DPad Down
      14: { onPress: () => gpDpad('left'),  onRepeat: () => gpDpad('left', true),  repeatDelay: 400, repeatInterval: 150 }, // DPad Left
      15: { onPress: () => gpDpad('right'), onRepeat: () => gpDpad('right', true), repeatDelay: 400, repeatInterval: 150 }, // DPad Right
    },
    axes: [
      { axis: 0, direction: 'negative', onPress: () => gpDpad('left'),  onRepeat: () => gpDpad('left', true),  repeatDelay: 400, repeatInterval: 150 },
      { axis: 0, direction: 'positive', onPress: () => gpDpad('right'), onRepeat: () => gpDpad('right', true), repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'negative', onPress: () => gpDpad('up'),    onRepeat: () => gpDpad('up', true),    repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'positive', onPress: () => gpDpad('down'),  onRepeat: () => gpDpad('down', true),  repeatDelay: 400, repeatInterval: 150 },
    ],
    onAnyInput: showControls,
  })

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't steal keystrokes from input fields (e.g. OS subtitle search box)
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft') seek(-10)
      else if (e.key === 'ArrowRight') seek(10)
      else if (e.key === 'ArrowUp') changeVolume(Math.min(1, volume + 0.1))
      else if (e.key === 'ArrowDown') changeVolume(Math.max(0, volume - 0.1))
      else if (e.key === 'f') toggleFullscreen()
      else if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [volume, handleClose])

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[100] bg-black flex flex-col"
      onMouseMove={showControls}
      onClick={() => { if (!showSettings) togglePlay() }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="flex-1 w-full object-contain"
        onTimeUpdate={onTimeUpdate}
        onDurationChange={onDurationChange}
        onPlay={onPlay}
        onPause={onPause}
        onWaiting={onWaiting}
        onPlaying={onPlaying}
        onEnded={onEnded}
        playsInline
      />

      {/* Buffering spinner */}
      {buffering && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 size={48} className="text-white/60 animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setError(''); loadSrc(job.hlsUrl) }}
              className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Up Next overlay */}
      {upNextVisible && nextEpisode && (
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute bottom-24 right-6 z-50 w-72 bg-black/90 backdrop-blur-md
                     rounded-xl border border-white/10 p-4 shadow-2xl"
          data-upnext-overlay
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">
              Up Next
            </span>
            <button
              data-focusable
              data-upnext-dismiss
              onClick={() => {
                upNextDismissedRef.current = true
                setUpNextDismissed(true)
                setUpNextVisible(false)
              }}
              className="text-white/40 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-white text-sm font-medium truncate">{nextEpisode.title}</p>
          <p className="text-white/40 text-xs mt-0.5">
            S{String(nextEpisode.seasonNumber).padStart(2, '0')}E{String(nextEpisode.episodeNumber).padStart(2, '0')}
          </p>
          <div className="flex items-center gap-3 mt-3">
            <button
              data-focusable
              data-upnext-play
              onClick={() => switchEpisode(nextEpisode)}
              className="flex-1 px-3 py-1.5 bg-white text-black text-xs font-semibold
                         rounded-lg hover:bg-white/90 transition-colors"
            >
              Play Now
            </button>
            <span className="text-white/30 text-xs tabular-nums">
              {(() => {
                const video = videoRef.current
                const durSecs = video && isFinite(video.duration) && video.duration > 0
                  ? video.duration
                  : (job.durationTicks ?? 0) / 10_000_000
                const remaining = Math.max(0, Math.ceil(durSecs - currentTime))
                return `${remaining}s`
              })()}
            </span>
          </div>
        </motion.div>
      )}

      {/* Subtitle cue overlay */}
      {activeCue && (
        <div className="absolute bottom-24 left-0 right-0 flex justify-center pointer-events-none px-8">
          <div
            className="px-3 py-1.5 rounded text-white text-center max-w-2xl"
            style={{
              backgroundColor: `rgba(0,0,0,${subtitleBgOpacity})`,
              fontSize: SUBTITLE_FONT_SIZE[subtitleSize],
            }}
          >
            {activeCue.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* Close button — always visible (ghost when controls hidden) */}
      <button
        onClick={(e) => { e.stopPropagation(); handleClose() }}
        className={`absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-black/50
                    flex items-center justify-center transition-opacity duration-300
                    hover:bg-black/80 ${controlsVisible ? 'opacity-100' : 'opacity-10 hover:opacity-80'}`}
      >
        <X size={18} className="text-white" />
      </button>

      {/* Skip Intro / Skip Credits buttons */}
      {job.introStartSec != null && job.introEndSec != null &&
        currentTime >= job.introStartSec && currentTime < job.introEndSec && (
        <button
          onClick={() => {
            const v = videoRef.current
            if (v && job.introEndSec != null) v.currentTime = job.introEndSec
          }}
          className="absolute bottom-24 right-6 z-20 px-5 py-2.5 rounded-lg
                     bg-white/15 backdrop-blur-sm border border-white/30
                     text-white text-sm font-medium hover:bg-white/25 transition-colors"
        >
          Skip Intro
        </button>
      )}
      {job.creditsStartSec != null && currentTime >= job.creditsStartSec && (
        <button
          onClick={() => {
            if (nextEpisode) {
              switchEpisode(nextEpisode)
            } else {
              const v = videoRef.current
              if (v) v.currentTime = v.duration
            }
          }}
          className="absolute bottom-24 right-6 z-20 px-5 py-2.5 rounded-lg
                     bg-white/15 backdrop-blur-sm border border-white/30
                     text-white text-sm font-medium hover:bg-white/25 transition-colors"
        >
          {nextEpisode ? 'Next Episode' : 'Skip Credits'}
        </button>
      )}

      {/* Controls overlay */}
      <motion.div
        animate={{ opacity: controlsVisible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-16
                   bg-gradient-to-t from-black/90 via-black/40 to-transparent"
        style={{ pointerEvents: controlsVisible ? 'auto' : 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <p className="text-white font-semibold text-sm mb-3 truncate">{job.title}</p>

        {/* Progress bar — highlighted when gamepad is on seek row */}
        <div
          className={`relative h-1.5 rounded-full mb-4 cursor-pointer group/seek transition-all ${
            gpZone === 'seek' ? 'h-2.5 bg-white/30' : 'bg-white/20'
          }`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            seekTo((e.clientX - rect.left) / rect.width)
          }}
        >
          <div
            className="absolute top-0 left-0 h-full bg-red-500 rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5
                       bg-white rounded-full transition ${
                         gpZone === 'seek' ? 'opacity-100 scale-125' : 'opacity-0 group-hover/seek:opacity-100'
                       }`}
            style={{ left: `${progress * 100}%` }}
          />
          {/* Seek bar gamepad hint */}
          {gpZone === 'seek' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-white/60 text-[10px] whitespace-nowrap">
              ◀ {fmt(currentTime)} ▶
            </div>
          )}
        </div>

        {/* Control row */}
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button data-gp-control data-focusable onClick={togglePlay} className="text-white hover:text-white/80 transition">
            {playing ? <Pause size={22} /> : <Play size={22} fill="white" />}
          </button>

          {/* Skip back/forward */}
          <button data-gp-control data-focusable onClick={() => seek(-10)} className="text-white/70 hover:text-white transition">
            <SkipBack size={18} />
          </button>
          <button data-gp-control data-focusable onClick={() => seek(10)} className="text-white/70 hover:text-white transition">
            <SkipForward size={18} />
          </button>

          {/* Volume — button for gamepad, inline slider for mouse */}
          <div className="relative flex items-center gap-1">
            <button
              data-gp-control
              data-focusable
              onClick={() => {
                // Gamepad click opens volume popup; mouse toggles mute
                if (gpZone === 'controls') {
                  openVolumePopup()
                } else {
                  toggleMute()
                }
              }}
              className="text-white/70 hover:text-white transition"
            >
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            {/* Inline slider — hidden when gamepad volume popup is active */}
            {!showVolumePopup && (
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="w-20 accent-red-500"
              />
            )}
            {/* Gamepad vertical volume popup */}
            {showVolumePopup && (
              <div
                className="absolute bottom-full left-0 mb-3 w-10 bg-black/90 backdrop-blur-md
                           rounded-xl border border-white/15 py-3 flex flex-col items-center gap-1.5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-white/70 text-[10px] tabular-nums font-medium">
                  {Math.round((muted ? 0 : volume) * 100)}
                </span>
                <div className="relative w-1.5 h-28 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-red-500 rounded-full transition-all"
                    style={{ height: `${(muted ? 0 : volume) * 100}%` }}
                  />
                </div>
                <span className="text-white/30 text-[9px]">VOL</span>
              </div>
            )}
          </div>

          {/* Time */}
          <span className="text-white/60 text-xs tabular-nums ml-1">
            {fmt(currentTime)} / {fmt(duration)}
          </span>

          <div className="flex-1" />

          {/* Sleep timer indicator */}
          {(sleepRemaining !== null || sleepOption === 'end') && (
            <span className="flex items-center gap-1 text-white/50 text-xs tabular-nums">
              <Moon size={12} />
              {sleepOption === 'end' ? 'End' : fmt(sleepRemaining ?? 0)}
            </span>
          )}

          {/* Settings */}
          <button
            data-gp-control
            data-focusable
            onClick={() => { setShowSettings((v) => !v); setShowSubtitlePanel(false); setShowEpisodePanel(false) }}
            className={`text-white/70 hover:text-white transition ${showSettings ? 'text-white' : ''}`}
          >
            <Settings size={18} />
          </button>

          {/* Subtitles panel toggle */}
          <button
            data-gp-control
            data-focusable
            onClick={() => { setShowSubtitlePanel((v) => !v); setShowSettings(false); setShowEpisodePanel(false) }}
            className={`text-white/70 hover:text-white transition ${showSubtitlePanel ? 'text-white' : ''}`}
          >
            <Subtitles size={18} />
          </button>

          {/* Episode picker (TV only) */}
          {episodeList.length > 0 && (
            <button
              data-gp-control
              data-focusable
              onClick={() => { setShowEpisodePanel((v) => !v); setShowSettings(false); setShowSubtitlePanel(false) }}
              className={`text-white/70 hover:text-white transition ${showEpisodePanel ? 'text-white' : ''}`}
              title="Episodes"
            >
              <List size={18} />
            </button>
          )}

          {/* Fullscreen */}
          <button data-gp-control data-focusable onClick={toggleFullscreen} className="text-white/70 hover:text-white transition">
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </motion.div>

      {/* Subtitle panel — unified Stremio-style: embedded + OpenSubtitles grouped by language */}
      {showSubtitlePanel && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-24 right-4 w-80 bg-[#141414]/95 backdrop-blur-xl border border-white/10
                     rounded-2xl shadow-2xl overflow-hidden z-30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Subtitles</p>
            {osSearching && <Loader2 size={14} className="text-white/40 animate-spin" />}
          </div>

          <div className="max-h-[28rem] overflow-y-auto py-1">
            {/* Off option */}
            <button
              data-focusable
              onClick={() => { switchSubtitle(null); setActiveOsSubId(null); setShowSubtitlePanel(false) }}
              className={`w-full text-left px-4 py-2.5 text-sm transition ${
                activeSub === null && activeOsSubId === null
                  ? 'bg-red-600/15 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              Off
            </button>

            {/* Unified list: group by language, embedded first then OpenSubtitles */}
            {(() => {
              // Build language groups: { lang: { embedded: [...], external: [...] } }
              const groups = new Map<string, { embedded: typeof job.subtitleTracks, external: typeof osResults }>()

              // Add embedded tracks
              for (const t of job.subtitleTracks) {
                const lang = (t.language || 'und').toLowerCase()
                if (!groups.has(lang)) groups.set(lang, { embedded: [], external: [] })
                groups.get(lang)!.embedded.push(t)
              }

              // Add OpenSubtitles results
              for (const s of osResults) {
                const lang = (s.language || 'und').toLowerCase()
                if (!groups.has(lang)) groups.set(lang, { embedded: [], external: [] })
                groups.get(lang)!.external.push(s)
              }

              // Sort languages: preferred lang first, then alphabetically
              const prefLang = preferredSubtitleLang === 'off' || preferredSubtitleLang === 'auto' ? 'en' : preferredSubtitleLang.toLowerCase()
              const sortedLangs = Array.from(groups.keys()).sort((a, b) => {
                const aMatch = a.startsWith(prefLang) ? 0 : 1
                const bMatch = b.startsWith(prefLang) ? 0 : 1
                if (aMatch !== bMatch) return aMatch - bMatch
                return a.localeCompare(b)
              })

              return sortedLangs.map((lang) => {
                const group = groups.get(lang)!
                const langLabel = lang === 'und' ? 'Unknown' : lang.toUpperCase()
                const hasItems = group.embedded.length > 0 || group.external.length > 0

                if (!hasItems) return null
                return (
                  <div key={lang}>
                    {/* Language header */}
                    <div className="px-4 pt-3 pb-1">
                      <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{langLabel}</span>
                    </div>

                    {/* Embedded tracks for this language */}
                    {group.embedded.map((t) => (
                      <button
                        key={`emb-${t.index}`}
                        data-focusable
                        onClick={() => { switchSubtitle(t); setActiveOsSubId(null); setShowSubtitlePanel(false) }}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition ${
                          activeSub === t.index
                            ? 'bg-red-600/15 text-white'
                            : 'text-white/60 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <span className="flex-1 truncate">{t.label || t.language}</span>
                        <span className="text-[9px] bg-white/8 text-white/40 px-1.5 py-0.5 rounded">Embedded</span>
                        {t.isImageBased && (
                          <span className="text-[9px] bg-yellow-600/20 text-yellow-400 px-1.5 py-0.5 rounded">PGS</span>
                        )}
                      </button>
                    ))}

                    {/* OpenSubtitles results for this language */}
                    {group.external.map((sub) => (
                      <button
                        key={`os-${sub.id}`}
                        data-focusable
                        onClick={() => applyOsSub(sub)}
                        className={`w-full text-left px-4 py-2 transition ${
                          activeOsSubId === sub.id
                            ? 'bg-red-600/15 text-white'
                            : 'text-white/50 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-1 truncate text-sm">{sub.name || 'Unnamed'}</span>
                          <div className="flex-shrink-0 flex gap-1">
                            {sub.hearingImpaired && (
                              <span className="text-[9px] bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded">HI</span>
                            )}
                            <span className="text-[9px] bg-white/8 text-white/30 px-1.5 py-0.5 rounded">
                              {sub.downloadCount > 0 ? `${(sub.downloadCount / 1000).toFixed(0)}k` : 'OS'}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              })
            })()}

            {/* No results at all */}
            {job.subtitleTracks.length === 0 && osResults.length === 0 && !osSearching && (
              <p className="px-4 py-3 text-xs text-white/30">No subtitles available</p>
            )}

            {/* Manual search fallback — collapsed at bottom */}
            <div className="border-t border-white/5 mt-1 p-2">
              <button
                data-focusable
                onClick={() => setOsSearchOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg
                           text-xs text-white/30 hover:text-white/60 hover:bg-white/5 transition"
              >
                <span className="flex items-center gap-1.5">
                  <Search size={11} />
                  Search manually
                </span>
                <span className="text-white/20">{osSearchOpen ? '▲' : '▼'}</span>
              </button>

              {osSearchOpen && (
                <div className="mt-1.5 space-y-1.5">
                  <div className="flex gap-1.5 px-1">
                    <input
                      value={osQuery}
                      onChange={(e) => setOsQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') searchOsSubs() }}
                      placeholder="Search OpenSubtitles..."
                      className="flex-1 min-w-0 bg-white/10 border border-white/10 rounded-lg
                                 text-white text-xs px-2.5 py-1.5 outline-none placeholder:text-white/20"
                    />
                    <button
                      data-focusable
                      onClick={() => searchOsSubs()}
                      disabled={osSearching}
                      className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600
                                 text-white transition disabled:opacity-40 flex items-center"
                    >
                      {osSearching
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Search size={12} />
                      }
                    </button>
                  </div>
                  {osError && !osSearching && (
                    <p className="px-3 py-1 text-xs text-red-400">{osError}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Episode picker panel */}
      {showEpisodePanel && episodeList.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-24 right-4 w-80 bg-[#141414]/95 backdrop-blur-xl border border-white/10
                     rounded-2xl shadow-2xl overflow-hidden z-30"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{job.seriesName || job.title}</p>
              <p className="text-[11px] text-white/40 mt-0.5">
                Season {episodeList[0]?.seasonNumber ?? '?'} · {episodeList.length} Episode{episodeList.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Episode list */}
          <div className="max-h-80 overflow-y-auto py-1">
            {episodeList.map((ep) => {
              const isCurrent = localEpId === ep.jellyfinId
              const isWatched = (ep.playedPercentage ?? 0) >= 90
              const sNum = String(ep.seasonNumber).padStart(2, '0')
              const eNum = String(ep.episodeNumber).padStart(2, '0')
              return (
                <button
                  key={ep.jellyfinId}
                  data-focusable
                  onClick={() => switchEpisode(ep)}
                  className={`w-full text-left px-4 py-2.5 transition flex items-center gap-3 ${
                    isCurrent
                      ? 'bg-red-600/15'
                      : 'hover:bg-white/5'
                  }`}
                >
                  {/* Now-playing indicator or episode number */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-white/5">
                    {isCurrent ? (
                      <div className="flex gap-[2px] items-end h-3">
                        <span className="w-[3px] bg-red-500 rounded-full animate-pulse" style={{ height: '60%' }} />
                        <span className="w-[3px] bg-red-500 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.15s' }} />
                        <span className="w-[3px] bg-red-500 rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0.3s' }} />
                      </div>
                    ) : (
                      <span className="text-[11px] font-mono text-white/30">{eNum}</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-medium tracking-wide ${isCurrent ? 'text-red-400' : 'text-white/30'}`}>
                      S{sNum}E{eNum}
                    </p>
                    <p className={`text-sm truncate leading-tight ${isCurrent ? 'text-white font-medium' : 'text-white/70'}`}>
                      {ep.title || `Episode ${ep.episodeNumber}`}
                    </p>
                  </div>

                  {/* Watched badge */}
                  {isWatched && !isCurrent && (
                    <Check size={13} className="flex-shrink-0 text-emerald-400/70" />
                  )}
                </button>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="absolute bottom-24 right-4 w-72 bg-[#1a1a1a] border border-dark-border
                     rounded-xl shadow-2xl overflow-hidden z-30"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Tabs */}
          <div className="flex border-b border-dark-border">
            {(['audio', 'quality', 'speed', 'sleep'] as const).map((tab) => (
              <button
                key={tab}
                data-focusable
                onClick={() => setSettingsTab(tab)}
                className={`flex-1 py-2.5 text-xs font-medium capitalize transition ${
                  settingsTab === tab
                    ? 'text-white border-b-2 border-red-500'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {tab === 'sleep' ? <Moon size={13} className="mx-auto" /> : tab}
              </button>
            ))}
          </div>

          <div className="max-h-56 overflow-y-auto p-2">
            {settingsTab === 'audio' && (
              isDirectPlay ? (
                <div className="p-3 space-y-2">
                  <p className="text-xs text-white/40 leading-relaxed">
                    Playing original file directly. Switch to a transcoded stream to change audio tracks.
                  </p>
                  <button
                    data-focusable
                    onClick={switchToTranscoded}
                    className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition"
                  >
                    Switch to Transcoded Stream
                  </button>
                  <div className="pt-1 opacity-40 pointer-events-none">
                    {job.audioTracks.map((t) => (
                      <div key={t.index} className="px-3 py-2 rounded-lg text-sm text-white/60 flex items-center gap-2">
                        <span>{t.label || t.language}</span>
                        {t.isDefault && <span className="text-white/30 text-xs">Default</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                job.audioTracks.map((t) => (
                  <button
                    key={t.index}
                    data-focusable
                    onClick={() => switchAudio(t)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      activeAudio === t.index
                        ? 'bg-red-600/20 text-white'
                        : 'text-white/60 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    {t.label || t.language} {t.isDefault && '· Default'}
                  </button>
                ))
              )
            )}

            {settingsTab === 'quality' && (
              isDirectPlay ? (
                <div className="p-3 space-y-2">
                  <p className="text-xs text-white/40 leading-relaxed">
                    Playing original quality. Switch to a transcoded stream to cap bitrate.
                  </p>
                  <button
                    data-focusable
                    onClick={switchToTranscoded}
                    className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition"
                  >
                    Switch to Transcoded Stream
                  </button>
                  <div className="pt-1 opacity-40 pointer-events-none">
                    {QUALITY_PRESETS.map((preset) => (
                      <div key={preset.label} className="px-3 py-2 rounded-lg text-sm text-white/60">
                        {preset.label}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                QUALITY_PRESETS.map((preset, i) => (
                  <button
                    key={preset.label}
                    data-focusable
                    onClick={() => switchQuality(preset, i)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      activeQuality === i
                        ? 'bg-red-600/20 text-white'
                        : 'text-white/60 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))
              )
            )}

            {settingsTab === 'speed' &&
              SPEEDS.map((s) => (
                <button
                  key={s}
                  data-focusable
                  onClick={() => { changeSpeed(s); setShowSettings(false) }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                    activeSpeed === s
                      ? 'bg-red-600/20 text-white'
                      : 'text-white/60 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  {s === 1 ? 'Normal' : `${s}×`}
                </button>
              ))}

            {settingsTab === 'sleep' && (
              <>
                {SLEEP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    data-focusable
                    onClick={() => setSleepOption(opt.value)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      sleepOption === opt.value
                        ? 'bg-red-600/20 text-white'
                        : 'text-white/60 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
