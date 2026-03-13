import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  overlay: {
    setIgnoreMouse: (ignore: boolean): Promise<void> => ipcRenderer.invoke('overlay:set-ignore-mouse', ignore),
  },
  auth: {
    getToken: (): Promise<string | null> => ipcRenderer.invoke('auth:getToken'),
    setToken: (token: string): Promise<void> => ipcRenderer.invoke('auth:setToken', token),
    clearToken: (): Promise<void> => ipcRenderer.invoke('auth:clearToken'),
    getAccounts: (): Promise<{ id: string; username: string; token: string; avatarUrl: string | null }[]> =>
      ipcRenderer.invoke('auth:getAccounts'),
    addAccount: (account: { id: string; username: string; token: string; avatarUrl: string | null }): Promise<void> =>
      ipcRenderer.invoke('auth:addAccount', account),
    removeAccount: (id: string): Promise<void> => ipcRenderer.invoke('auth:removeAccount', id),
    switchAccount: (id: string): Promise<void> => ipcRenderer.invoke('auth:switchAccount', id),
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('win:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
    onMaximizedChange: (cb: (maximized: boolean) => void): void => {
      ipcRenderer.on('win:maximized', (_e, value: boolean) => cb(value))
    }
  },
  updates: {
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    onAvailable: (cb: (info: { version: string; releaseNotes: string | null }) => void): void => {
      ipcRenderer.on('update:available', (_e, info) => cb(info))
    },
    onProgress: (cb: (progress: { percent: number; bytesPerSecond: number }) => void): void => {
      ipcRenderer.on('update:progress', (_e, progress) => cb(progress))
    },
    onDownloaded: (cb: (info: { version: string }) => void): void => {
      ipcRenderer.on('update:downloaded', (_e, info) => cb(info))
    },
    onError: (cb: (message: string) => void): void => {
      ipcRenderer.on('update:error', (_e, message) => cb(message))
    }
  },
  system: {
    sleep: (): Promise<void> => ipcRenderer.invoke('system:sleep'),
  },
  discord: {
    setActivity: (activity: object): Promise<void> => ipcRenderer.invoke('discord:setActivity', activity),
    clearActivity: (): Promise<void> => ipcRenderer.invoke('discord:clearActivity'),
  },
  mpv: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('mpv:available'),
    getPayload: (): Promise<unknown> => ipcRenderer.invoke('mpv:get-payload'),
    launch: (payload: unknown): Promise<void> => ipcRenderer.invoke('mpv:launch', payload),
    togglePause: (): Promise<void> => ipcRenderer.invoke('mpv:toggle-pause'),
    pause: (): Promise<void> => ipcRenderer.invoke('mpv:pause'),
    resume: (): Promise<void> => ipcRenderer.invoke('mpv:resume'),
    seek: (secs: number): Promise<void> => ipcRenderer.invoke('mpv:seek', secs),
    seekAbsolute: (secs: number): Promise<void> => ipcRenderer.invoke('mpv:seek-absolute', secs),
    setVolume: (vol: number): Promise<void> => ipcRenderer.invoke('mpv:volume', vol),
    loadFile: (url: string): Promise<void> => ipcRenderer.invoke('mpv:load-file', url),
    setAid: (aid: number): Promise<void> => ipcRenderer.invoke('mpv:set-aid', aid),
    setSid: (sid: number): Promise<void> => ipcRenderer.invoke('mpv:set-sid', sid),
    setSpeed: (speed: number): Promise<void> => ipcRenderer.invoke('mpv:set-speed', speed),
    subAdd: (path: string): Promise<void> => ipcRenderer.invoke('mpv:sub-add', path),
    quit: (): Promise<void> => ipcRenderer.invoke('mpv:quit'),
    fullscreen: (): Promise<void> => ipcRenderer.invoke('mpv:fullscreen'),
    // Events pushed from main process → renderer.
    // Each `on*` replaces previous listeners for that channel to prevent leaks.
    onReady: (cb: () => void): void => {
      ipcRenderer.removeAllListeners('mpv:ready')
      ipcRenderer.on('mpv:ready', () => cb())
    },
    onTime: (cb: (time: number) => void): void => {
      ipcRenderer.removeAllListeners('mpv:time')
      ipcRenderer.on('mpv:time', (_e, time) => cb(time))
    },
    onDuration: (cb: (duration: number) => void): void => {
      ipcRenderer.removeAllListeners('mpv:duration')
      ipcRenderer.on('mpv:duration', (_e, duration) => cb(duration))
    },
    onPaused: (cb: (paused: boolean) => void): void => {
      ipcRenderer.removeAllListeners('mpv:paused')
      ipcRenderer.on('mpv:paused', (_e, paused) => cb(paused))
    },
    onEnded: (cb: () => void): void => {
      ipcRenderer.removeAllListeners('mpv:ended')
      ipcRenderer.on('mpv:ended', () => cb())
    },
    onError: (cb: (err: string) => void): void => {
      ipcRenderer.removeAllListeners('mpv:error')
      ipcRenderer.on('mpv:error', (_e, err) => cb(err))
    },
    /** Remove all mpv event listeners (call on cleanup) */
    removeAllListeners: (): void => {
      for (const ch of ['mpv:ready', 'mpv:time', 'mpv:duration', 'mpv:paused', 'mpv:ended', 'mpv:error']) {
        ipcRenderer.removeAllListeners(ch)
      }
    },
  }
})
