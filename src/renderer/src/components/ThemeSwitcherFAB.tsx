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
        className="w-11 h-11 rounded-full bg-elevated border border-white/20 text-white/80 hover:text-white hover:border-white/40 shadow-lg transition-colors flex items-center justify-center"
      >
        <Palette className="w-5 h-5" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={`absolute ${panelVertical} ${panelHorizontal} w-[280px] max-w-[88vw] max-h-[70vh] overflow-y-auto rounded-2xl border border-white/15 bg-elevated shadow-2xl p-3`}
          role="dialog"
          aria-label="Theme picker"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
              Theme
            </p>
            <button
              data-focusable
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
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
                      : 'border-white/10 bg-surface hover:bg-white/[0.06] hover:border-white/20'
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
                  <p className="text-xs font-semibold text-white">{t.label}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
