import type { PlatformAdapter } from './types'
import { electronPlatform } from './electron'
import { tizenPlatform } from './tizen'
function detect(): PlatformAdapter {
  if (typeof window !== 'undefined' && (window as any).tizen) return tizenPlatform
  if (typeof window !== 'undefined' && (window as any).electronAPI) return electronPlatform
  return { ...tizenPlatform, name: 'web', tvLayout: false }
}
export const platform: PlatformAdapter = detect()
export type { PlatformAdapter } from './types'
