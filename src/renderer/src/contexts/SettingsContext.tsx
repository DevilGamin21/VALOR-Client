import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'

export type QualityPreset = 'original' | '1440p' | '1080p' | '720p' | '480p'
export type SubtitleSize = 'small' | 'medium' | 'large' | 'xl'

export interface AppSettings {
  /** Default quality when starting playback. Lower = faster transcode start. */
  defaultQuality: QualityPreset
  /** Skip FFmpeg entirely — play the original file via native <video> element.
   *  Fastest possible start. Works for H.264/AAC files; may fail for exotic codecs. */
  directPlay: boolean
  /** Automatically play the next episode when the current one ends. */
  autoplayNext: boolean
  /** ISO 639-1 language code to auto-select for audio, or 'auto' for default. */
  preferredAudioLang: string
  /** ISO 639-1 language code to auto-select for subtitles, or 'off' to disable. */
  preferredSubtitleLang: string
  /** Whether the first hardware capability scan has been completed. */
  hasRunHardwareScan: boolean
  /** Raw hardware detection result — null until first scan. Independent of the user's directPlay toggle. */
  detectedDirectPlay: boolean | null
  /** Subtitle text size. */
  subtitleSize: SubtitleSize
  /** Subtitle background opacity (0–1). */
  subtitleBgOpacity: number
  /** Whether Discord Rich Presence is enabled. */
  discordRPC: boolean
}

const DEFAULTS: AppSettings = {
  defaultQuality: 'original',
  directPlay: false,
  autoplayNext: true,
  preferredAudioLang: 'auto',
  preferredSubtitleLang: 'off',
  hasRunHardwareScan: false,
  detectedDirectPlay: null,
  subtitleSize: 'medium',
  subtitleBgOpacity: 0.75,
  discordRPC: true,
}

/** Test whether the local GPU can hardware-decode H.264 1080p smoothly.
 *  Returns true if direct play should be enabled by default. */
export async function detectDirectPlaySupport(): Promise<boolean> {
  try {
    const result = await navigator.mediaCapabilities.decodingInfo({
      type: 'file',
      video: {
        contentType: 'video/mp4; codecs="avc1.42E01E"',
        width: 1920,
        height: 1080,
        bitrate: 10_000_000,
        framerate: 30,
      },
      audio: {
        contentType: 'audio/mp4; codecs="mp4a.40.2"',
        channels: '2',
        bitrate: 192_000,
        samplerate: 48000,
      },
    })
    // smooth = can decode at playback speed; powerEfficient = GPU hardware path
    return result.supported && result.smooth
  } catch {
    // Fallback: basic canPlayType check
    const v = document.createElement('video')
    return v.canPlayType('video/mp4; codecs="avc1.42E01E"') === 'probably'
  }
}

const STORAGE_KEY = 'valor_settings'

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

function persist(s: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

interface SettingsState extends AppSettings {
  update: (patch: Partial<AppSettings>) => void
  reset: () => void
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(load)

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      persist(next)
      return next
    })
  }, [])

  // Reset user preferences to defaults, but preserve hardware detection results
  // so the scan doesn't fire again and override the user's fresh start
  const reset = useCallback(() => {
    setSettings((prev) => {
      const next: AppSettings = {
        ...DEFAULTS,
        hasRunHardwareScan: prev.hasRunHardwareScan,
        detectedDirectPlay: prev.detectedDirectPlay,
        // Use hardware-detected value as the directPlay default, or false if not scanned
        directPlay: prev.detectedDirectPlay ?? DEFAULTS.directPlay,
      }
      persist(next)
      return next
    })
  }, [])

  // Run hardware scan on first launch (or when re-detect is requested by setting hasRunHardwareScan: false)
  useEffect(() => {
    if (settings.hasRunHardwareScan) return
    detectDirectPlaySupport().then((supported) => {
      update({ directPlay: supported, detectedDirectPlay: supported, hasRunHardwareScan: true })
    })
  }, [settings.hasRunHardwareScan, update])

  return (
    <SettingsContext.Provider value={{ ...settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

/** Map a QualityPreset label to the maxBitrate value sent to the backend. */
export const QUALITY_BITRATES: Record<QualityPreset, number | undefined> = {
  original: undefined,       // no bitrate cap → Jellyfin stream-copies if possible
  '1440p':  20_000_000,
  '1080p':  10_000_000,
  '720p':    4_000_000,
  '480p':    2_000_000,
}
