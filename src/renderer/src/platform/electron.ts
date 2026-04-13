import type { PlatformAdapter } from './types'
const api = () => (window as any).electronAPI
export const electronPlatform: PlatformAdapter = {
  name: 'electron', supportsMpv: true, supportsDiscord: true, hasWindowControls: true, tvLayout: false,
  auth: { getToken: () => api().auth.getToken(), setToken: (t: string) => api().auth.setToken(t), clearToken: () => api().auth.clearToken(), getAccounts: () => api().auth.getAccounts(), addAccount: (a: any) => api().auth.addAccount(a), removeAccount: (id: string) => api().auth.removeAccount(id), switchAccount: (id: string) => api().auth.switchAccount(id) },
  updates: { check: () => api().updates.check(), download: () => api().updates.download(), install: () => api().updates.install(), onAvailable: (cb: any) => api().updates.onAvailable(cb), onProgress: (cb: any) => api().updates.onProgress(cb), onDownloaded: (cb: any) => api().updates.onDownloaded(cb), onError: (cb: any) => api().updates.onError(cb) },
  discord: { setActivity: (a: any) => api().discord.setActivity(a), clearActivity: () => api().discord.clearActivity() },
  window: { minimize: () => api().window.minimize(), maximize: () => api().window.maximize(), close: () => api().window.close(), isMaximized: () => api().window.isMaximized(), onMaximizedChange: (cb: any) => api().window.onMaximizedChange(cb) },
  system: { sleep: () => api().system.sleep() },
}
