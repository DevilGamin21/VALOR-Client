import { useEffect, useRef, useState } from 'react'
import { Palette, Check, X } from 'lucide-react'
import { THEMES } from '@/lib/themes'
import { useTheme } from '@/contexts/ThemeContext'

type Corner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

const CORNER_CLASSES: Record<Corner, string> = {
  'top-right':    'top-4 right-4',
  'top-left':     'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left':  'bottom-4 left-4',
}

/**
 * Floating theme picker — small icon button that opens a compact popover
 * with the theme grid. Used on Login (no sidebar) and within RootShell so
 * users can swap themes without digging into Settings.
 */
export default function ThemeSwitcherFAB({ corner = 'bottom-right' }: { corner?: Corner }) {
  const { themeId, setThemeId } = useTheme()
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const positionClass    = CORNER_CLASSES[corner]
  const panelVertical    = corner.startsWith('top')   ? 'top-12'    : 'bottom-12'
  const panelHorizontal  = corner.endsWith('right')   ? 'right-0'   : 'left-0'

  return (
    <div className={`fixed z-[60] ${positionClass}`}>
      <button
        data-focusable
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        aria-expanded={open}
        title="Theme"
        className="w-10 h-10 rounded-full bg-surface/80 backdrop-blur-md border border-line text-secondary hover:text-primary hover:bg-elevated hover:border-lineStrong shadow-md transition-colors flex items-center justify-center"
      >
        <Palette className="w-4 h-4" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={`absolute ${panelVertical} ${panelHorizontal} w-[280px] max-w-[88vw] max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-elevated/95 backdrop-blur-md shadow-2xl p-3`}
          role="dialog"
          aria-label="Theme picker"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Theme
            </p>
            <button
              data-focusable
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-md text-muted hover:text-primary hover:bg-surface transition-colors"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {THEMES.map((t) => {
              const active = themeId === t.id
              return (
                <button
                  data-focusable
                  key={t.id}
                  type="button"
                  onClick={() => setThemeId(t.id)}
                  aria-pressed={active}
                  className={`text-left rounded-xl p-2.5 border transition-all ${
                    active
                      ? 'border-accent ring-1 ring-accent/40 bg-surface'
                      : 'border-line bg-surface/60 hover:bg-surface hover:border-lineStrong'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {t.swatches.map((c, i) => (
                      <span
                        key={i}
                        className="w-4 h-4 rounded-full border border-black/30"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    {active && (
                      <span className="ml-auto inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent text-accent-fg">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-primary">{t.label}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
