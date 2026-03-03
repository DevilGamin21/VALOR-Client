/**
 * PlayerOverlay — rendered in the transparent overlay BrowserWindow that
 * sits on top of the mpv video window.  All playback control goes through
 * window.electronAPI.mpv IPC; mpv handles hardware-decoded video.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
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
} from 'lucide-react'
import * as api from '@/services/api'
import type { MpvLaunchPayload } from '@/types/electron'
import type { AudioTrack, SubtitleTrack, EpisodeInfo } from '@/types/media'

// ─── Constants ────────────────────────────────────────────────────────────────

const QUALITY_PRESETS = [
  { label: 'Original', maxBitrate: 0 },
  { label: '1080p', maxBitrate: 10_000_000 },
  { label: '720p', maxBitrate: 4_000_000 },
  { label: '480p', maxBitrate: 2_000_000 },
]
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

// ─── VTT parsing (for client-side subtitle rendering) ─────────────────────────

interface VttCue { start: number; end: number; text: string }

function parseVttCues(vttText: string): VttCue[] {
  const cues: VttCue[] = []
  for (const block of vttText.split(/\n\n+/)) {
    const lines = block.trim().split('\n')
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim())
    const toSec = (t: string) => {
      const parts = t.replace(',', '.').split(':').map(Number)
      return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
    }
    const text = lines.slice(lines.indexOf(timeLine) + 1).join('\n')
    cues.push({ start: toSec(startStr), end: toSec(endStr), text })
  }
  return cues
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlayerOverlay() {
  // ── State: job info (received once from main process) ─────────────────────
  const [payload, setPayload] = useState<MpvLaunchPayload | null>(null)
  const [currentJob, setCurrentJob] = useState<MpvLaunchPayload | null>(null)

  // ── State: mpv playback ───────────────────────────────────────────────────
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [error, setError] = useState('')
  const [ended, setEnded] = useState(false)

  // ── State: UI panels ──────────────────────────────────────────────────────
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'audio' | 'quality' | 'speed'>('audio')
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false)
  const [showEpisodePanel, setShowEpisodePanel] = useState(false)

  // ── State: track selections ───────────────────────────────────────────────
  const [activeAudio, setActiveAudio] = useState(0)
  const [activeSub, setActiveSub] = useState<number | null>(null)
  const [activeQuality, setActiveQuality] = useState(0)
  const [activeSpeed] = useState(1)
  const [volume, setVolume] = useState(100)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [localEpId, setLocalEpId] = useState('')

  // ── State: subtitle rendering (client-side VTT) ───────────────────────────
  const [vttCues, setVttCues] = useState<VttCue[]>([])
  const [activeCue, setActiveCue] = useState<string | null>(null)

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Make page background transparent ─────────────────────────────────────
  // Must clear html, body AND #root — index.css sets background-color: #0a0a0a on all three.
  // Without clearing #root, it blocks mpv's video from showing through the transparent window.
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
    return () => {
      document.documentElement.style.background = ''
      document.body.style.background = ''
      if (root) root.style.background = ''
    }
  }, [])

  // ── Subscribe to IPC events ────────────────────────────────────────────────
  useEffect(() => {
    // Primary: fetch payload stored by main before window opened (no race condition)
    window.electronAPI.mpv.getPayload().then((p) => {
      if (!p) return
      setPayload(p)
      setCurrentJob(p)
      setLocalEpId(p.currentEpisodeId)
      setBuffering(true)
      setError('')
      setEnded(false)
      setTime(0)
      setDuration(0)
    }).catch(() => {})

    // Fallback: pushed event for future episode/file switches
    window.electronAPI.mpv.onJob((p) => {
      const pl = p as MpvLaunchPayload
      setPayload(pl)
      setCurrentJob(pl)
      setLocalEpId(pl.currentEpisodeId)
      setBuffering(true)
      setError('')
      setEnded(false)
      setTime(0)
      setDuration(0)
    })

    window.electronAPI.mpv.onReady(() => {
      setBuffering(false)
    })

    window.electronAPI.mpv.onTime((t) => {
      setTime(t)
      // Client-side VTT cue matching
      setActiveCue((prev) => {
        if (!vttCues.length) return null
        const cue = vttCues.find((c) => t >= c.start && t <= c.end)
        const next = cue?.text ?? null
        return prev === next ? prev : next
      })
    })

    window.electronAPI.mpv.onDuration((d) => {
      setDuration(d)
    })

    window.electronAPI.mpv.onPaused((p) => {
      setPaused(p)
      if (!p) setBuffering(false)
    })

    window.electronAPI.mpv.onEnded(() => {
      setEnded(true)
    })

    window.electronAPI.mpv.onError((e) => {
      setError(e)
      setBuffering(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep vttCues ref fresh for the onTime handler
  const vttCuesRef = useRef(vttCues)
  useEffect(() => { vttCuesRef.current = vttCues }, [vttCues])

  // Re-register onTime to use latest cues whenever they change
  // (effect above only registers once; we use ref access for cue lookup instead)

  // ── Heartbeat (progress reporting) ────────────────────────────────────────
  useEffect(() => {
    if (!currentJob) return
    heartbeatRef.current = setInterval(() => {
      if (!duration) return
      api.reportProgress({
        itemId: currentJob.job.itemId,
        positionTicks: Math.floor(time * 10_000_000),
        durationTicks: Math.floor(duration * 10_000_000),
        isPaused: paused,
        playSessionId: currentJob.job.playSessionId ?? '',
      }).catch(() => {})
    }, 10_000)
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current) }
  }, [currentJob, time, duration, paused])

  // ── Close handler ──────────────────────────────────────────────────────────
  const handleClose = useCallback(async () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    if (currentJob) {
      api.reportProgress({
        itemId: currentJob.job.itemId,
        positionTicks: Math.floor(time * 10_000_000),
        durationTicks: Math.floor(duration * 10_000_000),
        isPaused: true,
        playSessionId: currentJob.job.playSessionId ?? '',
        isStopped: true,
      }).catch(() => {})
    }
    await window.electronAPI.mpv.quit()
  }, [currentJob, time, duration])

  // ── Controls auto-hide ─────────────────────────────────────────────────────
  function showControlsTemporarily() {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!showSettings && !showSubtitlePanel && !showEpisodePanel) setControlsVisible(false)
    }, 3000)
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); window.electronAPI.mpv.togglePause() }
      else if (e.key === 'ArrowLeft')  window.electronAPI.mpv.seek(-10)
      else if (e.key === 'ArrowRight') window.electronAPI.mpv.seek(10)
      else if (e.key === 'ArrowUp')    changeVolume(Math.min(100, volume + 5))
      else if (e.key === 'ArrowDown')  changeVolume(Math.max(0, volume - 5))
      else if (e.key === 'f')          toggleFullscreen()
      else if (e.key === 'Escape')     handleClose()
      else if (e.key === 'm')          toggleMute()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [volume, handleClose])

  // ── Volume / mute ─────────────────────────────────────────────────────────
  function changeVolume(val: number) {
    setVolume(val)
    setMuted(val === 0)
    window.electronAPI.mpv.setVolume(muted ? 0 : val)
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    window.electronAPI.mpv.setVolume(next ? 0 : volume)
  }

  // ── Fullscreen ────────────────────────────────────────────────────────────
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setFullscreen(true)
    } else {
      document.exitFullscreen()
      setFullscreen(false)
    }
  }

  // ── Audio/subtitle/quality track switching ────────────────────────────────

  // Is the current session using direct play (no server transcoding)?
  const isDirectPlay = !!(currentJob?.job?.directStreamUrl ?? payload?.job?.directStreamUrl)

  async function switchAudio(track: AudioTrack) {
    if (!currentJob) return
    setActiveAudio(track.index)
    setShowSettings(false)

    if (isDirectPlay) {
      // Direct play: switch audio track natively inside mpv — no stream restart needed
      const mpvAid = track.mpvAid
        ?? (currentJob.job.audioTracks.findIndex(t => t.index === track.index) + 1)
      await window.electronAPI.mpv.setAid(mpvAid)
      return
    }

    // HLS transcode: must restart the stream for a different audio mix
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: currentJob.job.itemId,
        audioStreamIndex: track.index,
        maxBitrate: QUALITY_PRESETS[activeQuality].maxBitrate || undefined,
      })
      await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
      setCurrentJob({ ...currentJob, job: newJob })
    } catch {
      setError('Failed to switch audio track')
      setBuffering(false)
    }
  }

  async function switchSubtitle(track: SubtitleTrack | null) {
    if (!currentJob) return
    setActiveSub(track?.index ?? null)
    setShowSubtitlePanel(false)

    if (isDirectPlay) {
      // Direct play: mpv handles all subtitle types (text AND image-based) natively
      setVttCues([])
      setActiveCue(null)
      if (!track) {
        await window.electronAPI.mpv.setSid(0)  // 0 = disable subtitles
        return
      }
      const mpvSid = track.mpvSid
        ?? (currentJob.job.subtitleTracks.findIndex(t => t.index === track.index) + 1)
      await window.electronAPI.mpv.setSid(mpvSid)
      return
    }

    // HLS transcode path
    setVttCues([])
    setActiveCue(null)

    if (!track) return

    if (track.isImageBased) {
      // Image-based (PGS) → server-side burn-in via transcode restart
      setBuffering(true)
      try {
        const newJob = await api.startPlayJob({
          itemId: currentJob.job.itemId,
          subtitleStreamIndex: track.index,
          audioStreamIndex: activeAudio,
        })
        await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
        setCurrentJob({ ...currentJob, job: newJob })
      } catch {
        setError('Failed to switch subtitle')
        setBuffering(false)
      }
      return
    }

    // Text subtitle → client-side VTT rendering
    const vttUrl = track.vttUrl
      ? `${api.API_BASE}${track.vttUrl}`
      : `${api.API_BASE}/jellyfin/subtitle-vtt/${currentJob.job.itemId}/${track.index}`
    try {
      const res = await fetch(vttUrl)
      const text = await res.text()
      setVttCues(parseVttCues(text))
    } catch {
      setError('Failed to load subtitles')
    }
  }

  async function switchQuality(preset: typeof QUALITY_PRESETS[number], index: number) {
    if (isDirectPlay) return  // quality n/a for direct play (original file)
    if (!currentJob) return
    setActiveQuality(index)
    setShowSettings(false)
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: currentJob.job.itemId,
        maxBitrate: preset.maxBitrate || undefined,
        audioStreamIndex: activeAudio,
      })
      await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
      setCurrentJob({ ...currentJob, job: newJob })
    } catch {
      setError('Failed to switch quality')
      setBuffering(false)
    }
  }

  async function switchEpisode(ep: EpisodeInfo) {
    if (!currentJob) return
    setShowEpisodePanel(false)
    setBuffering(true)
    setLocalEpId(ep.jellyfinId)
    setVttCues([])
    setActiveCue(null)
    try {
      const newJob = await api.startPlayJob({ itemId: ep.jellyfinId, directPlay: isDirectPlay })
      await window.electronAPI.mpv.loadFile(newJob.directStreamUrl ?? newJob.hlsUrl)
      setCurrentJob({ ...currentJob, job: newJob, title: ep.title, currentEpisodeId: ep.jellyfinId })
    } catch {
      setError('Failed to load episode')
      setBuffering(false)
    }
  }

  // ── Format helpers ────────────────────────────────────────────────────────
  function fmt(sec: number) {
    if (!sec || isNaN(sec)) return '0:00'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const progress = duration > 0 ? time / duration : 0
  const episodeList = currentJob?.episodeList ?? payload?.episodeList ?? []
  const job = currentJob?.job ?? payload?.job
  const title = currentJob?.title ?? payload?.title ?? ''

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col select-none"
      style={{ background: 'transparent' }}
      onMouseMove={showControlsTemporarily}
      onClick={() => {
        if (!showSettings && !showSubtitlePanel && !showEpisodePanel) {
          window.electronAPI.mpv.togglePause()
        }
      }}
    >
      {/* Buffering spinner */}
      {buffering && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center">
            <Loader2 size={36} className="text-white/80 animate-spin" />
          </div>
        </div>
      )}

      {/* Ended overlay */}
      {ended && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <p className="text-white/70 text-lg">Playback finished</p>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/70"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center max-w-sm px-6">
            <p className="text-red-400 mb-4 text-sm">{error}</p>
            <button
              onClick={() => { setError(''); setBuffering(false) }}
              className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Subtitle cue overlay */}
      {activeCue && (
        <div className="absolute bottom-24 left-0 right-0 flex justify-center pointer-events-none px-8">
          <div className="bg-black/80 px-3 py-1.5 rounded text-white text-base text-center max-w-2xl">
            {activeCue.split('\n').map((line, i) => <p key={i}>{line}</p>)}
          </div>
        </div>
      )}

      {/* Close button */}
      <button
        onClick={(e) => { e.stopPropagation(); handleClose() }}
        className={`absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-black/50
                    flex items-center justify-center transition-opacity duration-300
                    hover:bg-black/80 ${controlsVisible ? 'opacity-100' : 'opacity-0 hover:opacity-80'}`}
      >
        <X size={18} className="text-white" />
      </button>

      {/* Controls bar */}
      <motion.div
        animate={{ opacity: controlsVisible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-16
                   bg-gradient-to-t from-black/90 via-black/40 to-transparent"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <p className="text-white font-semibold text-sm mb-3 truncate">{title}</p>

        {/* Progress bar */}
        <div
          className="relative h-1.5 bg-white/20 rounded-full mb-4 cursor-pointer group/seek"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const frac = (e.clientX - rect.left) / rect.width
            window.electronAPI.mpv.seekAbsolute(frac * duration)
          }}
        >
          <div
            className="absolute top-0 left-0 h-full bg-red-500 rounded-full transition-all duration-100"
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
          <button
            onClick={() => window.electronAPI.mpv.togglePause()}
            className="text-white hover:text-white/80 transition"
          >
            {paused ? <Play size={22} fill="white" /> : <Pause size={22} />}
          </button>

          {/* Skip */}
          <button onClick={() => window.electronAPI.mpv.seek(-10)} className="text-white/70 hover:text-white transition">
            <SkipBack size={18} />
          </button>
          <button onClick={() => window.electronAPI.mpv.seek(10)} className="text-white/70 hover:text-white transition">
            <SkipForward size={18} />
          </button>

          {/* Volume */}
          <button onClick={toggleMute} className="text-white/70 hover:text-white transition">
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            className="w-20 accent-red-500"
          />

          {/* Time */}
          <span className="text-white/60 text-xs tabular-nums ml-1">
            {fmt(time)} / {fmt(duration)}
          </span>

          <div className="flex-1" />

          {/* Settings */}
          <button
            onClick={() => { setShowSettings((v) => !v); setShowSubtitlePanel(false); setShowEpisodePanel(false) }}
            className={`text-white/70 hover:text-white transition ${showSettings ? 'text-white' : ''}`}
          >
            <Settings size={18} />
          </button>

          {/* Subtitles */}
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

      {/* ── Subtitle panel ─────────────────────────────────────────────────── */}
      {showSubtitlePanel && job && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-24 right-4 w-60 bg-[#1a1a1a] border border-white/10
                     rounded-xl shadow-2xl overflow-hidden z-30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2.5 border-b border-white/10">
            <p className="text-xs font-medium text-white/70">Subtitles</p>
          </div>
          <div className="max-h-56 overflow-y-auto p-2">
            <button
              onClick={() => switchSubtitle(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                activeSub === null ? 'bg-red-600/20 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white'
              }`}
            >
              Off
            </button>
            {job.subtitleTracks.map((t) => (
              <button
                key={t.index}
                onClick={() => switchSubtitle(t)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition ${
                  activeSub === t.index ? 'bg-red-600/20 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white'
                }`}
              >
                <span>{t.label || t.language}</span>
                {t.isImageBased && (
                  <span className="text-[9px] bg-yellow-600/30 text-yellow-400 px-1 rounded">PGS</span>
                )}
              </button>
            ))}
            {job.subtitleTracks.length === 0 && (
              <p className="px-3 py-2 text-sm text-white/30">No subtitle tracks</p>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Episode picker panel ────────────────────────────────────────────── */}
      {showEpisodePanel && episodeList.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-24 right-4 w-72 bg-[#1a1a1a] border border-white/10
                     rounded-xl shadow-2xl overflow-hidden z-30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2.5 border-b border-white/10">
            <p className="text-xs font-medium text-white/70">Episodes</p>
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {episodeList.map((ep) => (
              <button
                key={ep.jellyfinId}
                onClick={() => switchEpisode(ep)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition ${
                  localEpId === ep.jellyfinId
                    ? 'bg-red-600/20 text-white'
                    : 'text-white/60 hover:bg-white/8 hover:text-white'
                }`}
              >
                <span className="text-white/30 flex-shrink-0 tabular-nums w-6 text-right">
                  {ep.episodeNumber}.
                </span>
                <span className="truncate">{ep.title}</span>
                {localEpId === ep.jellyfinId && (
                  <span className="ml-auto flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500" />
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Settings panel ──────────────────────────────────────────────────── */}
      {showSettings && job && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="absolute bottom-24 right-4 w-72 bg-[#1a1a1a] border border-white/10
                     rounded-xl shadow-2xl overflow-hidden z-30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex border-b border-white/10">
            {(['audio', 'quality', 'speed'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSettingsTab(tab)}
                className={`flex-1 py-2.5 text-xs font-medium capitalize transition ${
                  settingsTab === tab
                    ? 'text-white border-b-2 border-red-500'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="max-h-56 overflow-y-auto p-2">
            {settingsTab === 'audio' &&
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
              ))}

            {settingsTab === 'quality' && (
              isDirectPlay
                ? <p className="px-3 py-2 text-sm text-white/50">
                    Direct play — original quality
                  </p>
                : QUALITY_PRESETS.map((preset, i) => (
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
            )}

            {settingsTab === 'speed' &&
              SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setShowSettings(false) }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                    activeSpeed === s
                      ? 'bg-red-600/20 text-white'
                      : 'text-white/60 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  {s === 1 ? 'Normal' : `${s}×`}
                </button>
              ))}
          </div>
        </motion.div>
      )}
    </div>
  )
}
