/**
 * generate-assets.mjs
 *
 * Generates the 24-bit BMP images required by the NSIS installer:
 *   build/installerSidebar.bmp  164×314 px  (welcome / finish page left panel)
 *   build/installerHeader.bmp   150×57  px  (inner pages header right slot)
 *
 * Pure Node.js — no external dependencies.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const buildDir  = join(__dirname, '..', 'build')

mkdirSync(buildDir, { recursive: true })

// ─── BMP writer ───────────────────────────────────────────────────────────────
// Standard uncompressed 24-bit BMP (bottom-up row order, BGR byte order).

function writeBMP(width, height, getColor) {
  const rowStride      = Math.ceil(width * 3 / 4) * 4   // rows padded to 4 bytes
  const pixelDataSize  = rowStride * height
  const fileSize       = 54 + pixelDataSize
  const buf            = Buffer.alloc(fileSize, 0)

  // ── File header (14 bytes) ─────────────────────────────────────────────────
  buf[0] = 0x42; buf[1] = 0x4D               // 'BM' signature
  buf.writeUInt32LE(fileSize, 2)             // total file size
  // bytes 6-9: reserved (0)
  buf.writeUInt32LE(54, 10)                  // pixel data offset

  // ── BITMAPINFOHEADER (40 bytes at offset 14) ───────────────────────────────
  buf.writeUInt32LE(40, 14)                  // header size
  buf.writeInt32LE(width, 18)               // image width
  buf.writeInt32LE(height, 22)              // positive → bottom-up rows
  buf.writeUInt16LE(1, 26)                  // colour planes
  buf.writeUInt16LE(24, 28)                 // 24 bits per pixel
  buf.writeUInt32LE(0, 30)                  // compression (BI_RGB = none)
  buf.writeUInt32LE(pixelDataSize, 34)      // size of pixel data
  buf.writeInt32LE(2835, 38)                // horizontal DPI ~72
  buf.writeInt32LE(2835, 42)                // vertical DPI ~72
  // bytes 46-53: colour table (0 = unused for 24-bit)

  // ── Pixel data (BGR, bottom-up) ────────────────────────────────────────────
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getColor(x, y, width, height)
      const off = 54 + (height - 1 - y) * rowStride + x * 3
      buf[off]     = clamp(b)
      buf[off + 1] = clamp(g)
      buf[off + 2] = clamp(r)
    }
  }

  return buf
}

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))) }
function lerp(a, b, t)  { return a + (b - a) * Math.max(0, Math.min(1, t)) }

// ─── Sidebar colour function  (164×314) ──────────────────────────────────────
//
//  Design: "Cinema Noir"
//   • Deep blue-black background — premium, not flat black
//   • 8 px left edge — vivid-red (#E00000) fading to deep crimson (#780000)
//   • Warm radial glow emanating from bottom-left corner (red ambience)
//   • Additional concentrated glow in the bottom 120 px
//   • Fine horizontal scan lines every 8 rows for a subtle CRT/cinema texture
//   • Slight right-edge vignette to frame the NSIS text area
//
function sidebarColor(x, y, w, h) {
  const gy = y / h   // 0 = top, 1 = bottom
  const gx = x / w   // 0 = left, 1 = right

  // ── Left red accent stripe (8 px) ───────────────────────────────────────
  if (x < 8) {
    return [
      lerp(224, 80, gy),   // R  vivid red → deep crimson
      lerp(8,   0, gy),    // G  slight warmth at top
      0                    // B
    ]
  }

  // ── Base: deep blue-black gradient ──────────────────────────────────────
  let r = lerp(13, 7,  gy)
  let g = lerp(14, 8,  gy)
  let b = lerp(19, 12, gy)  // slight blue tint for premium feel

  // ── Radial warm glow from bottom-left corner ─────────────────────────────
  // Simulates the red stripe casting light across the lower portion
  const dx = x - 8          // horizontal distance from stripe edge
  const dy = h - y           // vertical distance from bottom
  const dist = Math.sqrt(dx * dx * 0.4 + dy * dy)   // elliptical, wider than tall
  const glowRadius = h * 0.85
  if (dist < glowRadius) {
    const t = 1 - dist / glowRadius
    const intensity = t * t * 48   // quadratic falloff, peak ~48 at origin
    r += intensity
    g += intensity * 0.08          // tiny warmth to avoid pure red
  }

  // ── Concentrated bottom glow (bottom 120 px) ─────────────────────────────
  if (y > h - 120) {
    const t = (y - (h - 120)) / 120
    r += Math.pow(t, 1.5) * 22
  }

  // ── Right-edge vignette (very subtle) ────────────────────────────────────
  if (gx > 0.7) {
    const v = ((gx - 0.7) / 0.3) * 4
    r -= v; g -= v; b -= v
  }

  // ── Fine horizontal scan lines — cinema texture ───────────────────────────
  if (y % 8 === 0) {
    r -= 2; g -= 2; b -= 2
  }

  return [r, g, b]
}

// ─── Header colour function  (150×57) ────────────────────────────────────────
//
//  Design: matches the sidebar's blue-black palette
//   • Deep background with left-to-right warmth gradient
//   • 5 px vivid left red accent
//   • 2 px bottom red separator line
//
function headerColor(x, y, w, h) {
  // ── Left red accent (5 px) ───────────────────────────────────────────────
  if (x < 5) {
    return [215, 8, 0]
  }

  // ── Bottom red separator (2 px) ──────────────────────────────────────────
  if (y >= h - 2) {
    return [150, 0, 0]
  }

  // ── Background: dark blue-black fading slightly lighter right-to-left ────
  const gx = (x - 5) / (w - 5)   // 0 = just inside stripe, 1 = far right
  const r = Math.round(lerp(13, 22, gx))
  const g = Math.round(lerp(14, 22, gx))
  const b = Math.round(lerp(19, 26, gx))

  return [r, g, b]
}

// ─── Generate ─────────────────────────────────────────────────────────────────

const sidebar = writeBMP(164, 314, sidebarColor)
writeFileSync(join(buildDir, 'installerSidebar.bmp'), sidebar)
console.log('  ✓ build/installerSidebar.bmp  (164×314)')

const header = writeBMP(150, 57, headerColor)
writeFileSync(join(buildDir, 'installerHeader.bmp'), header)
console.log('  ✓ build/installerHeader.bmp   (150×57)')
