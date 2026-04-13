import type { PlatformAdapter } from './types'
import type { AccountEntry } from '@/types/electron'
const LS_TOKEN = 'valor_token'
const auth = {
  getToken: async () => localStorage.getItem(LS_TOKEN),
  setToken: async (t: string) => localStorage.setItem(LS_TOKEN, t),
  clearToken: async () => localStorage.removeItem(LS_TOKEN),
  getAccounts: async (): Promise<AccountEntry[]> => { try { return JSON.parse(localStorage.getItem('valor_accounts') || '[]') } catch { return [] } },
  addAccount: async (a: AccountEntry) => { const l: AccountEntry[] = JSON.parse(localStorage.getItem('valor_accounts') || '[]'); l.push(a); localStorage.setItem('valor_accounts', JSON.stringify(l)); localStorage.setItem(LS_TOKEN, a.token) },
  removeAccount: async (id: string) => { let l: AccountEntry[] = JSON.parse(localStorage.getItem('valor_accounts') || '[]'); l = l.filter(a => a.id !== id); localStorage.setItem('valor_accounts', JSON.stringify(l)) },
  switchAccount: async (id: string) => { const l: AccountEntry[] = JSON.parse(localStorage.getItem('valor_accounts') || '[]'); const a = l.find(x => x.id === id); if (a) localStorage.setItem(LS_TOKEN, a.token) },
}
const noop = async () => {}
export const tizenPlatform: PlatformAdapter = {
  name: 'tizen', supportsMpv: false, supportsDiscord: false, hasWindowControls: false, tvLayout: true, auth,
  updates: { check: noop, download: noop, install: noop, onAvailable: () => {}, onProgress: () => {}, onDownloaded: () => {}, onError: () => {} },
  discord: { setActivity: noop, clearActivity: noop },
  window: { minimize: noop, maximize: noop, close: noop, isMaximized: async () => false, onMaximizedChange: () => {} },
  system: { sleep: noop },
}
