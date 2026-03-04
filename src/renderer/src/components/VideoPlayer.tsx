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
  Search
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
  const { episodeList, currentEpisodeId, updateJob } = usePlayer()
  const { autoplayNext, preferredSubtitleLang, directPlay: settingsDirectPlay, defaultQuality, subtitleSize, subtitleBgOpacity, discordRPC } = useSettings()

  const isDirectPlay = !!job.directStreamUrl

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedAtRef = useRef<number | null>(null)

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
    if (job.directStreamUrl) {
      // Direct play: bypass HLS entirely
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
      if (video) {
        video.src = job.directStreamUrl
        if (startPositionTicks > 0) video.currentTime = startPositionTicks / 10_000_000
        video.muted = false
        video.volume = video.volume > 0 ? video.volume : 1
        video.play().catch(() => {})
      }
    } else {
      loadSrc(job.hlsUrl)
    }

    // Auto-select preferred subtitle (text-based only, no re-transcode)
    if (preferredSubtitleLang !== 'off' && preferredSubtitleLang !== 'auto' && video) {
      const match = job.subtitleTracks.find(
        (t) => t.language?.toLowerCase().startsWith(preferredSubtitleLang) && !t.isImageBased
      )
      if (match) {
        setActiveSub(match.index)
        const vttUrl = match.vttUrl
          ? `${API_BASE}${match.vttUrl}`
          : `${API_BASE}/jellyfin/subtitle-vtt/${job.itemId}/${match.index}`
        fetch(vttUrl).then((r) => r.text()).then((text) => setVttCues(parseVttCues(text))).catch(() => {})
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
      // video.duration can be Infinity for HLS live/transcoded streams.
      // Fall back to the server-reported RunTimeTicks so progress percent is correct.
      const durSecs = isFinite(video.duration) && video.duration > 0
        ? video.duration
        : (job.durationTicks ?? 0) / 10_000_000
      if (!durSecs) return
      api.reportProgress({
        itemId: job.itemId,
        positionTicks: Math.floor(video.currentTime * 10_000_000),
        durationTicks: Math.floor(durSecs * 10_000_000),
        isPaused: video.paused,
        playSessionId: job.playSessionId
      }).catch(() => {})
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
    const video = videoRef.current
    if (video) {
      video.pause()
      const durSecs = isFinite(video.duration) && video.duration > 0
        ? video.duration
        : (job.durationTicks ?? 0) / 10_000_000
      api.reportProgress({
        itemId: job.itemId,
        positionTicks: Math.floor(video.currentTime * 10_000_000),
        durationTicks: Math.floor(durSecs * 10_000_000),
        isPaused: true,
        playSessionId: job.playSessionId,
        isStopped: true
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
      largeImageKey: job.posterUrl || undefined,
      largeImageText: job.posterUrl ? (job.seriesName || job.title) : undefined,
      instance: false,
      buttons: [{ label: 'Get VALOR', url: 'https://valor.dawn-star.co.uk/download/' }],
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
    setShowSettings(false)
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: job.itemId,
        audioStreamIndex: track.index,
        maxBitrate: QUALITY_PRESETS[activeQuality].maxBitrate || undefined,
        startTimeTicks: savedTime > 0 ? Math.floor(savedTime * 10_000_000) : undefined,
      })
      loadSrc(newJob.hlsUrl, savedTime)
    } catch {
      setError('Failed to switch audio track')
    }
  }

  async function switchSubtitle(track: SubtitleTrack | null) {
    setActiveSub(track?.index ?? null)
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
        })
        loadSrc(newJob.hlsUrl, savedTime)
      } catch {
        setError('Failed to switch subtitle')
      }
      return
    }

    // VTT subtitle → fetch and render client-side
    const vttUrl = track.vttUrl
      ? `${API_BASE}${track.vttUrl}`
      : `${API_BASE}/jellyfin/subtitle-vtt/${job.itemId}/${track.index}`
    try {
      const res = await fetch(vttUrl)
      const text = await res.text()
      setVttCues(parseVttCues(text))
    } catch {
      setError('Failed to load subtitles')
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
      })
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

    setShowEpisodePanel(false)
    setBuffering(true)
    setLocalEpId(ep.jellyfinId)
    try {
      const newJob = await api.startPlayJob({
        itemId: ep.jellyfinId,
        directPlay: settingsDirectPlay,
        maxBitrate: settingsDirectPlay ? undefined : QUALITY_BITRATES[defaultQuality],
      })
      updateJob(newJob)
      if (newJob.directStreamUrl) {
        const video = videoRef.current
        if (video) {
          video.src = newJob.directStreamUrl
          video.muted = false
          video.volume = video.volume > 0 ? video.volume : 1
          video.play().catch(() => {})
        }
        setBuffering(false)
      } else {
        loadSrc(newJob.hlsUrl)
      }
    } catch {
      setError('Failed to load episode')
      setBuffering(false)
    }
  }

  // ─── OpenSubtitles ──────────────────────────────────────────────────────────

  async function searchOsSubs() {
    setOsSearching(true)
    setOsError('')
    setOsResults([])
    try {
      const results = await api.searchSubtitles({
        query: osQuery.trim() || job.seriesName || job.title,
      })
      // Sort by download count descending (most popular first)
      results.sort((a, b) => b.downloadCount - a.downloadCount)
      setOsResults(results)
      if (results.length === 0) setOsError('No subtitles found')
    } catch {
      setOsError('Search failed')
    } finally {
      setOsSearching(false)
    }
  }

  // Auto-search when the OS section is first expanded
  useEffect(() => {
    if (!osSearchOpen) return
    if (osResults.length > 0 || osSearching) return
    searchOsSubs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osSearchOpen])

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

  // ─── Gamepad / controller support ─────────────────────────────────────────

  const currentEpIdx = episodeList.findIndex((ep) => ep.jellyfinId === localEpId)

  useGamepad({
    buttons: {
      0:  { onPress: togglePlay },                                             // A — play / pause
      1:  { onPress: handleClose },                                            // B — close player
      2:  { onPress: toggleMute },                                             // X — mute
      3:  { onPress: toggleFullscreen },                                       // Y — fullscreen
      4:  { onPress: () => { if (currentEpIdx > 0) switchEpisode(episodeList[currentEpIdx - 1]) } },         // LB — prev episode
      5:  { onPress: () => { if (currentEpIdx < episodeList.length - 1) switchEpisode(episodeList[currentEpIdx + 1]) } }, // RB — next episode
      6:  { onPress: () => seek(-30) },                                        // LT — big skip back
      7:  { onPress: () => seek(30) },                                         // RT — big skip forward
      8:  { onPress: () => setShowSettings((v) => !v) },                       // Back — settings
      9:  { onPress: () => {                                                   // Start — episodes or subs
            if (episodeList.length > 0) setShowEpisodePanel((v) => !v)
            else setShowSubtitlePanel((v) => !v)
          }},
      12: { onPress: () => changeVolume(Math.min(1, volume + 0.1)),            // DPad Up — volume up
            onRepeat: () => changeVolume(Math.min(1, volume + 0.1)), repeatDelay: 400, repeatInterval: 150 },
      13: { onPress: () => changeVolume(Math.max(0, volume - 0.1)),            // DPad Down — volume down
            onRepeat: () => changeVolume(Math.max(0, volume - 0.1)), repeatDelay: 400, repeatInterval: 150 },
      14: { onPress: () => seek(-10), onRepeat: () => seek(-10), repeatDelay: 500, repeatInterval: 200 },  // DPad Left — seek back
      15: { onPress: () => seek(10),  onRepeat: () => seek(10),  repeatDelay: 500, repeatInterval: 200 },  // DPad Right — seek fwd
    },
    axes: [
      { axis: 0, direction: 'negative', onPress: () => seek(-10), onRepeat: () => seek(-10), repeatDelay: 500, repeatInterval: 200 },
      { axis: 0, direction: 'positive', onPress: () => seek(10),  onRepeat: () => seek(10),  repeatDelay: 500, repeatInterval: 200 },
      { axis: 1, direction: 'negative', onPress: () => changeVolume(Math.min(1, volume + 0.1)),
        onRepeat: () => changeVolume(Math.min(1, volume + 0.1)), repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'positive', onPress: () => changeVolume(Math.max(0, volume - 0.1)),
        onRepeat: () => changeVolume(Math.max(0, volume - 0.1)), repeatDelay: 400, repeatInterval: 150 },
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
      {/* Video */}
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
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">
              Up Next
            </span>
            <button
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

      {/* Controls overlay */}
      <motion.div
        animate={{ opacity: controlsVisible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-16
                   bg-gradient-to-t from-black/90 via-black/40 to-transparent"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <p className="text-white font-semibold text-sm mb-3 truncate">{job.title}</p>

        {/* Progress bar */}
        <div
          className="relative h-1.5 bg-white/20 rounded-full mb-4 cursor-pointer group/seek"
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
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3
                       bg-white rounded-full opacity-0 group-hover/seek:opacity-100 transition"
            style={{ left: `${progress * 100}%` }}
          />
        </div>

        {/* Control row */}
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button onClick={togglePlay} className="text-white hover:text-white/80 transition">
            {playing ? <Pause size={22} /> : <Play size={22} fill="white" />}
          </button>

          {/* Skip back/forward */}
          <button onClick={() => seek(-10)} className="text-white/70 hover:text-white transition">
            <SkipBack size={18} />
          </button>
          <button onClick={() => seek(10)} className="text-white/70 hover:text-white transition">
            <SkipForward size={18} />
          </button>

          {/* Volume */}
          <button onClick={toggleMute} className="text-white/70 hover:text-white transition">
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            className="w-20 accent-red-500"
          />

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
            onClick={() => { setShowSettings((v) => !v); setShowSubtitlePanel(false); setShowEpisodePanel(false) }}
            className={`text-white/70 hover:text-white transition ${showSettings ? 'text-white' : ''}`}
          >
            <Settings size={18} />
          </button>

          {/* Subtitles panel toggle */}
          <button
            onClick={() => { setShowSubtitlePanel((v) => !v); setShowSettings(false); setShowEpisodePanel(false) }}
            className={`text-white/70 hover:text-white transition ${showSubtitlePanel ? 'text-white' : ''}`}
          >
            <Subtitles size={18} />
          </button>

          {/* Episode picker (TV only) */}
          {episodeList.length > 0 && (
            <button
              onClick={() => { setShowEpisodePanel((v) => !v); setShowSettings(false); setShowSubtitlePanel(false) }}
              className={`text-white/70 hover:text-white transition ${showEpisodePanel ? 'text-white' : ''}`}
              title="Episodes"
            >
              <List size={18} />
            </button>
          )}

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition">
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </motion.div>

      {/* Subtitle panel */}
      {showSubtitlePanel && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-24 right-4 w-72 bg-[#1a1a1a] border border-dark-border
                     rounded-xl shadow-2xl overflow-hidden z-30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2.5 border-b border-dark-border">
            <p className="text-xs font-medium text-white/70">Subtitles</p>
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {/* OpenSubtitles search — at the top for quick access */}
            <div className="p-2">
              <button
                onClick={() => setOsSearchOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg
                           text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition"
              >
                <span className="flex items-center gap-1.5">
                  <Globe size={12} />
                  Search OpenSubtitles
                </span>
                <span className="text-white/30">{osSearchOpen ? '▲' : '▼'}</span>
              </button>

              {osSearchOpen && (
                <div className="mt-1 space-y-1.5">
                  {/* Query + search button row */}
                  <div className="flex gap-1.5 px-1">
                    <input
                      value={osQuery}
                      onChange={(e) => setOsQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') searchOsSubs() }}
                      className="flex-1 min-w-0 bg-white/10 border border-white/10 rounded-lg
                                 text-white text-xs px-2 py-1.5 outline-none"
                    />
                    <button
                      onClick={searchOsSubs}
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

                  {/* Loading */}
                  {osSearching && (
                    <div className="flex items-center justify-center py-3">
                      <Loader2 size={16} className="text-white/40 animate-spin" />
                    </div>
                  )}

                  {/* Error */}
                  {osError && !osSearching && (
                    <p className="px-3 py-1 text-xs text-red-400">{osError}</p>
                  )}

                  {/* Results */}
                  {!osSearching && osResults.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => applyOsSub(sub)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition ${
                        activeOsSubId === sub.id
                          ? 'bg-red-600/20 text-white'
                          : 'text-white/50 hover:bg-white/8 hover:text-white'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 truncate text-xs">{sub.name || 'Unnamed'}</div>
                        <div className="flex-shrink-0 flex gap-1 mt-0.5">
                          <span className="text-[9px] bg-white/10 text-white/50 px-1 py-0.5 rounded uppercase">
                            {sub.language}
                          </span>
                          {sub.hearingImpaired && (
                            <span className="text-[9px] bg-blue-600/20 text-blue-400 px-1 py-0.5 rounded">HI</span>
                          )}
                        </div>
                      </div>
                      {sub.downloadCount > 0 && (
                        <div className="text-[10px] text-white/25 mt-0.5">
                          {sub.downloadCount.toLocaleString()} downloads
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Embedded tracks */}
            <div className="border-t border-dark-border" />
            <div className="p-2">
              <button
                onClick={() => { switchSubtitle(null); setShowSubtitlePanel(false) }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                  activeSub === null && activeOsSubId === null
                    ? 'bg-red-600/20 text-white'
                    : 'text-white/60 hover:bg-white/8 hover:text-white'
                }`}
              >
                Off
              </button>
              {job.subtitleTracks.map((t) => (
                <button
                  key={t.index}
                  onClick={() => { switchSubtitle(t); setShowSubtitlePanel(false) }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition ${
                    activeSub === t.index
                      ? 'bg-red-600/20 text-white'
                      : 'text-white/60 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <span>{t.label || t.language}</span>
                  {t.isImageBased && (
                    <span className="text-[9px] bg-yellow-600/30 text-yellow-400 px-1 rounded">PGS</span>
                  )}
                </button>
              ))}
              {job.subtitleTracks.length === 0 && (
                <p className="px-3 py-2 text-xs text-white/30">No embedded tracks</p>
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
              const sNum = String(ep.seasonNumber).padStart(2, '0')
              const eNum = String(ep.episodeNumber).padStart(2, '0')
              return (
                <button
                  key={ep.jellyfinId}
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
