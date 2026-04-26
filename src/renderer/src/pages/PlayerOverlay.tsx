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
  Maximize,
  Minimize,
} from 'lucide-react'
import * as api from '@/services/api'
import type { OsSubtitleResult } from '@/services/api'
import type { MpvLaunchPayload } from '@/types/electron'
import type { AudioTrack, EpisodeInfo, PlayJob } from '@/types/media'
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

const STAGING_PHASE_LABELS: Record<string, string> = {
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
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ── State: UI panels ────────────────────────────────────────────────────
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'audio' | 'quality' | 'speed' | 'sleep'>('audio')
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false)
  const [showEpisodePanel, setShowEpisodePanel] = useState(false)
  const [localEpId, setLocalEpId] = useState('')
  const [episodeList, setEpisodeListState] = useState<EpisodeInfo[]>([])

  // ── State: episode staging via on-demand pipeline ───────────────────────
  // Set when switchEpisode hits a TMDB-only id and has to ask the backend
  // to stage the file into Jellyfin first. Drives the centred status box.
  const [stagingPhase, setStagingPhase] = useState('')
  const [stagingMessage, setStagingMessage] = useState('')

  // ── State: track selections ─────────────────────────────────────────────
  const [activeAudio, setActiveAudio] = useState(0)
  const [activeQuality, setActiveQuality] = useState(0)
  const [activeSpeed, setActiveSpeed] = useState(1)
  const [volume, setVolume] = useState(100)
  const [muted, setMuted] = useState(false)

  // ── State: subtitle rendering ───────────────────────────────────────────
  const [vttCues, setVttCues] = useState<VttCue[]>([])
  const [activeCue, setActiveCue] = useState<string | null>(null)
  const [subOffset, setSubOffset] = useState(0) // seconds (+/- shift for subtitle timing)
  const [editingOffset, setEditingOffset] = useState(false)
  const [editingOffsetValue, setEditingOffsetValue] = useState('')

  // ── State: sleep timer ──────────────────────────────────────────────────
  const [sleepOption, setSleepOption] = useState<SleepOption>('off')
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null)

  // ── State: Up Next ──────────────────────────────────────────────────────
  const [upNextVisible, setUpNextVisible] = useState(false)
  const upNextDismissedRef = useRef(false)

  // ── State: OpenSubtitles ────────────────────────────────────────────────
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
  const rawTitle = currentJob?.title ?? payload?.title ?? ''
  const title = (() => {
    if (!job || job.type !== 'tv') return rawTitle
    const s = job.seasonNumber
    const e = job.episodeNumber
    const epName = job.episodeName
    if (s != null && e != null) {
      const label = `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`
      return `${rawTitle} · ${label}${epName ? ` · ${epName}` : ''}`
    }
    return rawTitle
  })()
  const isDirectPlay = !!(job?.directStreamUrl)
  const avPrefsKey = job?.seriesId || job?.itemId || ''

  // ── Playback context (skip-segments + next episode) ─────────────────────
  const [pbCtx, setPbCtx] = useState<api.PlaybackContext | null>(null)
  useEffect(() => {
    setPbCtx(null)
    if (!job?.tmdbId) return
    const isTV = job.type === 'tv' || !!job.seriesId
    const dur = (job.durationTicks ?? 0) / 10_000_000
    api.getPlaybackContext({
      tmdbId: job.tmdbId,
      type: isTV ? 'tv' : 'movie',
      season: job.seasonNumber ?? undefined,
      episode: job.episodeNumber ?? undefined,
      isAnime: job.isAnime,
      duration: dur > 0 ? dur : undefined,
    }).then(setPbCtx).catch(() => setPbCtx(null))
  }, [job?.tmdbId, job?.seasonNumber, job?.episodeNumber, job?.seriesId, job?.type, job?.isAnime, job?.durationTicks])

  const introStart = pbCtx?.introStartSec ?? job?.introStartSec ?? null
  const introEnd   = pbCtx?.introEndSec   ?? job?.introEndSec   ?? null
  const creditsStart = pbCtx?.creditsStartSec ?? job?.creditsStartSec ?? null

  const nextEpisode = (() => {
    if (!job || job.type !== 'tv' || episodeList.length === 0) return null
    const apiNext = pbCtx?.nextEpisode
    if (apiNext) {
      const match = episodeList.find(e =>
        e.seasonNumber === apiNext.seasonNumber && e.episodeNumber === apiNext.episodeNumber
      )
      if (match) return match
    }
    const idx = episodeList.findIndex((ep) => ep.jellyfinId === localEpId)
    if (idx === -1 || idx >= episodeList.length - 1) return null
    return episodeList[idx + 1]
  })()

  // Use Jellyfin's known duration when available — mpv's `duration` property
  // grows as HLS segments load, so the progress bar would start at a tiny value
  // and the seek bar only maps to what's been buffered so far.
  const knownDuration = (job?.durationTicks ?? 0) / 10_000_000
  const effectiveDuration = knownDuration > 0 ? knownDuration : duration
  const progress = effectiveDuration > 0 ? time / effectiveDuration : 0

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
    const adjusted = time + subOffset
    const cue = vttCues.find((c) => adjusted >= c.start && adjusted <= c.end)
    setActiveCue(cue?.text ?? null)
  }, [time, vttCues, subOffset])

  // ── Sync subtitle offset to mpv's sub-delay property ───────────────────
  useEffect(() => {
    window.electronAPI.mpv.setSubDelay(subOffset).catch(() => {})
  }, [subOffset])

  // ── Up Next trigger — fire at creditsStartSec from /playback-context.
  //    Falls back to (duration - 120s) if the API didn't return one.
  useEffect(() => {
    if (!nextEpisode || !autoplayNext || upNextDismissedRef.current) return
    if (effectiveDuration <= 0) return
    const trigger = creditsStart != null ? creditsStart : effectiveDuration - 120
    const past = time >= trigger && time < effectiveDuration
    if (past && !upNextVisible) setUpNextVisible(true)
    else if (!past && upNextVisible) setUpNextVisible(false)
  }, [time, effectiveDuration, nextEpisode, autoplayNext, upNextVisible, creditsStart])

  // ── Auto-fetch episode list from TMDB ────────────────────────────────────
  // Refires when the current episode's season changes — otherwise the picker
  // would keep showing the previous season after a cross-season jump. Also
  // refires when there's no list yet for the current season (initial mount or
  // when PlayModal didn't pre-populate, e.g. resume from Home / Connect).
  useEffect(() => {
    if (!job || job.type !== 'tv' || !job.tmdbId) return
    const seasonNum = job.seasonNumber
    if (seasonNum == null) return
    // Skip if we already have a list whose first entry matches this season.
    if (episodeList.length > 0 && episodeList[0]?.seasonNumber === seasonNum) return
    let cancelled = false
    ;(async () => {
      try {
        const eps = await api.getTmdbEpisodes(job.tmdbId!, seasonNum)
        if (cancelled || eps.length === 0) return
        const epInfos: EpisodeInfo[] = eps.map((e) => ({
          jellyfinId: e.id, // use TMDB ep id as the identifier
          title: e.title,
          episodeNumber: e.episodeNumber,
          seasonNumber: e.seasonNumber,
          // Canonical comes from the TMDB response; only fall back to display
          // numbers when the backend didn't provide a remap (non-anime case).
          canonicalSeasonNumber: e.canonicalSeasonNumber ?? e.seasonNumber,
          canonicalEpisodeNumber: e.canonicalEpisodeNumber ?? e.episodeNumber,
          playedPercentage: undefined,
        }))
        setEpisodeListState(epInfos)
      } catch {}
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.tmdbId, job?.seasonNumber])

  // ── Auto-select preferred audio on open ─────────────────────────────────
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
    // Subtitles handled by OpenSubtitles auto-fetch/auto-select below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.itemId])

  // ── OpenSubtitles auto-populate query ───────────────────────────────────
  useEffect(() => {
    if (!job) return
    let q = job.seriesName || job.title
    if (job.type === 'tv') {
      const s = job.seasonNumber
      const e = job.episodeNumber
      if (s != null && e != null) {
        q += ` S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`
      }
    }
    setOsQuery(q)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.itemId])

  // ── OpenSubtitles auto-fetch ────────────────────────────────────────────
  const osFetchedRef = useRef(false)
  useEffect(() => {
    if (osFetchedRef.current) return
    if (!job) return
    osFetchedRef.current = true
    // Build query: include SxxExx for TV shows so OpenSubtitles matches the right episode
    let autoQuery = job.seriesName || job.title
    if (job.type === 'tv') {
      const s = job.seasonNumber
      const e = job.episodeNumber
      if (s != null && e != null) {
        autoQuery += ` S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`
      }
    }
    searchOsSubs(autoQuery)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.itemId])

  useEffect(() => { osFetchedRef.current = false }, [localEpId])

  // ── OpenSubtitles auto-select ───────────────────────────────────────────
  const osAutoSelectedRef = useRef(false)
  useEffect(() => {
    if (osAutoSelectedRef.current) return
    if (osResults.length === 0) return
    if (activeOsSubId !== null) return
    if (preferredSubtitleLang === 'off') return
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
      // Single combined call: Jellyfin heartbeat + progress store save
      const curEpInfo = episodeList.find(e => e.jellyfinId === localEpId)
      api.reportProgress({
        itemId: job.itemId,
        positionTicks: posTicks,
        durationTicks: durTicks,
        isPaused: paused,
        playSessionId: job.playSessionId ?? '',
        seriesId: job.seriesId,
        title: job.seriesName || job.title,
        posterUrl: job.posterUrl,
        type: job.seriesId ? 'tv' : job.type,
        tmdbId: job.tmdbId,
        seasonNumber: curEpInfo?.seasonNumber ?? job.seasonNumber,
        episodeNumber: curEpInfo?.episodeNumber ?? job.episodeNumber,
        episodeName: curEpInfo?.title ?? job.episodeName,
      }).catch(() => {})
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
    // Mark completion flag (actual completion handled server-side by /user-progress)
    markedPlayedRef.current = true
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
      const curEpInfo = episodeList.find(e => e.jellyfinId === localEpId)
      api.reportProgress({
        itemId: job.itemId,
        positionTicks: Math.floor(timeRef.current * 10_000_000),
        durationTicks: Math.floor(durationRef.current * 10_000_000),
        isPaused: true,
        playSessionId: job.playSessionId ?? '',
        isStopped: true,
        seriesId: job.seriesId,
        title: job.seriesName || job.title,
        posterUrl: job.posterUrl,
        type: job.seriesId ? 'tv' : job.type,
        tmdbId: job.tmdbId,
        seasonNumber: curEpInfo?.seasonNumber ?? job.seasonNumber,
        episodeNumber: curEpInfo?.episodeNumber ?? job.episodeNumber,
        episodeName: curEpInfo?.title ?? job.episodeName,
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
    saveAvPrefs(avPrefsKey, track.index, null)
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
        tmdbId: job!.tmdbId,
      })
      await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
      setCurrentJob({ ...currentJob!, job: newJob })
    } catch {
      setError('Failed to switch audio track')
      setBuffering(false)
    }
  }

  function disableSubtitles() {
    setVttCues([])
    setActiveCue(null)
    setActiveOsSubId(null)
    setSubOffset(0)
    if (isDirectPlay) window.electronAPI.mpv.setSid(0)
    setShowSubtitlePanel(false)
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
        tmdbId: job.tmdbId,
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
        tmdbId: job.tmdbId,
      })
      await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
      setCurrentJob({ ...currentJob!, job: newJob })
    } catch {
      setError('Failed to switch to transcoded stream')
      setBuffering(false)
    }
  }

  // Seek to an absolute time. For direct play we can seek the existing mpv
  // process. For HLS transcoded streams, seeking past what Jellyfin has
  // already transcoded stalls/kills mpv — so we restart the transcode at
  // the new start position, matching what switchQuality/switchAudio do.
  async function seekToAbsolute(secs: number) {
    if (!job) return
    const target = Math.max(0, secs)
    if (isDirectPlay) {
      window.electronAPI.mpv.seekAbsolute(target).catch(() => {})
      return
    }
    setBuffering(true)
    try {
      const newJob = await api.startPlayJob({
        itemId: job.itemId,
        audioStreamIndex: activeAudio,
        maxBitrate: QUALITY_PRESETS[activeQuality].maxBitrate || undefined,
        startTimeTicks: Math.floor(target * 10_000_000),
        previousPlaySessionId: job.playSessionId || undefined,
        previousDeviceId: job.deviceId,
        tmdbId: job.tmdbId,
      })
      setTime(target)
      timeRef.current = target
      await window.electronAPI.mpv.loadFile(newJob.hlsUrl)
      setCurrentJob({ ...currentJob!, job: newJob })
    } catch {
      setError('Seek failed')
      setBuffering(false)
    }
  }

  async function switchEpisode(ep: EpisodeInfo) {
    setUpNextVisible(false)
    upNextDismissedRef.current = false
    markedPlayedRef.current = false

    // Pause current playback while loading the next episode
    window.electronAPI.mpv.pause().catch(() => {})

    setShowEpisodePanel(false)
    setBuffering(true)
    setTime(0)
    setDuration(0)
    setLocalEpId(ep.jellyfinId)
    setVttCues([])
    setActiveCue(null)
    setSubOffset(0)
    setEnded(false)
    osFetchedRef.current = false
    osAutoSelectedRef.current = false
    setOsResults([])
    setActiveOsSubId(null)

    // Detect: real Jellyfin IDs are 32-char hex (with or without dashes). The
    // picker's auto-fetched TMDB list uses TMDB ids (short numeric strings) as
    // jellyfinId — calling startPlayJob with one 500s the backend.
    const idStripped = ep.jellyfinId.replace(/-/g, '')
    const isJellyfinId = idStripped.length === 32 && /^[0-9a-f]+$/i.test(idStripped)

    if (isJellyfinId) {
      // Fast path: episode is already in Jellyfin, restart the play-job
      try {
        const newJob = await api.startPlayJob({
          itemId: ep.jellyfinId,
          directPlay: directPlaySetting,
          previousPlaySessionId: job?.playSessionId || undefined,
          previousDeviceId: job?.deviceId,
          tmdbId: job?.tmdbId,
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
      return
    }

    // Slow path: TMDB-only id — kick the on-demand pipeline so RD stages the
    // file into Jellyfin first, then play the resolved item. Surface the phase
    // via stagingPhase/stagingMessage so the user sees what's happening.
    if (!job?.tmdbId) {
      setError('Cannot switch episode — missing TMDB ID')
      setBuffering(false)
      return
    }
    setStagingPhase('starting')
    setStagingMessage('Starting…')
    try {
      const { streamId } = await api.startStream({
        tmdbId: job.tmdbId,
        type: 'tv',
        title: job.seriesName || job.title,
        year: job.year ?? undefined,
        season: ep.seasonNumber,
        episode: ep.episodeNumber,
        canonicalSeason: ep.canonicalSeasonNumber,
        canonicalEpisode: ep.canonicalEpisodeNumber,
        isAnime: job.isAnime,
      })
      console.log(
        `[OnDemand] switchEpisode display=S${ep.seasonNumber}E${ep.episodeNumber}` +
        ` canonical=S${ep.canonicalSeasonNumber ?? 'undefined'}E${ep.canonicalEpisodeNumber ?? 'undefined'}`
      )

      // Poll until ready / error / timeout (~5 min cap)
      const status = await pollStreamReady(streamId, (phase, msg) => {
        setStagingPhase(phase)
        setStagingMessage(msg)
      })

      const newJob: PlayJob = {
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
        title: status.title || ep.title,
        seriesName: status.seriesName || job.seriesName,
        type: status.type || 'tv',
        durationTicks: status.durationTicks,
        introStartSec: status.introStartSec,
        introEndSec: status.introEndSec,
        creditsStartSec: status.creditsStartSec,
        mpvOptions: status.mpvOptions,
        tmdbId: job.tmdbId,
        year: job.year,
        posterUrl: job.posterUrl,
        seriesId: job.seriesId,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        episodeName: ep.title,
        isAnime: job.isAnime,
      }
      await window.electronAPI.mpv.loadFile(newJob.directStreamUrl ?? newJob.hlsUrl)
      const resolvedId = newJob.itemId || ep.jellyfinId
      setCurrentJob({
        ...currentJob!,
        job: newJob,
        title: ep.title,
        currentEpisodeId: resolvedId,
      })
      setLocalEpId(resolvedId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Failed to load episode: ${msg}`)
      setBuffering(false)
    } finally {
      setStagingPhase('')
      setStagingMessage('')
    }
  }

  /** Poll /stream/play/:streamId until phase === 'ready' or 'error'. */
  async function pollStreamReady(
    streamId: string,
    onPhase: (phase: string, msg: string) => void,
    maxAttempts = 200,
  ): Promise<api.StreamStatus> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      const status = await api.getStreamStatus(streamId)
      onPhase(status.phase || '', status.message || '')
      if (status.phase === 'error') {
        throw new Error(status.error || status.message || 'Stream resolution failed')
      }
      if (status.phase === 'ready') return status
    }
    throw new Error('Stream resolution timed out')
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
      const season = curEp?.seasonNumber ?? job?.seasonNumber
      const episode = curEp?.episodeNumber ?? job?.episodeNumber
      const results = await api.searchSubtitles({
        query: query || osQuery.trim() || undefined,
        tmdbId: job?.tmdbId ?? undefined,
        type: job?.type === 'tv' ? 'tv' : 'movie',
        season: season ?? undefined,
        episode: episode ?? undefined,
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
    setSubOffset(0)
    setOsError('')
    // Disable mpv's native subs so only our VTT overlay renders
    if (isDirectPlay) window.electronAPI.mpv.setSid(0)
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
  const [gpZone, setGpZone] = useState<'none' | 'seek' | 'controls' | 'panel' | 'volume' | 'upnext' | 'skip'>('none')
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

    // Skip action zone — skip intro/credits button visible
    if (gpZone === 'skip') {
      if (dir === 'down') {
        setGpZone('controls')
        gpSetFocus(null)
        const btns = gpGetControlButtons()
        if (btns.length > 0) { setGpControlIdx(0); gpSetFocus(btns[0]) }
      }
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

    // Error overlay takes priority — focus the dismiss button
    if (error) {
      const dismissBtn = containerRef.current?.querySelector<HTMLElement>('[data-focusable]')
      if (dismissBtn) gpSetFocus(dismissBtn)
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
        // If skip intro/credits is visible, focus that first; otherwise seek bar
        const skipBtn = containerRef.current?.querySelector<HTMLElement>('[data-skip-action]')
        if (skipBtn && skipBtn.offsetParent !== null) {
          setGpZone('skip')
          gpSetFocus(skipBtn)
        } else {
          setGpZone('seek')
          gpSetFocus(null)
        }
      } else if (dir === 'down') {
        setGpZone('none')
        gpSetFocus(null)
        setControlsVisible(false)
      }
    }
  }, [gpZone, panelOpen, showVolumePopup, volume, gpControlIdx, upNextVisible, nextEpisode,
      error, gpGetControlButtons, gpGetPanelItems, gpSetFocus, gpPanelMove])

  const gpActivate = useCallback(() => {
    // Always allow clicking a focused element (error dismiss, skip, etc.)
    if (gpFocusRef.current && (gpZone === 'skip' || gpZone === 'upnext' || gpZone === 'panel' || gpZone === 'controls')) {
      gpFocusRef.current.click(); return
    }
    if (gpZone === 'volume' && showVolumePopup) { setShowVolumePopup(false); setGpZone('controls'); return }
    // Error overlay — click dismiss if focused
    if (error && gpFocusRef.current) { gpFocusRef.current.click(); return }
    window.electronAPI.mpv.togglePause()
  }, [gpZone, showVolumePopup, error])

  const gpBack = useCallback(() => {
    gpSetFocus(null)
    if (gpZone === 'skip') { setGpZone('controls'); return }
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
      {/* Opaque black backdrop while mpv loads — prevents see-through transparency */}
      {buffering && !error && !stagingPhase && (
        <div className="absolute inset-0 bg-black flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center">
            <Loader2 size={36} className="text-white/80 animate-spin" />
          </div>
        </div>
      )}

      {/* Episode staging overlay — shown when switching to a TMDB-only episode
          that has to go through the on-demand RD pipeline before mpv can play it. */}
      {stagingPhase && !error && (
        <div className="absolute inset-0 bg-black flex items-center justify-center">
          <div className="bg-[#181818] rounded-xl border border-white/10 shadow-2xl px-6 py-5 w-80 max-w-[90vw]">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 size={18} className="text-red-500 animate-spin flex-shrink-0" />
              <p className="text-sm text-white/90 font-medium">Loading episode</p>
            </div>
            <p className="text-xs text-white/60 leading-relaxed">
              {STAGING_PHASE_LABELS[stagingPhase] || stagingMessage || 'Preparing…'}
            </p>
            <p className="text-[10px] text-white/30 mt-3">
              Real-Debrid is staging the file. This usually takes a few seconds.
            </p>
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
              data-focusable
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
              {Math.max(0, Math.ceil(effectiveDuration - time))}s
            </span>
          </div>
        </motion.div>
      )}

      {/* Close button (B button on gamepad) */}
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

      {/* Skip Intro button */}
      {introStart != null && introEnd != null &&
        time >= introStart && time < introEnd && (
        <button
          data-focusable data-skip-action
          onMouseEnter={() => setInteractive(true)}
          onMouseLeave={() => setInteractive(false)}
          onClick={() => {
            if (introEnd != null) {
              window.electronAPI.mpv.seekAbsolute(introEnd)
            }
          }}
          className="absolute bottom-24 right-6 z-20 px-5 py-2.5 rounded-lg
                     bg-white/15 backdrop-blur-sm border border-white/30
                     text-white text-sm font-medium hover:bg-white/25 transition-colors"
        >
          Skip Intro
        </button>
      )}
      {/* Skip Credits — only show when Up Next overlay is NOT visible (avoid duplicate prompts) */}
      {!upNextVisible && creditsStart != null && time >= creditsStart && (
        <button
          data-focusable data-skip-action
          onMouseEnter={() => setInteractive(true)}
          onMouseLeave={() => setInteractive(false)}
          onClick={() => {
            if (nextEpisode) {
              switchEpisode(nextEpisode)
            } else {
              window.electronAPI.mpv.quit()
            }
          }}
          className="absolute bottom-24 right-6 z-20 px-5 py-2.5 rounded-lg
                     bg-white/15 backdrop-blur-sm border border-white/30
                     text-white text-sm font-medium hover:bg-white/25 transition-colors"
        >
          {nextEpisode ? 'Next Episode' : 'Skip Credits'}
        </button>
      )}

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
            seekToAbsolute(frac * effectiveDuration)
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

          {/* Skip ±10s */}
          <button data-gp-control data-focusable onClick={() => window.electronAPI.mpv.seek(-10)}
            className="relative text-white/70 hover:text-white transition" title="Back 10s">
            <SkipBack size={20} />
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold leading-none pointer-events-none">10</span>
          </button>
          <button data-gp-control data-focusable onClick={() => window.electronAPI.mpv.seek(10)}
            className="relative text-white/70 hover:text-white transition" title="Forward 10s">
            <SkipForward size={20} />
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold leading-none pointer-events-none">10</span>
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
            {fmt(time)} / {fmt(effectiveDuration)}
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

          {/* Fullscreen */}
          <button
            data-gp-control data-focusable
            onClick={() => {
              window.electronAPI.mpv.fullscreen()
              setIsFullscreen((v) => !v)
            }}
            className="text-white/70 hover:text-white transition"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </motion.div>

      {/* ── Subtitle panel — OpenSubtitles only ──────────────────────────── */}
      {showSubtitlePanel && job && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-24 right-4 w-80 bg-[#141414]/95 backdrop-blur-xl border border-white/10
                     rounded-2xl shadow-2xl overflow-hidden z-30"
          onMouseEnter={() => setInteractive(true)}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Subtitles</p>
            <div className="flex items-center gap-2">
              {osSearching && <Loader2 size={14} className="text-white/40 animate-spin" />}
              <button data-focusable onClick={() => setShowSubtitlePanel(false)}
                className="text-white/30 hover:text-white transition"><X size={14} /></button>
            </div>
          </div>

          {/* Search bar — always visible */}
          <div className="px-3 pt-3 pb-2 space-y-1.5">
            <div className="flex gap-1.5">
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
            {osError && !osSearching && <p className="px-2 text-xs text-red-400">{osError}</p>}
          </div>

          {/* Results list + off button */}
          <div className="max-h-[22rem] overflow-y-auto">
            {/* Off */}
            <button
              data-focusable
              onClick={disableSubtitles}
              className={`w-full text-left px-4 py-2.5 text-sm transition ${
                activeOsSubId === null
                  ? 'bg-red-600/15 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              Off
            </button>

            {/* Subtitle results sorted by downloads */}
            {osResults.map((sub) => (
              <button
                key={sub.id} data-focusable
                onClick={() => applyOsSub(sub)}
                className={`w-full text-left px-4 py-2 transition ${
                  activeOsSubId === sub.id ? 'bg-red-600/15 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">{sub.name || 'Unnamed'}</span>
                  <div className="flex-shrink-0 flex items-center gap-1">
                    <span className="text-[9px] bg-white/8 text-white/30 px-1.5 py-0.5 rounded uppercase">{sub.language}</span>
                    {sub.hearingImpaired && <span className="text-[9px] bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded">HI</span>}
                    <span className="text-[9px] bg-white/8 text-white/30 px-1.5 py-0.5 rounded tabular-nums">
                      {sub.downloadCount > 0 ? `${(sub.downloadCount / 1000).toFixed(0)}k` : '—'}
                    </span>
                  </div>
                </div>
              </button>
            ))}

            {osResults.length === 0 && !osSearching && (
              <p className="px-4 py-3 text-xs text-white/30">No subtitles found — try searching above</p>
            )}
          </div>

          {/* Subtitle timing offset — always visible in subtitle panel */}
          <div className="px-4 py-2.5 border-t border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">Offset</span>
              <div className="flex items-center gap-1">
                <button data-focusable onClick={() => setSubOffset((v) => Math.round((v - 0.5) * 100) / 100)}
                  className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15 text-white/60 hover:text-white text-[10px] transition">-500</button>
                <button data-focusable onClick={() => setSubOffset((v) => Math.round((v - 0.05) * 100) / 100)}
                  className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15 text-white/60 hover:text-white text-[10px] transition">-50</button>
                {editingOffset ? (
                  <input
                    autoFocus
                    value={editingOffsetValue}
                    onChange={(e) => setEditingOffsetValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const parsed = parseFloat(editingOffsetValue)
                        if (!isNaN(parsed)) setSubOffset(Math.round(parsed / 1000 * 100) / 100)
                        setEditingOffset(false)
                      } else if (e.key === 'Escape') {
                        setEditingOffset(false)
                      }
                    }}
                    onBlur={() => {
                      const parsed = parseFloat(editingOffsetValue)
                      if (!isNaN(parsed)) setSubOffset(Math.round(parsed / 1000 * 100) / 100)
                      setEditingOffset(false)
                    }}
                    className="w-16 text-center text-xs font-mono bg-white/10 border border-white/20 rounded px-1 py-0.5 text-white outline-none"
                  />
                ) : (
                  <button
                    data-focusable
                    onClick={() => { setEditingOffset(true); setEditingOffsetValue(String(Math.round(subOffset * 1000))) }}
                    className="w-16 text-center text-xs text-white/70 tabular-nums font-mono py-0.5 rounded hover:bg-white/10 transition cursor-text"
                    title="Click to type a value in ms"
                  >
                    {subOffset >= 0 ? '+' : ''}{Math.round(subOffset * 1000)}ms
                  </button>
                )}
                <button data-focusable onClick={() => setSubOffset((v) => Math.round((v + 0.05) * 100) / 100)}
                  className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15 text-white/60 hover:text-white text-[10px] transition">+50</button>
                <button data-focusable onClick={() => setSubOffset((v) => Math.round((v + 0.5) * 100) / 100)}
                  className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15 text-white/60 hover:text-white text-[10px] transition">+500</button>
              </div>
            </div>
            {subOffset !== 0 && (
              <button data-focusable onClick={() => setSubOffset(0)}
                className="mt-1.5 w-full text-center text-[10px] text-white/30 hover:text-white/60 transition">
                Reset to 0ms
              </button>
            )}
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
            <button data-focusable onClick={() => setShowEpisodePanel(false)}
              className="text-white/30 hover:text-white transition"><X size={14} /></button>
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
          <div className="flex items-center border-b border-white/10">
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
            <button data-focusable onClick={() => setShowSettings(false)}
              className="px-2.5 py-2.5 text-white/30 hover:text-white transition"><X size={13} /></button>
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
