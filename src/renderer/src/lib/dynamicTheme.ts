// ──────────────────────────────────────────────────────────────────────
// Dynamic theme — full palette derived from a media poster's three tones.
//
// Dynamic is its own standalone theme (data-theme="dynamic"). On hover
// we sample three representative colours from the poster:
//   - shadow    (darkest dominant colour)
//   - midtone   (mid-brightness vibrant colour, "the vibe")
//   - highlight (lightest dominant colour)
// and rebuild the ENTIRE palette from them — backgrounds, accents,
// gradients, login blobs, the works.
//
// Lifecycle:
//   1. pulseDynamicTheme(url, themeId) fires from MovieCard onMouseEnter.
//   2. Three tones extracted off a canvas via lightness-bucketing.
//   3. All theme tokens interpolated toward the new tones over
//      ANIMATION_MS via rAF — smooth, ease-out-cubic.
//   4. Reset timer (RESET_DELAY_MS) fades back to a default trio if
//      no new pulse arrives — the page settles instead of staying
//      stuck on whatever the last hover was.
//
// Port note: the web version routes image.tmdb.org through an
// /api/img-proxy because Cloudflare blocks the CORS preflight. The
// Electron renderer talks to image.tmdb.org directly (Access-Control-
// Allow-Origin: *) so the proxy hop is unnecessary here.
// ──────────────────────────────────────────────────────────────────────

type RGB = { r: number; g: number; b: number }
type HSL = { h: number; s: number; l: number }
type Tones = { shadow: RGB; midtone: RGB; highlight: RGB }

// Animation tuning
const ANIMATION_MS = 700
const RESET_DELAY_MS = 8000

// Default tones used until the first hover, and to fade back to on
// reset. Indigo / violet — distinct from any of the static themes.
const DEFAULT_TONES: Tones = {
  shadow:    { r: 17,  g: 13,  b: 32  },
  midtone:   { r: 99,  g: 102, b: 241 },
  highlight: { r: 168, g: 85,  b: 247 },
}

// Tokens Dynamic overrides — everything in the theme block. Used by
// clearDynamicPalette to restore the underlying CSS block cleanly.
const ALL_TOKENS = [
  '--bg-base', '--bg-surface', '--bg-elevated', '--bg-input',
  '--text-primary', '--text-secondary', '--text-muted',
  '--accent', '--accent-hover', '--accent-soft', '--accent-fg', '--accent-ring',
  '--border-base', '--border-strong', '--ring-hover',
  '--gradient-page', '--gradient-accent', '--gradient-hero', '--gradient-brand',
  '--login-blob-1', '--login-blob-2', '--login-blob-3',
] as const

// Mutable per-tab state
const cache = new Map<string, Tones>()
let currentTones: Tones | null = null
let animFrame: number | null = null
let resetTimer: ReturnType<typeof setTimeout> | null = null

// ── Public API ──────────────────────────────────────────────────────

export async function pulseDynamicTheme(
  url: string | null | undefined,
  currentThemeId: string,
): Promise<boolean> {
  if (currentThemeId !== 'dynamic') return false
  if (!url) return false

  const tones = await extractTones(url)
  if (!tones) return false

  animateTonesTo(tones)
  scheduleReset()
  return true
}

export function clearDynamicPalette(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const t of ALL_TOKENS) root.style.removeProperty(t)
  currentTones = null
  if (animFrame !== null) {
    cancelAnimationFrame(animFrame)
    animFrame = null
  }
  if (resetTimer !== null) {
    clearTimeout(resetTimer)
    resetTimer = null
  }
}

// ── Three-tone extraction ──────────────────────────────────────────

async function extractTones(url: string): Promise<Tones | null> {
  if (!url) return null
  const cached = cache.get(url)
  if (cached) return cached
  try {
    const tones = await loadAndExtractTones(url)
    cache.set(url, tones)
    return tones
  } catch {
    return null
  }
}

function loadAndExtractTones(url: string): Promise<Tones> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => reject(new Error('image load failed'))
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const SIZE = 80
        canvas.width = SIZE
        canvas.height = SIZE
        const ctx = canvas.getContext('2d', { willReadFrequently: false })
        if (!ctx) return reject(new Error('no canvas context'))
        ctx.drawImage(img, 0, 0, SIZE, SIZE)
        const data = ctx.getImageData(0, 0, SIZE, SIZE).data
        const tones = pickThreeTones(data)
        if (!tones) return reject(new Error('no usable tones'))
        resolve(tones)
      } catch (e) {
        reject(e as Error)
      }
    }
    img.src = url
  })
}

type AccumBucket = { rSum: number; gSum: number; bSum: number; count: number; weight: number }

function pickThreeTones(data: Uint8ClampedArray): Tones | null {
  // Three buckets, indexed by 12-bit colour key, holding weighted RGB
  // accumulators. Pixels are sorted into a bucket by HSL lightness.
  const shadowB = new Map<number, AccumBucket>()
  const midB    = new Map<number, AccumBucket>()
  const hiB     = new Map<number, AccumBucket>()

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    if (a < 128) continue

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 12) continue   // pure-black borders dominate otherwise
    if (min > 243) continue  // pure-white borders too

    const L = (max + min) / 2 / 255
    const sat = max === 0 ? 0 : (max - min) / max
    // Weight: a small splash of vibrant colour beats a sea of muddy
    // grey. Same trick as the single-colour version.
    const weight = 1 + sat * 3

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const target = L < 0.30 ? shadowB : L < 0.62 ? midB : hiB
    const bucket = target.get(key)
    if (bucket) {
      bucket.rSum += r
      bucket.gSum += g
      bucket.bSum += b
      bucket.count += 1
      bucket.weight += weight
    } else {
      target.set(key, { rSum: r, gSum: g, bSum: b, count: 1, weight })
    }
  }

  const shadow    = pickBestBucket(shadowB)
  const midtone   = pickBestBucket(midB)
  const highlight = pickBestBucket(hiB)

  // Midtone is the anchor — we need something to derive a vibe from.
  if (!midtone) return null

  return {
    shadow:    shadow    ?? deriveDarker(midtone),
    midtone,
    highlight: highlight ?? deriveLighter(midtone),
  }
}

function pickBestBucket(buckets: Map<number, AccumBucket>): RGB | null {
  let best: AccumBucket | null = null
  for (const b of buckets.values()) {
    if (!best || b.weight > best.weight) best = b
  }
  if (!best) return null
  return {
    r: Math.round(best.rSum / best.count),
    g: Math.round(best.gSum / best.count),
    b: Math.round(best.bSum / best.count),
  }
}

function deriveDarker(rgb: RGB): RGB {
  const hsl = rgbToHsl(rgb)
  return hslToRgb(hsl.h, Math.min(0.45, hsl.s), Math.max(0.04, hsl.l - 0.45))
}

function deriveLighter(rgb: RGB): RGB {
  const hsl = rgbToHsl(rgb)
  return hslToRgb(hsl.h, Math.min(0.75, hsl.s + 0.05), Math.min(0.85, hsl.l + 0.3))
}

// ── Animation ──────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  }
}

function lerpTones(a: Tones, b: Tones, t: number): Tones {
  return {
    shadow:    lerpRgb(a.shadow,    b.shadow,    t),
    midtone:   lerpRgb(a.midtone,   b.midtone,   t),
    highlight: lerpRgb(a.highlight, b.highlight, t),
  }
}

function animateTonesTo(target: Tones, onDone?: () => void): void {
  if (typeof window === 'undefined') return
  const start = currentTones ?? DEFAULT_TONES
  const startTime = performance.now()

  if (animFrame !== null) cancelAnimationFrame(animFrame)

  const step = (now: number) => {
    const t = Math.min(1, (now - startTime) / ANIMATION_MS)
    const eased = easeOutCubic(t)
    const interp = lerpTones(start, target, eased)
    currentTones = interp
    applyPalette(interp)
    if (t < 1) {
      animFrame = requestAnimationFrame(step)
    } else {
      animFrame = null
      if (onDone) onDone()
    }
  }

  animFrame = requestAnimationFrame(step)
}

function scheduleReset(): void {
  if (typeof window === 'undefined') return
  if (resetTimer !== null) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    resetTimer = null
    animateTonesTo(DEFAULT_TONES, () => {
      // After fading to default, drop the inline overrides so the
      // :root[data-theme="dynamic"] CSS block takes over cleanly.
      if (typeof document === 'undefined') return
      const root = document.documentElement
      for (const t of ALL_TOKENS) root.style.removeProperty(t)
      currentTones = null
    })
  }, RESET_DELAY_MS)
}

// ── Palette application ────────────────────────────────────────────

function applyPalette(tones: Tones): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  const shadowHsl    = rgbToHsl(tones.shadow)
  const midHsl       = rgbToHsl(tones.midtone)
  const highlightHsl = rgbToHsl(tones.highlight)

  // Background: shadow tone forced dark and only mildly saturated, so
  // the whole page reads as a "tinted dark theme" rather than a muddy
  // colour wash.
  const bgBase     = hslToRgb(shadowHsl.h, Math.min(0.40, shadowHsl.s), Math.min(0.08, shadowHsl.l + 0.02))
  const bgSurface  = hslToRgb(shadowHsl.h, Math.min(0.42, shadowHsl.s), Math.min(0.13, shadowHsl.l + 0.07))
  const bgElevated = hslToRgb(shadowHsl.h, Math.min(0.42, shadowHsl.s), Math.min(0.17, shadowHsl.l + 0.11))

  // Accent: midtone, with saturation/lightness clamped so the button
  // colour pops on the dark background.
  const accentSat   = Math.max(0.55, Math.min(0.95, midHsl.s))
  const accentLight = Math.max(0.45, Math.min(0.65, midHsl.l))
  const accent      = hslToRgb(midHsl.h, accentSat, accentLight)
  const accentHover = hslToRgb(midHsl.h, accentSat, Math.min(0.72, accentLight + 0.08))

  // Highlight: lightest tone, boosted so it reads as a real "glow"
  // for the bottom of the gradient and the brand gradient.
  const hiBoost = hslToRgb(
    highlightHsl.h,
    Math.max(0.45, highlightHsl.s),
    Math.max(0.55, Math.min(0.78, highlightHsl.l)),
  )

  // Backgrounds & inputs
  root.style.setProperty('--bg-base',     hex(bgBase))
  root.style.setProperty('--bg-surface',  hex(bgSurface))
  root.style.setProperty('--bg-elevated', hex(bgElevated))
  root.style.setProperty('--bg-input',    rgba(accent, 0.06))

  // Text — always white on dynamic (auto contrast against dark bg)
  root.style.setProperty('--text-primary',   '#ffffff')
  root.style.setProperty('--text-secondary', 'rgba(255, 255, 255, 0.72)')
  root.style.setProperty('--text-muted',     'rgba(255, 255, 255, 0.45)')

  // Accent group
  root.style.setProperty('--accent',       hex(accent))
  root.style.setProperty('--accent-hover', hex(accentHover))
  root.style.setProperty('--accent-soft',  rgba(accent, 0.18))
  root.style.setProperty('--accent-fg',    '#ffffff')
  root.style.setProperty('--accent-ring',  rgba(accent, 0.5))

  // Borders & rings
  root.style.setProperty('--border-base',   rgba(accent, 0.16))
  root.style.setProperty('--border-strong', rgba(accent, 0.3))
  root.style.setProperty('--ring-hover',    rgba(hiBoost, 0.65))

  // Gradient (inverted): highlight aurora blooms at the TOP, midtone
  // through the middle, shadow at the bottom. Vignette on top darkens
  // the corners so the bright top doesn't run flat into the viewport
  // edges — a slight "cinema screen" framing instead of a flat wash.
  const gradient =
    `radial-gradient(ellipse at center, transparent 45%, rgba(0, 0, 0, 0.55) 100%), ` +
    `radial-gradient(ellipse 110vw 55vh at 50% -5%, ${rgba(hiBoost, 0.5)} 0%, transparent 70%), ` +
    `linear-gradient(to top, ${hex(bgBase)} 0%, ${rgba(accent, 0.22)} 55%, ${rgba(hiBoost, 0.18)} 100%), ` +
    `${hex(bgBase)}`
  root.style.setProperty('--gradient-page', gradient)

  root.style.setProperty(
    '--gradient-accent',
    `linear-gradient(135deg, ${hex(accent)}, ${hex(hiBoost)})`,
  )
  root.style.setProperty(
    '--gradient-hero',
    `linear-gradient(to top, ${hex(bgBase)} 0%, rgba(0, 0, 0, 0.4) 60%, transparent 100%)`,
  )
  root.style.setProperty(
    '--gradient-brand',
    `linear-gradient(135deg, ${rgba(accent, 0.4)}, ${rgba(hiBoost, 0.55)})`,
  )

  // Login blobs — use all three tones for a multicoloured backdrop
  root.style.setProperty('--login-blob-1', rgba(accent, 0.4))
  root.style.setProperty('--login-blob-2', rgba(hiBoost, 0.3))
  root.style.setProperty('--login-blob-3', rgba(tones.midtone, 0.25))
}

// ── Colour conversions ────────────────────────────────────────────

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rN) h = (gN - bN) / d + (gN < bN ? 6 : 0)
    else if (max === gN) h = (bN - rN) / d + 2
    else h = (rN - gN) / d + 4
    h *= 60
  }
  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function hex({ r, g, b }: RGB): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function rgba({ r, g, b }: RGB, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
