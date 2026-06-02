import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from '@/lib/themes'

type ThemeContextValue = {
  themeId: string
  setThemeId: (id: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Resolves the boot-time theme — prefers a saved choice in localStorage,
 * else falls back to whatever's already on <html data-theme="…"> (set by
 * index.html), else DEFAULT_THEME_ID. Exposes a setter that flips the
 * attribute + persists. No account sync yet — that lands once the
 * backend grows a themePreference field.
 *
 * The CSP forbids inline scripts so we can't run a pre-React boot script
 * here. That means on second launch there's a brief paint of the default
 * theme before this state syncs the DOM. Inside Electron's ~500ms cold
 * start the flash is invisible in practice.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(() => {
    if (typeof document === 'undefined') return DEFAULT_THEME_ID
    let saved: string | null = null
    try { saved = window.localStorage.getItem(THEME_STORAGE_KEY) } catch { /* localStorage blocked */ }
    if (saved && THEME_IDS.includes(saved)) return saved
    const applied = document.documentElement.getAttribute('data-theme')
    return applied && THEME_IDS.includes(applied) ? applied : DEFAULT_THEME_ID
  })

  // Sync the DOM whenever themeId changes (covers boot-time mismatch with
  // <html data-theme="…"> set in index.html and any setThemeId calls).
  useEffect(() => {
    if (document.documentElement.getAttribute('data-theme') !== themeId) {
      document.documentElement.setAttribute('data-theme', themeId)
    }
  }, [themeId])

  const setThemeId = useCallback((id: string) => {
    if (!THEME_IDS.includes(id)) return
    setThemeIdState(id)
    document.documentElement.setAttribute('data-theme', id)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, id)
    } catch {
      // localStorage can be blocked — the in-memory choice still applies
      // for the rest of the session.
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ themeId, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Allow components to render without a provider — they'll just see
    // the default theme and a no-op setter.
    return { themeId: DEFAULT_THEME_ID, setThemeId: () => {} }
  }
  return ctx
}
