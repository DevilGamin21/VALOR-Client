/**
 * PlayerOverlay — rendered in the transparent overlay BrowserWindow that
 * sits on top of the mpv video window.  All playback control goes through
 * window.electronAPI.mpv IPC; mpv handles hardware-decoded video.
 *
 * Feature parity with VideoPlayer.tsx:
 *   - Sleep timer (countdown + end-of-episode)
 *   - OpenSubtitles (auto-fetch + manual search + apply)
 *   - Up Next auto-advance
 *   - Speed control (mpv IPC)
 *   - Subtitle size / opacity from settings
 *   - Audio/subtitle preference persistence per series
 *   - Preferred language auto-select
 *   - Gamepad navigation (full zone-based)
 *   - Auto-fetch episode list for Continue Watching
 *   - Direct play handling in audio/quality panels
 *   - Heartbeat / progress / Discord RPC / mark-played
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  SkipForward,
  SkipBack,
  Settings,
  Subtitles,
  Loader2,
  List,
  Moon,
  Search,
  Check,
} from 'lucide-react'
import * as api from '@/services/api'
import type { OsSubtitleResult } from '@/services/api'
import type { MpvLaunchPayload } from '@/types/electron'
import type { AudioTrack, SubtitleTrack, EpisodeInfo } from '@/types/media'
import type { SubtitleSize } from '@/contexts/SettingsContext'
import { useGamepad } from '@/hooks/useGamepad'

// ─── Constants ────────────────────────────────────────────────────────────────

const QUALITY_PRESETS = [
  { label: 'Original', maxBitrate: 0 },
  { label: '1440p', maxBitrate: 20_000_000 },
  { label: '1080p', maxBitrate: 10_000_000 },
  { label: '720p', maxBitrate: 4_000_000 },
  { label: '480p', maxBitrate: 2_000_000 },
]
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

type SleepOption = 'off' | '5' | '10' | '15' | '30' | '60' | '90' | 'end'
const SLEEP_OPTIONS: { value: SleepOption; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1 hour 30 min' },
  { value: 'end', label: 'End of episode' },
]

const SUBTITLE_FONT_SIZE: Record<SubtitleSize, string> = {
  small: '0.875rem',
  medium: '1rem',
  large: '1.375rem',
  xl: '1.875rem',
}

// ─── Settings from localStorage (overlay is a separate React instance) ───────

function readSettings() {
  try {
    const raw = localStorage.getItem('valor-settings')
    if (!raw) return {}
    return JSON.parse(raw)
  } catch { return {} }
}

function getSettingBool(key: string, def: boolean): boolean {
  const s = readSettings()
  return typeof s[key] === 'boolean' ? s[key] : def
}

function getSettingStr(key: string, def: string): string {
  const s = readSettings()
  return typeof s[key] === 'string' ? s[key] : def
}

function getSettingNum(key: string, def: number): number {
  const s = readSettings()
  return typeof s[key] === 'number' ? s[key] : def
}

// ─── VTT parsing ─────────────────────────────────────────────────────────────

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

// ─── AV preference persistence ───────────────────────────────────────────────

function saveAvPrefs(key: string, audio: number, sub: number | null) {
  try { localStorage.setItem(`av-prefs-${key}`, JSON.stringify({ audio, sub })) } catch {}
}
function loadAvPrefs(key: string): { audio: number; sub: number | null } | null {
  try {
    const raw = localStorage.getItem(`av-prefs-${key}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlayerOverlay() {
  // ── State: job info ─────────────────────────────────────────────────────
  const [payload, setPayload] = useState<MpvLaunchPayload | null>(null)
  const [currentJob, setCurrentJob] = useState<MpvLaunchPayload | null>(null)

  // ── State: mpv playback ─────────────────────────────────────────────────
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [error, setError] = useState('')
  const [ended, setEnded] = useState(false)

  // ── State: UI panels ────────────────────────────────────────────────────
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'audio' | 'quality' | 'speed' | 'sleep'>('audio')
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false)
  const [showEpisodePanel, setShowEpisodePanel] = useState(false)
  const [localEpId, setLocalEpId] = useState('')
  const [episodeList, setEpisodeListState] = useState<EpisodeInfo[]>([])

  // ── State: track selections ─────────────────────────────────────────────
  const [activeAudio, setActiveAudio] = useState(0)
  const [activeSub, setActiveSub] = useState<number | null>(null)
  const [activeQuality, setActiveQuality] = useState(0)
  const [activeSpeed, setActiveSpeed] = useState(1)
  const [volume, setVolume] = useState(100)
  const [muted, setMuted] = useState(false)

  // ── State: subtitle rendering ───────────────────────────────────────────
  const [vttCues, setVttCues] = useState<VttCue[]>([])
  const [activeCue, setActiveCue] = useState<string | null>(null)

  // ── State: sleep timer ──────────────────────────────────────────────────
  const [sleepOption, setSleepOption] = useState<SleepOption>('off')
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null)

  // ── State: Up Next ──────────────────────────────────────────────────────
  const [upNextVisible, setUpNextVisible] = useState(false)
  const upNextDismissedRef = useRef(false)

  // ── State: OpenSubtitles ────────────────────────────────────────────────
  const [osSearchOpen, setOsSearchOpen] = useState(false)
  const [osQuery, setOsQuery] = useState('')
  const [osSearching, setOsSearching] = useState(false)
  const [osResults, setOsResults] = useState<OsSubtitleResult[]>([])
  const [osError, setOsError] = useState('')
  const [activeOsSubId, setActiveOsSubId] = useState<string | null>(null)

  // ── Refs ────────────────────────────────────────────────────────────────
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const markedPlayedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef(0)
  const durationRef = useRef(0)

  // ── Settings from localStorage ──────────────────────────────────────────
  const autoplayNext = getSettingBool('autoplayNext', true)
  const preferredAudioLang = getSettingStr('preferredAudioLang', 'auto')
  const preferredSubtitleLang = getSettingStr('preferredSubtitleLang', 'off')
  const subtitleSize = getSettingStr('subtitleSize', 'medium') as SubtitleSize
  const subtitleBgOpacity = getSettingNum('subtitleBgOpacity', 0.75)
  const discordRPC = getSettingBool('discordRPC', true)
  const directPlaySetting = getSettingBool('directPlay', false)

  // ── Make page background transparent ────────────────────────────────────
  useEffect(() => {
    // Must override the #0a0a0a background-color from index.css for transparent overlay.
    // Both background and background-color are set with !important to ensure
    // the Electron transparent BrowserWindow actually shows mpv behind it.
    const targets = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean) as HTMLElement[]
    for (const el of targets) {
      el.style.setProperty('background', 'transparent', 'important')
      el.style.setProperty('background-color', 'transparent', 'important')
    }
    return () => {
      for (const el of targets) {
        el.style.removeProperty('background')
        el.style.removeProperty('background-color')
      }
    }
  }, [])

  // ── Derived helpers ─────────────────────────────────────────────────────
  const job = currentJob?.job ?? payload?.job
  const title = currentJob?.title ?? payload?.title ?? ''
  const isDirectPlay = !!(job?.directStreamUrl)
  const avPrefsKey = job?.seriesId || job?.itemId || ''

  const nextEpisode = (() => {
    if (!job || job.type !== 'tv' || episodeList.length === 0) return null
    const idx = episodeList.findIndex((ep) => ep.jellyfinId === localEpId)
    if (idx === -1 || idx >= episodeList.length - 1) return null
    return episodeList[idx + 1]
  })()

  const progress = duration > 0 ? time / duration : 0

  // ── Subscribe to IPC events ──────────────────────────────────────────────
  useEffect(() => {
    // Register mpv event listeners FIRST, then fetch payload.
    // This avoids missing the 'ready' event due to race conditions.
    window.electronAPI.mpv.onReady(() => {
      console.log('[overlay] mpv ready')
      setBuffering(false)
    })
    window.electronAPI.mpv.onTime((t) => {
      setTime(t)
      timeRef.current = t
      // If we're still showing the spinner when time updates arrive, clear it
      setBuffering(false)
    })
    window.electronAPI.mpv.onDuration((d) => {
      console.log('[overlay] mpv duration:', d)
      setDuration(d)
      durationRef.current = d
    })
    window.electronAPI.mpv.onPaused((p) => {
      setPaused(p)
      if (!p) setBuffering(false)
    })
    window.electronAPI.mpv.onEnded(() => { setEnded(true) })
    window.electronAPI.mpv.onError((e) => {
      console.error('[overlay] mpv error:', e)
      setError(e)
      setBuffering(false)
    })

    // Now fetch the payload (may already be set in main process)
    const fetchPayload = () => {
      window.electronAPI.mpv.getPayload().then((p) => {
        if (!p) {
          // Payload not yet set — retry in 200ms (overlay may have loaded before mpv:launch set it)
          setTimeout(fetchPayload, 200)
          return
        }
        console.log('[overlay] Got payload:', p.title, '| itemId:', p.itemId)
        setPayload(p)
        setCurrentJob(p)
        setLocalEpId(p.currentEpisodeId)
        setEpisodeListState(p.episodeList ?? [])
        setBuffering(true)
        setError('')
        setEnded(false)
        setTime(0)
        setDuration(0)
      }).catch(() => {})
    }
    fetchPayload()

    return () => { window.electronAPI.mpv.removeAllListeners() }
  }, [])

  // ── Subtitle cue matching on time update ─────────────────────────────────
  useEffect(() => {
    if (!vttCues.length) { setActiveCue(null); return }
    const cue = vttCues.find((c) => time >= c.start && time <= c.end)
    setActiveCue(cue?.text ?? null)
  }, [time, vttCues])

  // ── Up Next trigger — 2 min before end ──────────────────────────────────
  useEffect(() => {
    if (!nextEpisode || !autoplayNext || upNextDismissedRef.current) return
    if (duration <= 0) return
    const remaining = duration - time
    if (remaining <= 120 && remaining > 0) {
      if (!upNextVisible) setUpNextVisible(true)
    } else if (upNextVisible) {
      setUpNextVisible(false)
    }
  }, [time, duration, nextEpisode, autoplayNext, upNextVisible])

  // ── Auto-fetch episode list for Continue Watching ───────────────────────
  useEffect(() => {
    if (!job || episodeList.length > 0 || job.type !== 'tv' || !job.seriesId) return
    let cancelled = false
    ;(async () => {
      try {
        const seasons = await api.getSeasons(job.seriesId!)
        if (cancelled || seasons.length === 0) return
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
            setEpisodeListState(epInfos)
            setLocalEpId(job.itemId)
            break
          }
        }
      } catch {}
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.itemId])

  // ── Auto-select preferred audio/subtitle on open ────────────────────────
  useEffect(() => {
    if (!job) return
    const savedPrefs = loadAvPrefs(avPrefsKey)

    // Audio preference (only for direct play where mpv handles tracks natively)
    if (isDirectPlay) {
      if (savedPrefs?.audio && job.audioTracks.some((t) => t.index === savedPrefs.audio)) {
        setActiveAudio(savedPrefs.audio)
        const track = job.audioTracks.find((t) => t.index === savedPrefs.audio)
        if (track) {
          const mpvAid = track.mpvAid ?? (job.audioTracks.findIndex((t) => t.index === track.index) + 1)
          window.electronAPI.mpv.setAid(mpvAid)
        }
      } else if (preferredAudioLang !== 'auto' && preferredAudioLang !== '') {
        const match = job.audioTracks.find(
          (t) => t.language?.toLowerCase().startsWith(preferredAudioLang.toLowerCase()) && !t.isDefault
        )
        if (match) {
          setActiveAudio(match.index)
          const mpvAid = match.mpvAid ?? (job.audioTracks.findIndex((t) => t.index === match.index) + 1)
          window.electronAPI.mpv.setAid(mpvAid)
        }
      }
    }

    // Subtitle preference
    let restoredSub = false
    if (savedPrefs?.sub !== null && savedPrefs?.sub !== undefined) {
      const subTrack = job.subtitleTracks.find((t) => t.index === savedPrefs.sub)
      if (subTrack) {
        restoredSub = true
        if (isDirectPlay) {
          // Direct play: use mpv native subtitle
          setActiveSub(subTrack.index)
          const mpvSid = subTrack.mpvSid ?? (job.subtitleTracks.findIndex((t) => t.index === subTrack.index) + 1)
          window.electronAPI.mpv.setSid(mpvSid)
        } else if (!subTrack.isImageBased) {
          // HLS: client-side VTT
          setActiveSub(subTrack.index)
          const subPath = `/jellyfin/subtitle-vtt/${job.itemId}/${subTrack.index}`
          api.fetchText(subPath).then((text) => setVttCues(parseVttCues(text))).catch(() => {})
        }
      }
    }

    if (!restoredSub && preferredSubtitleLang !== 'off' && preferredSubtitleLang !== 'auto') {
      const match = job.subtitleTracks.find(
        (t) => t.language?.toLowerCase().startsWith(preferredSubtitleLang)
      )
      if (match) {
        setActiveSub(match.index)
        if (isDirectPlay) {
          const mpvSid = match.mpvSid ?? (job.subtitleTracks.findIndex((t) => t.index === match.index) + 1)
          window.electronAPI.mpv.setSid(mpvSid)
        } else if (!match.isImageBased) {
          const subPath = `/jellyfin/subtitle-vtt/${job.itemId}/${match.index}`
          api.fetchText(subPath).then((text) => setVttCues(parseVttCues(text))).catch(() => {})
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.itemId])

  // ── OpenSubtitles auto-populate query ───────────────────────────────────
  useEffect(() => {
    if (!job) return
    if (job.type === 'tv' && episodeList.length > 0) {
      const ep = episodeList.find((e) => e.jellyfinId === localEpId)
      if (ep) {
        const s = String(ep.seasonNumber).padStart(2, '0')
        const e = String(ep.episodeNumber).padStart(2, '0')
        setOsQuery(`${job.seriesName || job.title} S${s}E${e}`)
        return
      }
    }
    setOsQuery(job.seriesName || job.title)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.itemId, localEpId])

  // ── OpenSubtitles auto-fetch ────────────────────────────────────────────
  const osFetchedRef = useRef(false)
  useEffect(() => {
    if (osFetchedRef.current) return
    if (!job) return
    if (job.type === 'tv' && episodeList.length === 0) return
    osFetchedRef.current = true
    searchOsSubs(job.seriesName || job.title)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.itemId, episodeList.length])

  useEffect(() => { osFetchedRef.current = false }, [localEpId])

  // ── OpenSubtitles auto-select ───────────────────────────────────────────
  const osAutoSelectedRef = useRef(false)
  useEffect(() => {
    if (osAutoSelectedRef.current) return
    if (osResults.length === 0) return
    if (activeSub !== null || activeOsSubId !== null) return
    if (preferredSubtitleLang === 'off') return
    const hasEmbeddedMatch = preferredSubtitleLang !== 'auto' && job?.subtitleTracks.some(
      (t) => t.language?.toLowerCase().startsWith(preferredSubtitleLang)
    )
    if (hasEmbeddedMatch) return
    const lang = preferredSubtitleLang === 'auto' ? 'en' : preferredSubtitleLang
    const match = osResults.find((s) => s.language?.toLowerCase().startsWith(lang) && s.fileId)
    if (match) {
      osAutoSelectedRef.current = true
      applyOsSub(match)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osResults])

  // ── Heartbeat ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!job) return
    heartbeatRef.current = setInterval(() => {
      const curTime = timeRef.current
      const dur = durationRef.current
      if (!dur) return
      const posTicks = Math.floor(curTime * 10_000_000)
      const durTicks = Math.floor(dur * 10_000_000)
      api.reportProgress({
        itemId: job.itemId,
        positionTicks: posTicks,
        durationTicks: durTicks,
        isPaused: paused,
        playSessionId: job.playSessionId ?? '',
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
      const pct = durTicks > 0 ? (posTicks / durTicks) * 100 : 0
      if (pct > 90 && !markedPlayedRef.current) {
        markedPlayedRef.current = true
        api.markItemPlayed(job.itemId).catch(() => {})
      }
    }, 10_000)
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current) }
  }, [job, paused])

  // ── Discord Rich Presence ───────────────────────────────────────────────
  useEffect(() => {
    if (!discordRPC || !job) return
    const curTime = timeRef.current
    const durSecs = durationRef.current || (job.durationTicks ?? 0) / 10_000_000
    let details: string = job.seriesName || job.title
    if (details.length > 128) details = details.slice(0, 125) + '...'

    let epLabel = ''
    if (job.type === 'tv' && episodeList.length > 0) {
      const ep = episodeList.find((e) => e.jellyfinId === localEpId)
      if (ep) {
        const s = String(ep.seasonNumber).padStart(2, '0')
        const e = String(ep.episodeNumber).padStart(2, '0')
        epLabel = `S${s}E${e} - ${ep.title || 'Episode ' + ep.episodeNumber}`
      }
    }

    let state: string
    if (paused) {
      const pos = durSecs > 0 ? `${fmt(curTime)} / ${fmt(durSecs)}` : fmt(curTime)
      state = `Paused · ${pos}`
    } else {
      state = epLabel || (job.seriesName || job.title)
    }
    if (state.length < 2) state = '  '

    const nowSec = Math.floor(Date.now() / 1000)
    window.electronAPI.discord.setActivity({
      details,
      state,
      startTimestamp: !paused && !durSecs ? nowSec - Math.floor(curTime) : undefined,
      endTimestamp: !paused && durSecs > 0 ? nowSec + Math.max(0, Math.floor(durSecs - curTime)) : undefined,
      largeImageKey: job.posterUrl || 'logo',
      largeImageText: job.seriesName || job.title,
      smallImageKey: job.posterUrl ? 'logo' : undefined,
      smallImageText: job.posterUrl ? 'VALOR' : undefined,
      instance: false,
      buttons: [{ label: 'Get VALOR', url: 'https://valor.dawn-star.co.uk/downloads/' }],
    }).catch(() => {})
  }, [paused, job, time, discordRPC, episodeList, localEpId])

  // ── Sleep timer countdown ───────────────────────────────────────────────
  useEffect(() => {
    if (sleepOption === 'off' || sleepOption === 'end') { setSleepRemaining(null); return }
    setSleepRemaining(parseInt(sleepOption) * 60)
  }, [sleepOption])

  useEffect(() => {
    if (sleepRemaining === null || sleepRemaining <= 0) return
    const t = setTimeout(() => setSleepRemaining((prev) => (prev !== null ? prev - 1 : null)), 1000)
    return () => clearTimeout(t)
  }, [sleepRemaining])

  useEffect(() => {
    if (sleepRemaining !== 0) return
    setSleepRemaining(null)
    setSleepOption('off')
    handleClose()
    setTimeout(() => window.electronAPI.system.sleep().catch(() => {}), 800)
  }, [sleepRemaining]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ended handler: sleep / Up Next / mark played ────────────────────────
  useEffect(() => {
    if (!ended) return
    if (!markedPlayedRef.current && job) {
      markedPlayedRef.current = true
      api.markItemPlayed(job.itemId).catch(() => {})
    }
    if (sleepOption === 'end') {
      handleClose()
      setTimeout(() => window.electronAPI.system.sleep().catch(() => {}), 800)
      return
    }
    if (nextEpisode && autoplayNext && !upNextDismissedRef.current) {
      switchEpisode(nextEpisode)
      return
    }
    // Auto-advance fallback
    if (autoplayNext && episodeList.length > 0) {
      const idx = episodeList.findIndex((ep) => ep.jellyfinId === localEpId)
      if (idx >= 0 && idx < episodeList.length - 1) {
        switchEpisode(episodeList[idx + 1])
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended])

  // ── Close handler ───────────────────────────────────────────────────────
  const handleClose = useCallback(async () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    if (job) {
      api.reportProgress({
        itemId: job.itemId,
        positionTicks: Math.floor(timeRef.current * 10_000_000),
        durationTicks: Math.floor(durationRef.current * 10_000_000),
        isPaused: true,
        playSessionId: job.playSessionId ?? '',
        isStopped: true,
      }).catch(() => {})
      api.reportUserProgress({
        mediaId: job.itemId,
        positionTicks: Math.floor(timeRef.current * 10_000_000),
        durationTicks: Math.floor(durationRef.current * 10_000_000),
        title: job.seriesName || job.title,
        posterUrl: job.posterUrl,
        type: job.seriesId ? 'tv' : job.type,
        tmdbId: job.tmdbId,
        seriesId: job.seriesId,
        isStopped: true,
      }).catch(() => {})
    }
    if (discordRPC) window.electronAPI.discord.clearActivity().catch(() => {})
    await window.electronAPI.mpv.quit()
  }, [job, discordRPC])

  // ── Controls auto-hide ──────────────────────────────────────────────────
  function showControls() {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!showSettings && !showSubtitlePanel && !showEpisodePanel) setControlsVisible(false)
    }, 3000)
  }

  // ── Overlay mouse click-through (tell main process) ─────────────────────
  const setInteractive = useCallback((interactive: boolean) => {
    window.electronAPI.overlay.setIgnoreMouse(!interactive).catch(() => {})
  }, [])

  // ── Volume / mute ───────────────────────────────────────────────────────
  function changeVolume(val: number) {
    setVolume(val)
    setMuted(val === 0)
    window.electronAPI.mpv.setVolume(val)
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    window.electronAPI.mpv.setVolume(next ? 0 : volume)
  }

  // ── Speed ───────────────────────────────────────────────────────────────
  function changeSpeed(speed: number) {
    setActiveSpeed(speed)
    window.electronAPI.mpv.setSpeed(speed)
    setShowSettings(false)
  }

  // ── Track switching ─────────────────────────────────────────────────────

  async function switchAudio(track: AudioTrack) {
    setActiveAudio(track.index)
    saveAvPrefs(avPrefsKey, track.index, activeSub)
    setShowSettings(false)

    if (isDirectPlay) {
      const mpvAid = track.mpvAid
        ?? (job!.audioTracks.findIndex((t) => t.index === track.index) + 1)
      await window.electronAPI.mpv.setAid(mpvAid)
      return
    }

    // HLS transcode: must restart the stream
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: job!.itemId,
        audioStreamIndex: track.index,
        maxBitrate: QUALITY_PRESETS[activeQuality].maxBitrate || undefined,
        startTimeTicks: timeRef.current > 0 ? Math.floor(timeRef.current * 10_000_000) : undefined,
        previousPlaySessionId: job!.playSessionId || undefined,
        previousDeviceId: job!.deviceId,
      })
      await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
      setCurrentJob({ ...currentJob!, job: newJob })
    } catch {
      setError('Failed to switch audio track')
      setBuffering(false)
    }
  }

  async function switchSubtitle(track: SubtitleTrack | null) {
    setActiveSub(track?.index ?? null)
    saveAvPrefs(avPrefsKey, activeAudio, track?.index ?? null)
    setVttCues([])
    setActiveCue(null)
    setActiveOsSubId(null)
    setShowSubtitlePanel(false)

    if (!track) {
      if (isDirectPlay) await window.electronAPI.mpv.setSid(0)
      return
    }

    if (isDirectPlay) {
      const mpvSid = track.mpvSid
        ?? (job!.subtitleTracks.findIndex((t) => t.index === track.index) + 1)
      await window.electronAPI.mpv.setSid(mpvSid)
      return
    }

    if (track.isImageBased) {
      // PGS → server-side burn-in
      setBuffering(true)
      try {
        const newJob = await api.startPlayJob({
          itemId: job!.itemId,
          subtitleStreamIndex: track.index,
          audioStreamIndex: activeAudio,
          maxBitrate: QUALITY_PRESETS[activeQuality].maxBitrate || undefined,
          startTimeTicks: timeRef.current > 0 ? Math.floor(timeRef.current * 10_000_000) : undefined,
          previousPlaySessionId: job!.playSessionId || undefined,
          previousDeviceId: job!.deviceId,
        })
        await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
        setCurrentJob({ ...currentJob!, job: newJob })
      } catch {
        setError('Failed to switch subtitle')
        setBuffering(false)
      }
      return
    }

    // VTT subtitle → client-side rendering
    const subPath = `/jellyfin/subtitle-vtt/${job!.itemId}/${track.index}`
    try {
      const text = await api.fetchText(subPath)
      setVttCues(parseVttCues(text))
    } catch {
      setActiveSub(null)
    }
  }

  async function switchQuality(preset: typeof QUALITY_PRESETS[number], index: number) {
    if (isDirectPlay) return
    if (!job) return
    setActiveQuality(index)
    setShowSettings(false)
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: job.itemId,
        maxBitrate: preset.maxBitrate || undefined,
        audioStreamIndex: activeAudio,
        startTimeTicks: timeRef.current > 0 ? Math.floor(timeRef.current * 10_000_000) : undefined,
        previousPlaySessionId: job.playSessionId || undefined,
        previousDeviceId: job.deviceId,
      })
      await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
      setCurrentJob({ ...currentJob!, job: newJob })
    } catch {
      setError('Failed to switch quality')
      setBuffering(false)
    }
  }

  async function switchToTranscoded() {
    if (!job) return
    setShowSettings(false)
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: job.itemId,
        maxBitrate: 10_000_000,
        startTimeTicks: timeRef.current > 0 ? Math.floor(timeRef.current * 10_000_000) : undefined,
      })
      await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
      setCurrentJob({ ...currentJob!, job: newJob })
    } catch {
      setError('Failed to switch to transcoded stream')
      setBuffering(false)
    }
  }

  async function switchEpisode(ep: EpisodeInfo) {
    setUpNextVisible(false)
    upNextDismissedRef.current = false
    markedPlayedRef.current = false
    setShowEpisodePanel(false)
    setBuffering(true)
    setTime(0)
    setDuration(0)
    setLocalEpId(ep.jellyfinId)
    setVttCues([])
    setActiveCue(null)
    setEnded(false)
    osFetchedRef.current = false
    osAutoSelectedRef.current = false
    setOsResults([])
    setActiveOsSubId(null)
    try {
      const newJob = await api.startPlayJob({
        itemId: ep.jellyfinId,
        directPlay: directPlaySetting,
        previousPlaySessionId: job?.playSessionId || undefined,
        previousDeviceId: job?.deviceId,
      })
      await window.electronAPI.mpv.loadFile(newJob.directStreamUrl ?? newJob.hlsUrl)
      setCurrentJob({
        ...currentJob!,
        job: newJob,
        title: ep.title,
        currentEpisodeId: ep.jellyfinId,
      })
    } catch {
      setError('Failed to load episode')
      setBuffering(false)
    }
  }

  // ── OpenSubtitles ───────────────────────────────────────────────────────

  async function searchOsSubs(query?: string) {
    setOsSearching(true)
    setOsError('')
    setOsResults([])
    try {
      const curEp = job?.type === 'tv' && episodeList.length > 0
        ? episodeList.find((e) => e.jellyfinId === localEpId)
        : null
      const results = await api.searchSubtitles({
        query: query || osQuery.trim() || undefined,
        tmdbId: job?.tmdbId ?? undefined,
        type: job?.type === 'tv' ? 'tv' : 'movie',
        season: curEp?.seasonNumber,
        episode: curEp?.episodeNumber,
      })
      results.sort((a, b) => b.downloadCount - a.downloadCount)
      setOsResults(results)
      if (results.length === 0 && query) setOsError('No subtitles found')
    } catch {
      if (query) setOsError('Search failed')
    } finally {
      setOsSearching(false)
    }
  }

  async function applyOsSub(sub: OsSubtitleResult) {
    if (!sub.fileId) { setOsError('No file ID'); return }
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

  // ── Format helpers ──────────────────────────────────────────────────────
  function fmt(sec: number) {
    if (!sec || isNaN(sec)) return '0:00'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  // ── Gamepad navigation ──────────────────────────────────────────────────

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

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const onMouse = () => { gpSetFocus(null); setGpZone('none'); setShowVolumePopup(false) }
    c.addEventListener('mousemove', onMouse, { passive: true })
    return () => c.removeEventListener('mousemove', onMouse)
  }, [gpSetFocus])

  const gpGetPanelItems = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return []
    return Array.from(containerRef.current.querySelectorAll<HTMLElement>('.z-30 [data-focusable]')).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
  }, [])

  const gpGetControlButtons = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return []
    return Array.from(containerRef.current.querySelectorAll<HTMLElement>('[data-gp-control]')).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
  }, [])

  const gpPanelMove = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    const items = gpGetPanelItems()
    if (items.length === 0) return
    const current = gpFocusRef.current
    if (!current || !items.includes(current)) { gpSetFocus(items[0]); return }
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

  const gpDpad = useCallback((dir: 'up' | 'down' | 'left' | 'right', isRepeat = false) => {
    showControls()

    if (gpZone === 'volume' && showVolumePopup) {
      if (dir === 'up') changeVolume(Math.min(100, volume + 5))
      else if (dir === 'down') changeVolume(Math.max(0, volume - 5))
      else { setShowVolumePopup(false); setGpZone('controls') }
      return
    }

    if (upNextVisible && nextEpisode) {
      if (gpZone !== 'upnext') {
        setGpZone('upnext')
        const playBtn = containerRef.current?.querySelector<HTMLElement>('[data-upnext-play]')
        if (playBtn) gpSetFocus(playBtn)
        return
      }
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

    if (gpZone === 'none') {
      setGpZone('controls')
      const btns = gpGetControlButtons()
      if (btns.length > 0) { setGpControlIdx(0); gpSetFocus(btns[0]) }
      return
    }

    if (gpZone === 'seek') {
      if (dir === 'left' || dir === 'right') {
        if (isRepeat) seekHoldCount.current++; else seekHoldCount.current = 0
        const delta = seekHoldCount.current > 3 ? 30 : 10
        window.electronAPI.mpv.seek(dir === 'left' ? -delta : delta)
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
      return
    }

    if (gpZone === 'controls') {
      if (dir === 'left' || dir === 'right') {
        const btns = gpGetControlButtons()
        if (btns.length === 0) return
        const nextIdx = dir === 'left' ? Math.max(0, gpControlIdx - 1) : Math.min(btns.length - 1, gpControlIdx + 1)
        setGpControlIdx(nextIdx)
        gpSetFocus(btns[nextIdx])
      } else if (dir === 'up') {
        setGpZone('seek')
        gpSetFocus(null)
      } else if (dir === 'down') {
        setGpZone('none')
        gpSetFocus(null)
        setControlsVisible(false)
      }
    }
  }, [gpZone, panelOpen, showVolumePopup, volume, gpControlIdx, upNextVisible, nextEpisode,
      gpGetControlButtons, gpGetPanelItems, gpSetFocus, gpPanelMove])

  const gpActivate = useCallback(() => {
    if (gpZone === 'volume' && showVolumePopup) { setShowVolumePopup(false); setGpZone('controls'); return }
    if (gpZone === 'upnext' && gpFocusRef.current) { gpFocusRef.current.click(); return }
    if (gpZone === 'panel' && gpFocusRef.current) { gpFocusRef.current.click(); return }
    if (gpZone === 'controls' && gpFocusRef.current) { gpFocusRef.current.click(); return }
    window.electronAPI.mpv.togglePause()
  }, [gpZone, showVolumePopup])

  const gpBack = useCallback(() => {
    gpSetFocus(null)
    if (upNextVisible && gpZone === 'upnext') { upNextDismissedRef.current = true; setUpNextVisible(false); handleClose(); return }
    if (showVolumePopup) { setShowVolumePopup(false); setGpZone('controls'); return }
    if (showSettings) { setShowSettings(false); setGpZone('controls'); return }
    if (showSubtitlePanel) { setShowSubtitlePanel(false); setGpZone('controls'); return }
    if (showEpisodePanel) { setShowEpisodePanel(false); setGpZone('controls'); return }
    setControlsVisible(false)
    setGpZone('none')
    handleClose()
  }, [showVolumePopup, showSettings, showSubtitlePanel, showEpisodePanel, upNextVisible, gpZone, handleClose, gpSetFocus])

  useEffect(() => {
    if (panelOpen) setGpZone('panel')
    else if (gpZone === 'panel') setGpZone('controls')
  }, [panelOpen])

  useEffect(() => {
    if (upNextVisible && gpZone !== 'none') {
      setGpZone('upnext')
      setTimeout(() => {
        const playBtn = containerRef.current?.querySelector<HTMLElement>('[data-upnext-play]')
        if (playBtn) gpSetFocus(playBtn)
      }, 100)
    } else if (!upNextVisible && gpZone === 'upnext') {
      setGpZone('none')
      gpSetFocus(null)
    }
  }, [upNextVisible])

  const openVolumePopup = useCallback(() => {
    setShowVolumePopup(true)
    setGpZone('volume')
  }, [])

  useGamepad({
    buttons: {
      0: { onPress: gpActivate },
      1: { onPress: gpBack },
      2: { onPress: toggleMute },
      4: { onPress: () => { if (currentEpIdx > 0) switchEpisode(episodeList[currentEpIdx - 1]) } },
      5: { onPress: () => { if (currentEpIdx < episodeList.length - 1) switchEpisode(episodeList[currentEpIdx + 1]) } },
      6: { onPress: () => { window.electronAPI.mpv.seek(-30); showControls() } },
      7: { onPress: () => { window.electronAPI.mpv.seek(30); showControls() } },
      12: { onPress: () => gpDpad('up'), onRepeat: () => gpDpad('up', true), repeatDelay: 400, repeatInterval: 150 },
      13: { onPress: () => gpDpad('down'), onRepeat: () => gpDpad('down', true), repeatDelay: 400, repeatInterval: 150 },
      14: { onPress: () => gpDpad('left'), onRepeat: () => gpDpad('left', true), repeatDelay: 400, repeatInterval: 150 },
      15: { onPress: () => gpDpad('right'), onRepeat: () => gpDpad('right', true), repeatDelay: 400, repeatInterval: 150 },
    },
    axes: [
      { axis: 0, direction: 'negative', onPress: () => gpDpad('left'), onRepeat: () => gpDpad('left', true), repeatDelay: 400, repeatInterval: 150 },
      { axis: 0, direction: 'positive', onPress: () => gpDpad('right'), onRepeat: () => gpDpad('right', true), repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'negative', onPress: () => gpDpad('up'), onRepeat: () => gpDpad('up', true), repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'positive', onPress: () => gpDpad('down'), onRepeat: () => gpDpad('down', true), repeatDelay: 400, repeatInterval: 150 },
    ],
    onAnyInput: showControls,
  })

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); window.electronAPI.mpv.togglePause() }
      else if (e.key === 'ArrowLeft') window.electronAPI.mpv.seek(-10)
      else if (e.key === 'ArrowRight') window.electronAPI.mpv.seek(10)
      else if (e.key === 'ArrowUp') changeVolume(Math.min(100, volume + 5))
      else if (e.key === 'ArrowDown') changeVolume(Math.max(0, volume - 5))
      else if (e.key === 'Escape') handleClose()
      else if (e.key === 'm') toggleMute()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [volume, handleClose])

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex flex-col select-none"
      style={{ background: 'transparent' }}
      onMouseMove={() => { showControls(); setInteractive(true) }}
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
          <p className="text-white/70 text-lg">Playback finished</p>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/70"
          onMouseEnter={() => setInteractive(true)}
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
          <div
            className="px-3 py-1.5 rounded text-white text-center max-w-2xl"
            style={{
              backgroundColor: `rgba(0,0,0,${subtitleBgOpacity})`,
              fontSize: SUBTITLE_FONT_SIZE[subtitleSize],
            }}
          >
            {activeCue.split('\n').map((line, i) => <p key={i}>{line}</p>)}
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
          onMouseEnter={() => setInteractive(true)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">Up Next</span>
            <button
              data-focusable data-upnext-dismiss
              onClick={() => { upNextDismissedRef.current = true; setUpNextVisible(false) }}
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
              data-focusable data-upnext-play
              onClick={() => switchEpisode(nextEpisode)}
              className="flex-1 px-3 py-1.5 bg-white text-black text-xs font-semibold rounded-lg hover:bg-white/90 transition-colors"
            >
              Play Now
            </button>
            <span className="text-white/30 text-xs tabular-nums">
              {Math.max(0, Math.ceil(duration - time))}s
            </span>
          </div>
        </motion.div>
      )}

      {/* Close button */}
      <button
        onClick={(e) => { e.stopPropagation(); handleClose() }}
        onMouseEnter={() => setInteractive(true)}
        className={`absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-black/50
                    flex items-center justify-center transition-opacity duration-300
                    hover:bg-black/80 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <X size={18} className="text-white" />
      </button>

      {/* Transparent click-through area — reset to ignore when mouse leaves controls */}
      <div
        className="flex-1"
        onMouseEnter={() => setInteractive(false)}
        onClick={() => window.electronAPI.mpv.togglePause()}
      />

      {/* Controls bar */}
      <motion.div
        animate={{ opacity: controlsVisible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-16
                   bg-gradient-to-t from-black/90 via-black/40 to-transparent"
        style={{ pointerEvents: controlsVisible ? 'auto' : 'none' }}
        onMouseEnter={() => setInteractive(true)}
        onMouseLeave={() => { if (!panelOpen) setInteractive(false) }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <p className="text-white font-semibold text-sm mb-3 truncate">{title}</p>

        {/* Progress bar */}
        <div
          className={`relative h-1.5 rounded-full mb-4 cursor-pointer group/seek transition-all ${
            gpZone === 'seek' ? 'h-2.5 bg-white/30' : 'bg-white/20'
          }`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const frac = (e.clientX - rect.left) / rect.width
            window.electronAPI.mpv.seekAbsolute(frac * duration)
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
          {gpZone === 'seek' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-white/60 text-[10px] whitespace-nowrap">
              ◀ {fmt(time)} ▶
            </div>
          )}
        </div>

        {/* Control row */}
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button data-gp-control data-focusable onClick={() => window.electronAPI.mpv.togglePause()} className="text-white hover:text-white/80 transition">
            {paused ? <Play size={22} fill="white" /> : <Pause size={22} />}
          </button>

          {/* Skip */}
          <button data-gp-control data-focusable onClick={() => window.electronAPI.mpv.seek(-10)} className="text-white/70 hover:text-white transition">
            <SkipBack size={18} />
          </button>
          <button data-gp-control data-focusable onClick={() => window.electronAPI.mpv.seek(10)} className="text-white/70 hover:text-white transition">
            <SkipForward size={18} />
          </button>

          {/* Volume */}
          <div className="relative flex items-center gap-1">
            <button
              data-gp-control data-focusable
              onClick={() => { if (gpZone === 'controls') openVolumePopup(); else toggleMute() }}
              className="text-white/70 hover:text-white transition"
            >
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            {!showVolumePopup && (
              <input
                type="range" min={0} max={100} step={1}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="w-20 accent-red-500"
              />
            )}
            {showVolumePopup && (
              <div
                className="absolute bottom-full left-0 mb-3 w-10 bg-black/90 backdrop-blur-md
                           rounded-xl border border-white/15 py-3 flex flex-col items-center gap-1.5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-white/70 text-[10px] tabular-nums font-medium">{Math.round(muted ? 0 : volume)}</span>
                <div className="relative w-1.5 h-28 bg-white/15 rounded-full overflow-hidden">
                  <div className="absolute bottom-0 left-0 right-0 bg-red-500 rounded-full transition-all" style={{ height: `${muted ? 0 : volume}%` }} />
                </div>
                <span className="text-white/30 text-[9px]">VOL</span>
              </div>
            )}
          </div>

          {/* Time */}
          <span className="text-white/60 text-xs tabular-nums ml-1">
            {fmt(time)} / {fmt(duration)}
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
            data-gp-control data-focusable
            onClick={() => { setShowSettings((v) => !v); setShowSubtitlePanel(false); setShowEpisodePanel(false) }}
            className={`text-white/70 hover:text-white transition ${showSettings ? 'text-white' : ''}`}
          >
            <Settings size={18} />
          </button>

          {/* Subtitles */}
          <button
            data-gp-control data-focusable
            onClick={() => { setShowSubtitlePanel((v) => !v); setShowSettings(false); setShowEpisodePanel(false) }}
            className={`text-white/70 hover:text-white transition ${showSubtitlePanel ? 'text-white' : ''}`}
          >
            <Subtitles size={18} />
          </button>

          {/* Episode picker */}
          {episodeList.length > 0 && (
            <button
              data-gp-control data-focusable
              onClick={() => { setShowEpisodePanel((v) => !v); setShowSettings(false); setShowSubtitlePanel(false) }}
              className={`text-white/70 hover:text-white transition ${showEpisodePanel ? 'text-white' : ''}`}
              title="Episodes"
            >
              <List size={18} />
            </button>
          )}
        </div>
      </motion.div>

      {/* ── Subtitle panel — unified Stremio-style ────────────────────────── */}
      {showSubtitlePanel && job && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-24 right-4 w-80 bg-[#141414]/95 backdrop-blur-xl border border-white/10
                     rounded-2xl shadow-2xl overflow-hidden z-30"
          onMouseEnter={() => setInteractive(true)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Subtitles</p>
            {osSearching && <Loader2 size={14} className="text-white/40 animate-spin" />}
          </div>

          <div className="max-h-[28rem] overflow-y-auto py-1">
            {/* Off */}
            <button
              data-focusable
              onClick={() => { switchSubtitle(null); setActiveOsSubId(null) }}
              className={`w-full text-left px-4 py-2.5 text-sm transition ${
                activeSub === null && activeOsSubId === null
                  ? 'bg-red-600/15 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              Off
            </button>

            {/* Grouped by language */}
            {(() => {
              const groups = new Map<string, { embedded: typeof job.subtitleTracks, external: typeof osResults }>()
              for (const t of job.subtitleTracks) {
                const lang = (t.language || 'und').toLowerCase()
                if (!groups.has(lang)) groups.set(lang, { embedded: [], external: [] })
                groups.get(lang)!.embedded.push(t)
              }
              for (const s of osResults) {
                const lang = (s.language || 'und').toLowerCase()
                if (!groups.has(lang)) groups.set(lang, { embedded: [], external: [] })
                groups.get(lang)!.external.push(s)
              }
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
                if (group.embedded.length === 0 && group.external.length === 0) return null
                return (
                  <div key={lang}>
                    <div className="px-4 pt-3 pb-1">
                      <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{langLabel}</span>
                    </div>
                    {group.embedded.map((t) => (
                      <button
                        key={`emb-${t.index}`} data-focusable
                        onClick={() => { switchSubtitle(t); setActiveOsSubId(null) }}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition ${
                          activeSub === t.index ? 'bg-red-600/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <span className="flex-1 truncate">{t.label || t.language}</span>
                        <span className="text-[9px] bg-white/8 text-white/40 px-1.5 py-0.5 rounded">Embedded</span>
                        {t.isImageBased && <span className="text-[9px] bg-yellow-600/20 text-yellow-400 px-1.5 py-0.5 rounded">PGS</span>}
                      </button>
                    ))}
                    {group.external.map((sub) => (
                      <button
                        key={`os-${sub.id}`} data-focusable
                        onClick={() => applyOsSub(sub)}
                        className={`w-full text-left px-4 py-2 transition ${
                          activeOsSubId === sub.id ? 'bg-red-600/15 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-1 truncate text-sm">{sub.name || 'Unnamed'}</span>
                          <div className="flex-shrink-0 flex gap-1">
                            {sub.hearingImpaired && <span className="text-[9px] bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded">HI</span>}
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

            {job.subtitleTracks.length === 0 && osResults.length === 0 && !osSearching && (
              <p className="px-4 py-3 text-xs text-white/30">No subtitles available</p>
            )}

            {/* Manual search */}
            <div className="border-t border-white/5 mt-1 p-2">
              <button
                data-focusable
                onClick={() => setOsSearchOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-white/30 hover:text-white/60 hover:bg-white/5 transition"
              >
                <span className="flex items-center gap-1.5"><Search size={11} /> Search manually</span>
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
                      className="flex-1 min-w-0 bg-white/10 border border-white/10 rounded-lg text-white text-xs px-2.5 py-1.5 outline-none placeholder:text-white/20"
                    />
                    <button
                      data-focusable
                      onClick={() => searchOsSubs()}
                      disabled={osSearching}
                      className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white transition disabled:opacity-40 flex items-center"
                    >
                      {osSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    </button>
                  </div>
                  {osError && !osSearching && <p className="px-3 py-1 text-xs text-red-400">{osError}</p>}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Episode picker panel ──────────────────────────────────────────── */}
      {showEpisodePanel && episodeList.length > 0 && job && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-24 right-4 w-80 bg-[#141414]/95 backdrop-blur-xl border border-white/10
                     rounded-2xl shadow-2xl overflow-hidden z-30"
          onMouseEnter={() => setInteractive(true)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{job.seriesName || job.title}</p>
              <p className="text-[11px] text-white/40 mt-0.5">
                Season {episodeList[0]?.seasonNumber ?? '?'} · {episodeList.length} Episode{episodeList.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {episodeList.map((ep) => {
              const isCurrent = localEpId === ep.jellyfinId
              const isWatched = (ep.playedPercentage ?? 0) >= 90
              const sNum = String(ep.seasonNumber).padStart(2, '0')
              const eNum = String(ep.episodeNumber).padStart(2, '0')
              return (
                <button
                  key={ep.jellyfinId} data-focusable
                  onClick={() => switchEpisode(ep)}
                  className={`w-full text-left px-4 py-2.5 transition flex items-center gap-3 ${
                    isCurrent ? 'bg-red-600/15' : 'hover:bg-white/5'
                  }`}
                >
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
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-medium tracking-wide ${isCurrent ? 'text-red-400' : 'text-white/30'}`}>S{sNum}E{eNum}</p>
                    <p className={`text-sm truncate leading-tight ${isCurrent ? 'text-white font-medium' : 'text-white/70'}`}>{ep.title || `Episode ${ep.episodeNumber}`}</p>
                  </div>
                  {isWatched && !isCurrent && <Check size={13} className="flex-shrink-0 text-emerald-400/70" />}
                </button>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* ── Settings panel ────────────────────────────────────────────────── */}
      {showSettings && job && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="absolute bottom-24 right-4 w-72 bg-[#1a1a1a] border border-white/10
                     rounded-xl shadow-2xl overflow-hidden z-30"
          onMouseEnter={() => setInteractive(true)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex border-b border-white/10">
            {(['audio', 'quality', 'speed', 'sleep'] as const).map((tab) => (
              <button
                key={tab} data-focusable
                onClick={() => setSettingsTab(tab)}
                className={`flex-1 py-2.5 text-xs font-medium capitalize transition ${
                  settingsTab === tab ? 'text-white border-b-2 border-red-500' : 'text-white/40 hover:text-white/70'
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
                    Playing original file directly. Audio tracks can be switched natively by mpv.
                  </p>
                  {job.audioTracks.map((t) => (
                    <button
                      key={t.index} data-focusable
                      onClick={() => switchAudio(t)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                        activeAudio === t.index ? 'bg-red-600/20 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white'
                      }`}
                    >
                      {t.label || t.language} {t.isDefault && '· Default'}
                    </button>
                  ))}
                </div>
              ) : (
                job.audioTracks.map((t) => (
                  <button
                    key={t.index} data-focusable
                    onClick={() => switchAudio(t)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      activeAudio === t.index ? 'bg-red-600/20 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white'
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
                  <p className="text-xs text-white/40 leading-relaxed">Playing original quality.</p>
                  <button
                    data-focusable
                    onClick={switchToTranscoded}
                    className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition"
                  >
                    Switch to Transcoded Stream
                  </button>
                </div>
              ) : (
                QUALITY_PRESETS.map((preset, i) => (
                  <button
                    key={preset.label} data-focusable
                    onClick={() => switchQuality(preset, i)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      activeQuality === i ? 'bg-red-600/20 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white'
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
                  key={s} data-focusable
                  onClick={() => changeSpeed(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                    activeSpeed === s ? 'bg-red-600/20 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  {s === 1 ? 'Normal' : `${s}×`}
                </button>
              ))}

            {settingsTab === 'sleep' && (
              <>
                {SLEEP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value} data-focusable
                    onClick={() => setSleepOption(opt.value)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      sleepOption === opt.value ? 'bg-red-600/20 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white'
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
    </div>
  )
}
