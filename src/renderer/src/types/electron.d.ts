import type { AudioTrack, SubtitleTrack, EpisodeInfo, PlayJob } from './media'

export interface DiscordActivity {
  details?: string
  state?: string
  startTimestamp?: number
  endTimestamp?: number
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
  instance?: boolean
  buttons?: Array<{ label: string; url: string }>
}

export interface UpdateInfo {
  version: string
  releaseNotes: string | null
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
}

export interface MpvLaunchPayload {
  hlsUrl: string
  title: string
  itemId: string
  playSessionId: string
  startPositionTicks: number
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
  episodeList: EpisodeInfo[]
  currentEpisodeId: string
  /** The full PlayJob — used by overlay for track switching via api.startPlayJob */
  job: PlayJob
}

declare const __APP_VERSION__: string

export interface AccountEntry {
  id: string
  username: string
  token: string
  avatarUrl: string | null
}

declare global {
  interface Window {
    electronAPI: {
      overlay: {
        setIgnoreMouse: (ignore: boolean) => Promise<void>
      }
      auth: {
        getToken: () => Promise<string | null>
        setToken: (token: string) => Promise<void>
        clearToken: () => Promise<void>
        getAccounts: () => Promise<AccountEntry[]>
        addAccount: (account: AccountEntry) => Promise<void>
        removeAccount: (id: string) => Promise<void>
        switchAccount: (id: string) => Promise<void>
      }
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizedChange: (cb: (maximized: boolean) => void) => void
        setFullScreen: (full: boolean) => Promise<void>
      }
      updates: {
        download: () => Promise<void>
        install: () => Promise<void>
        check: () => Promise<void>
        onAvailable: (cb: (info: UpdateInfo) => void) => void
        onProgress: (cb: (progress: UpdateProgress) => void) => void
        onDownloaded: (cb: (info: { version: string }) => void) => void
        onError: (cb: (message: string) => void) => void
      }
      system: {
        sleep: () => Promise<void>
        hostname: () => Promise<string>
        platform: () => Promise<string>
      }
      discord: {
        setActivity: (activity: DiscordActivity) => Promise<void>
        clearActivity: () => Promise<void>
      }
      mpv: {
        isAvailable: () => Promise<boolean>
        getPayload: () => Promise<MpvLaunchPayload | null>
        launch: (payload: MpvLaunchPayload) => Promise<void>
        togglePause: () => Promise<void>
        pause: () => Promise<void>
        resume: () => Promise<void>
        seek: (secs: number) => Promise<void>
        seekAbsolute: (secs: number) => Promise<void>
        setVolume: (vol: number) => Promise<void>
        loadFile: (url: string) => Promise<void>
        setAid: (aid: number) => Promise<void>
        setSid: (sid: number) => Promise<void>
        setSpeed: (speed: number) => Promise<void>
        setSubDelay: (secs: number) => Promise<void>
        subAdd: (path: string) => Promise<void>
        quit: () => Promise<void>
        fullscreen: () => Promise<void>
        onReady: (cb: () => void) => void
        onTime: (cb: (time: number) => void) => void
        onDuration: (cb: (duration: number) => void) => void
        onPaused: (cb: (paused: boolean) => void) => void
        onEnded: (cb: () => void) => void
        onError: (cb: (err: string) => void) => void
        removeAllListeners: () => void
      }
    }
  }
}

export {}
