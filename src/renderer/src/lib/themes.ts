// Theme registry — single source of truth for what themes exist.
//
// Adding a theme:
//   1. Append a new entry to THEMES below.
//   2. Add a matching :root[data-theme="<id>"] { … } block in index.css
//      with all the same CSS variables defined on :root[data-theme="dark"].
//
// "dynamic" rebuilds the entire palette at runtime from whichever poster
// the user last hovered. See lib/dynamicTheme.ts.

export type ThemeMode = 'dark' | 'light'

export type ThemeDefinition = {
  id: string
  label: string
  mode: ThemeMode
  /** 3-4 hex colours for the swatch preview in the theme picker. */
  swatches: string[]
  /** One-liner shown under the theme name in the picker. */
  blurb: string
}

// Mirrors the web's promoted set (light / purple-haze / beach / mono-grey
// are absent here matching the "drop unfinished from main" commit).
export const THEMES: ThemeDefinition[] = [
  {
    id: 'dark',
    label: 'Dark',
    mode: 'dark',
    swatches: ['#0a0a0a', '#1c1c1f', '#dc2626'],
    blurb: 'Eerie black + red — the classic VALOR look.',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    mode: 'dark',
    swatches: ['#050816', '#38bdf8', '#6366f1'],
    blurb: 'Deep navy with a cyan-violet accent.',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    mode: 'dark',
    swatches: ['#021526', '#2dd4bf', '#0ea5e9'],
    blurb: 'Deep teal water with a turquoise accent.',
  },
  {
    id: 'sunset',
    label: 'Sunset',
    mode: 'dark',
    swatches: ['#1a0824', '#f472b6', '#f97316'],
    blurb: 'Plum, pink, and orange — gradient skies.',
  },
  {
    id: 'halloween',
    label: 'Halloween',
    mode: 'dark',
    swatches: ['#0a0506', '#ea580c', '#7e22ce'],
    blurb: 'Pumpkin orange + witchy violet.',
  },
  {
    id: 'christmas',
    label: 'Christmas',
    mode: 'dark',
    swatches: ['#07120c', '#dc2626', '#16a34a'],
    blurb: 'Holly red + pine green.',
  },
  {
    id: 'forest',
    label: 'Forest',
    mode: 'dark',
    swatches: ['#0c1410', '#65a30d', '#b45309'],
    blurb: 'Moss + earth, calming greens.',
  },
  {
    id: 'dynamic',
    label: 'Dynamic',
    mode: 'dark',
    // Multi-hue swatch to hint "follows whatever you look at".
    swatches: ['#a855f7', '#dc2626', '#10b981'],
    blurb: 'Palette follows the hovered poster — fades back when you stop.',
  },
]

export const THEME_IDS = THEMES.map((t) => t.id)

export const DEFAULT_THEME_ID = 'dark'

export const THEME_STORAGE_KEY = 'valor_theme'
