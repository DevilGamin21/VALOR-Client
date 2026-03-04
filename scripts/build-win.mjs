#!/usr/bin/env node
/**
 * build-win.mjs — VALOR Windows Build Pipeline
 *
 * Usage:
 *   node scripts/build-win.mjs [patch|minor|major|none] [--release]
 *
 *   patch    (default) increment patch version  e.g. 0.1.0 → 0.1.1
 *   minor              increment minor version  e.g. 0.1.0 → 0.2.0
 *   major              increment major version  e.g. 0.1.0 → 1.0.0
 *   none               skip version bump
 *
 *   --release   also upload latest.yml + installer to the publish URL
 *               (requires GH_TOKEN or equivalent credentials configured)
 *
 * npm script shortcuts (package.json):
 *   npm run build:win           → patch bump, local only
 *   npm run build:win:minor     → minor bump, local only
 *   npm run release:win         → patch bump + upload to update server
 */

import { execSync }                              from 'child_process'
import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname }                        from 'path'
import { fileURLToPath }                        from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root      = join(__dirname, '..')
const pkgPath   = join(root, 'package.json')

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const R   = '\x1b[31m'   // red
const G   = '\x1b[32m'   // green
const Y   = '\x1b[33m'   // yellow
const C   = '\x1b[36m'   // cyan
const W   = '\x1b[37m'   // white
const DIM = '\x1b[2m'
const B   = '\x1b[1m'
const RST = '\x1b[0m'

const print  = (s)      => process.stdout.write(s + '\n')
const step   = (n, t, s) => print(`\n${C}  [${n}/${t}]${RST}  ${s}`)
const ok     = (s)      => print(`${G}       ✓${RST}  ${s}`)
const warn   = (s)      => print(`${Y}       !${RST}  ${s}`)
const die    = (s)      => { print(`\n${R}  ✗ FAILED${RST}  ${s}\n`); process.exit(1) }

function run(cmd, label) {
  try {
    execSync(cmd, { cwd: root, stdio: 'inherit' })
    if (label) ok(label)
  } catch {
    die(`Command failed: ${cmd}`)
  }
}

function readPkg() {
  return JSON.parse(readFileSync(pkgPath, 'utf-8'))
}

// ─── Parse args ───────────────────────────────────────────────────────────────
const args     = process.argv.slice(2)
const bumpType = (['patch','minor','major','none'].includes(args[0]) ? args[0] : null)
                 ?? 'patch'
const release  = args.includes('--release')

if (!['patch','minor','major','none'].includes(bumpType)) {
  die(`Unknown bump type "${bumpType}". Use patch, minor, major, or none.`)
}

// ─── Banner ───────────────────────────────────────────────────────────────────
print('')
print(`${R}${B}  ██╗   ██╗ █████╗ ██╗      ██████╗ ██████╗ ${RST}`)
print(`${R}${B}  ██║   ██║██╔══██╗██║     ██╔═══██╗██╔══██╗${RST}`)
print(`${R}${B}  ██║   ██║███████║██║     ██║   ██║██████╔╝${RST}`)
print(`${R}${B}  ╚██╗ ██╔╝██╔══██║██║     ██║   ██║██╔══██╗${RST}`)
print(`${R}${B}   ╚████╔╝ ██║  ██║███████╗╚██████╔╝██║  ██║${RST}`)
print(`${R}${B}    ╚═══╝  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝${RST}`)
print('')
print(`${W}${B}  Desktop Client — Windows Build Pipeline${RST}`)
print(`${DIM}  ─────────────────────────────────────────────────────${RST}`)

const prevVersion = readPkg().version
print(`${DIM}  Mode    : ${bumpType}${release ? ' + release upload' : ' (local only)'}${RST}`)
print(`${DIM}  Version : ${prevVersion}${RST}`)

// ─── Disable code signing (no cert; avoids Authenticode signing) ──────────────
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
process.env.WIN_CSC_LINK                = ''

// ─── Pre-extract winCodeSign so its macOS symlinks never need admin rights ─────
// electron-builder downloads winCodeSign (a signing toolkit) and extracts it
// with 7za -snl which tries to create real Windows symlinks — a privileged op.
// If we pre-extract ourselves WITHOUT that flag, the darwin .dylib symlinks are
// silently skipped, Windows tools are fully extracted, and electron-builder finds
// the cache directory already present and skips its own download+extraction.
function ensureWinCodeSign() {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return  // not Windows

  const WCS_VERSION = 'winCodeSign-2.6.0'
  const cacheDir    = join(localAppData, 'electron-builder', 'Cache', 'winCodeSign', WCS_VERSION)
  if (existsSync(cacheDir)) return  // already cached — nothing to do

  warn('winCodeSign not cached — pre-extracting (this avoids the symlink privilege error)…')

  // The archive is FLAT (no top-level subfolder), so we must extract directly
  // INTO cacheDir so app-builder finds the tools at winCodeSign-2.6.0/{files}.
  const parentDir = join(localAppData, 'electron-builder', 'Cache', 'winCodeSign')
  const tmpFile   = join(parentDir, '_wcs.7z')
  const url       = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${WCS_VERSION}/${WCS_VERSION}.7z`
  const sevenZip  = join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')

  mkdirSync(cacheDir, { recursive: true })

  try {
    execSync(
      `powershell -NoProfile -Command "(New-Object Net.WebClient).DownloadFile('${url}','${tmpFile}')"`,
      { cwd: root, stdio: 'inherit' }
    )
  } catch {
    warn('Could not download winCodeSign — packaging may fail')
    return
  }

  try {
    // Extract WITHOUT -snl so macOS symlinks are just skipped (not created as real
    // Windows symlinks, which requires elevated privilege).  7-zip exits code 2
    // for the 2 skipped darwin symlinks — that's a warning, not a fatal error.
    execSync(`"${sevenZip}" x -y -bd "${tmpFile}" "-o${cacheDir}"`, { stdio: 'pipe' })
    ok(`winCodeSign extracted  (macOS .dylib symlinks skipped — not needed on Windows)`)
  } catch {
    ok(`winCodeSign extracted  (macOS symlinks skipped — continuing)`)
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

// ─── Auto-install deps if node_modules is missing ─────────────────────────────
if (!existsSync(join(root, 'node_modules'))) {
  print(`\n${Y}  node_modules not found — running npm install first…${RST}\n`)
  run('npm install', 'Dependencies installed')
}

// ─── STEPS ────────────────────────────────────────────────────────────────────
const TOTAL = release ? 5 : 4

// ── Step 1: Version bump ──────────────────────────────────────────────────────
step(1, TOTAL, 'Bumping version…')
if (bumpType !== 'none') {
  run(`npm version ${bumpType} --no-git-tag-version`)
  const next = readPkg().version
  ok(`${prevVersion}  →  ${next}`)
} else {
  warn(`Skipping version bump  (still ${prevVersion})`)
}

// ── Step 2: Installer assets ─────────────────────────────────────────────────
step(2, TOTAL, 'Generating installer assets…')
run('node scripts/generate-assets.mjs')

// ── Step 3: Compile ───────────────────────────────────────────────────────────
step(3, TOTAL, 'Compiling Electron app…')
run('npm run build', 'Compile complete')

// ── Step 4: Package ───────────────────────────────────────────────────────────
const publishFlag = release ? '--publish always' : '--publish never'
step(4, TOTAL, `Packaging installer  ${DIM}(${publishFlag})${RST}…`)
ensureWinCodeSign()
run(`npx electron-builder --win ${publishFlag}`, 'Installer packaged')

// ── Step 5 (release only): Upload confirmation ───────────────────────────────
if (release) {
  step(5, TOTAL, 'Published to GitHub Releases')
  const v = readPkg().version
  ok(`GitHub Release → https://github.com/DevilGamin21/VALOR-Client/releases/tag/v${v}`)
  ok(`Installer      → VALOR-Setup-${v}.exe (attached to release)`)
  ok(`Update feed    → latest.yml (attached to release)`)
}

// ─── Summary ──────────────────────────────────────────────────────────────────
const finalVersion = readPkg().version
print('')
print(`${G}${B}  ✓ Build complete!${RST}`)
print(`${DIM}  Version  : ${finalVersion}${RST}`)
print(`${DIM}  Artifact : dist/VALOR-Setup-${finalVersion}.exe${RST}`)
if (!release) {
  print('')
  print(`${DIM}  To publish this build to the update channel, run:${RST}`)
  print(`${DIM}    npm run release:win${RST}`)
}
print('')
