import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  auth: {
    getToken: (): Promise<string | null> => ipcRenderer.invoke('auth:getToken'),
    setToken: (token: string): Promise<void> => ipcRenderer.invoke('auth:setToken', token),
    clearToken: (): Promise<void> => ipcRenderer.invoke('auth:clearToken')
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
    quit: (): Promise<void> => ipcRenderer.invoke('mpv:quit'),
    // Events pushed from main process → overlay renderer
    onJob: (cb: (payload: unknown) => void): void => {
      ipcRenderer.on('mpv:job', (_e, payload) => cb(payload))
    },
    onReady: (cb: () => void): void => {
      ipcRenderer.on('mpv:ready', () => cb())
    },
    onTime: (cb: (time: number) => void): void => {
      ipcRenderer.on('mpv:time', (_e, time) => cb(time))
    },
    onDuration: (cb: (duration: number) => void): void => {
      ipcRenderer.on('mpv:duration', (_e, duration) => cb(duration))
    },
    onPaused: (cb: (paused: boolean) => void): void => {
      ipcRenderer.on('mpv:paused', (_e, paused) => cb(paused))
    },
    onEnded: (cb: () => void): void => {
      ipcRenderer.on('mpv:ended', () => cb())
    },
    onError: (cb: (err: string) => void): void => {
      ipcRenderer.on('mpv:error', (_e, err) => cb(err))
    },
  }
})
