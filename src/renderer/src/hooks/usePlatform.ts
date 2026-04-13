function checkTvMode(): boolean {
  try { const raw = localStorage.getItem('valor_settings'); if (raw) return JSON.parse(raw).uiMode === 'tv' } catch {}
  return false
}
export let isTv = checkTvMode()
export function refreshTvMode(): void { isTv = checkTvMode() }
export const isElectron = typeof window !== 'undefined' && !!(window as unknown as { electronAPI: unknown }).electronAPI
export const isTizen = false
