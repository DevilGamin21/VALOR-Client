import { app, BrowserWindow, ipcMain, session, shell, nativeImage, screen } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import type { Client as DiscordRpcClient, Presence } from 'discord-rpc'
import { MpvPlayer, isMpvAvailable } from './mpvPlayer'

// Channel id baked in at build time by electron.vite.config.ts. The
// __CHANNEL_ID__ global is a literal-string substitution from Vite's define.
declare const __CHANNEL_ID__: string
const CHANNEL_ID = __CHANNEL_ID__ as 'stable' | 'seth' | 'brazen'
// electron-updater channel name. Stable maps to 'latest' so existing
// installs (which were built before this scheme and look at latest.yml)
// keep receiving updates without a migration. Non-stable channels each
// get their own update feed (seth.yml / brazen.yml).
const UPDATER_CHANNEL = CHANNEL_ID === 'stable' ? 'latest' : CHANNEL_ID

interface AccountEntry {
  id: string
  username: string
  token: string
  avatarUrl: string | null
}
type ValorChannel = 'stable' | 'seth' | 'brazen'
interface StoreSchema {
  token: string                       // legacy single-token (migrated on first use)
  accounts: AccountEntry[]
  activeAccountId: string | null
  // null = follow whatever channel this binary was built as. Set by the
  // user via Settings → Release Channel. If it differs from CHANNEL_ID at
  // startup the app fetches and installs the cross-channel installer.
  desiredChannel: ValorChannel | null
}
const store = new Store<StoreSchema>({
  defaults: { token: '', accounts: [], activeAccountId: null, desiredChannel: null }
})
const API_ORIGIN = 'https://valor.dawn-star.co.uk'

let mainWindow: BrowserWindow | null = null
let playerWindow: BrowserWindow | null = null  // Black host window for embedded mpv
let overlayWindow: BrowserWindow | null = null  // Transparent controls overlay (child of playerWindow)
let mpvInstance: MpvPlayer | null = null
let mpvPayload: unknown = null

// ─── Discord Rich Presence ────────────────────────────────────────────────────
// Create an application at https://discord.com/developers/applications, then
// paste the Application ID (Client ID) below.
const DISCORD_CLIENT_ID = '1478033478275829902'

let discordRpc: DiscordRpcClient | null = null
let discordReady = false

function initDiscordRPC(): void {
  if (DISCORD_CLIENT_ID === 'YOUR_APPLICATION_ID_HERE') return
  console.log('[Discord RPC] Attempting connection…')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require('discord-rpc') as typeof import('discord-rpc')
    const rpc = new Client({ transport: 'ipc' })

    rpc.on('ready', () => {
      console.log('[Discord RPC] Connected and ready.')
      discordRpc = rpc
      discordReady = true
    })

    rpc.on('disconnected', () => {
      console.log('[Discord RPC] Disconnected. Will retry in 30 s.')
      discordReady = false
      discordRpc = null
      setTimeout(initDiscordRPC, 30_000)
    })

    rpc.login({ clientId: DISCORD_CLIENT_ID }).catch((err: Error) => {
      console.warn('[Discord RPC] Login failed:', err?.message ?? err)
      setTimeout(initDiscordRPC, 30_000)
    })
  } catch (err) {
    console.warn('[Discord RPC] Module error:', err)
    setTimeout(initDiscordRPC, 30_000)
  }
}

// ─── Auto-updater setup ───────────────────────────────────────────────────────

/** Wipe any half-downloaded installer left in the pending folder.
 *  electron-updater writes to `temp-VALOR-Setup.exe` and renames to
 *  `VALOR-Setup.exe` — if the rename failed previously (EPERM from Defender
 *  scanning the file mid-rename, or a stale handle from a prior instance),
 *  the leftover file blocks every subsequent download attempt. Wiping the
 *  folder on startup makes the updater self-heal. */
function cleanPendingUpdates(): void {
  try {
    // electron-updater stores at <userData>/../<app>-updater/pending — for our
    // appId this resolves to %LOCALAPPDATA%/valor-client-updater/pending.
    // Use the documented path rather than guessing.
    const localAppData = process.env.LOCALAPPDATA
    if (!localAppData) return
    const pendingDir = join(localAppData, 'valor-client-updater', 'pending')
    require('fs').rmSync(pendingDir, { recursive: true, force: true })
  } catch {
    // Best-effort — if the folder is locked we'll surface the rename error
    // through the existing update:error path, which the banner shows.
  }
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.allowElevation = false

  // Resolve which update feed to poll. If the user picked a non-default
  // channel via Settings, we follow that (cross-channel installer swap is
  // how channel switching actually happens — see channel:setDesired IPC).
  // Otherwise we use the channel baked into this binary.
  const desired = store.get('desiredChannel') as ValorChannel | null
  const effectiveChannel: ValorChannel = desired ?? CHANNEL_ID
  if (effectiveChannel !== CHANNEL_ID) {
    autoUpdater.channel = effectiveChannel === 'stable' ? 'latest' : effectiveChannel
    autoUpdater.allowDowngrade = true
  } else {
    autoUpdater.channel = UPDATER_CHANNEL
  }
  // allowPrerelease deliberately stays false. electron-updater's prerelease
  // discovery only handles semver-style prerelease tags (v1.0.0-beta.1) — it
  // matches the prerelease label against autoUpdater.channel. Our channel
  // ids are bare strings ("brazen"/"seth"), so flipping allowPrerelease on
  // sends the provider into a code path that finds no matching tag and
  // throws "No published versions on GitHub". Keeping it false means the
  // provider hits /releases/latest, which we keep pointed at a release
  // that carries every channel's yml (every release goes out to all
  // channels at the same version).

  cleanPendingUpdates()

  // Check 5 s after launch so the UI is ready before any banner appears
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes ?? null
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    const msg = err.message ?? ''
    // Suppress benign errors when no update server is configured yet
    if (msg.includes('404') || msg.includes('ENOTFOUND') || msg.includes('ERR_NAME_NOT_RESOLVED')) return
    mainWindow?.webContents.send('update:error', msg)
  })
}

// ─── Window creation ──────────────────────────────────────────────────────────
function createWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(process.cwd(), 'icon/logo.png')
  const appIcon = nativeImage.createFromPath(iconPath)

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    frame: false,
    icon: appIcon,
    // Taskbar / alt-tab cue for testers on non-stable builds.
    title: CHANNEL_ID === 'stable' ? 'VALOR' : `VALOR — ${CHANNEL_ID}`,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  })

  // Inject Origin/Referer for ALL outgoing requests from the renderer.
  // Electron's file:// protocol sends a null origin, causing CORS failures on
  // both the backend API and Jellyfin's direct HLS stream URLs.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      const headers = details.requestHeaders
      if (!headers['Origin'] && !headers['origin']) {
        headers['Origin'] = API_ORIGIN
        headers['Referer'] = `${API_ORIGIN}/`
      }
      callback({ requestHeaders: headers })
    }
  )

  // Ensure CORS response headers exist so HLS.js can consume Jellyfin stream responses.
  session.defaultSession.webRequest.onHeadersReceived(
    (details, callback) => {
      const rh = { ...details.responseHeaders }
      if (!rh['access-control-allow-origin'] && !rh['Access-Control-Allow-Origin']) {
        rh['access-control-allow-origin'] = ['*']
      }
      callback({ responseHeaders: rh })
    }
  )

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    setupAutoUpdater()
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Ctrl+Shift+I toggles DevTools in production builds for diagnostics
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false))
  mainWindow.on('closed', () => { mainWindow = null })
}

// ─── Window control IPC ──────────────────────────────────────────────────────
ipcMain.handle('win:minimize', () => mainWindow?.minimize())
ipcMain.handle('win:maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()
})
ipcMain.handle('win:close', () => mainWindow?.close())
ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('win:setFullScreen', (_e, full: boolean) => {
  if (!mainWindow) return
  mainWindow.setFullScreen(full)
})

// ─── Auth token IPC (multi-account) ───────────────────────────────────────────
ipcMain.handle('auth:getToken', () => {
  const activeId = store.get('activeAccountId')
  if (activeId) {
    const acct = (store.get('accounts', []) as AccountEntry[]).find(a => a.id === activeId)
    if (acct) return acct.token
  }
  // Legacy fallback — single token stored before multi-account migration
  return store.get('token', null) || null
})

ipcMain.handle('auth:setToken', (_e, token: string) => {
  // Legacy path — kept for backward compat during login flow
  store.set('token', token)
})

ipcMain.handle('auth:clearToken', () => {
  const activeId = store.get('activeAccountId')
  if (activeId) {
    const accounts = (store.get('accounts', []) as AccountEntry[]).filter(a => a.id !== activeId)
    store.set('accounts', accounts)
    store.set('activeAccountId', accounts[0]?.id ?? null)
  } else {
    store.delete('token')
  }
})

ipcMain.handle('auth:getAccounts', () => store.get('accounts', []))

ipcMain.handle('auth:addAccount', (_e, account: AccountEntry) => {
  const accounts = store.get('accounts', []) as AccountEntry[]
  const idx = accounts.findIndex(a => a.id === account.id)
  if (idx >= 0) {
    accounts[idx] = account
  } else {
    accounts.push(account)
  }
  store.set('accounts', accounts)
  store.set('activeAccountId', account.id)
  // Clear legacy single-token key
  store.delete('token')
})

ipcMain.handle('auth:removeAccount', (_e, accountId: string) => {
  const accounts = (store.get('accounts', []) as AccountEntry[]).filter(a => a.id !== accountId)
  store.set('accounts', accounts)
  if (store.get('activeAccountId') === accountId) {
    store.set('activeAccountId', accounts[0]?.id ?? null)
  }
})

ipcMain.handle('auth:switchAccount', (_e, accountId: string) => {
  store.set('activeAccountId', accountId)
})

// ─── System IPC ───────────────────────────────────────────────────────────────
ipcMain.handle('system:sleep', () => {
  if (process.platform === 'win32') {
    // rundll32 SetSuspendState silently fails on most Win10/11 systems when
    // hibernate is disabled. The PowerShell .NET method is far more reliable.
    exec(
      'powershell.exe -NonInteractive -WindowStyle Hidden -Command ' +
      '"Add-Type -AssemblyName System.Windows.Forms; ' +
      '[System.Windows.Forms.Application]::SetSuspendState(' +
      '[System.Windows.Forms.PowerState]::Suspend, $true, $false)"'
    )
  } else if (process.platform === 'linux') {
    exec('systemctl suspend')
  } else if (process.platform === 'darwin') {
    exec('pmset sleepnow')
  }
})

ipcMain.handle('system:platform', () => process.platform)

// Open arbitrary URL in the user's default browser. Used by the channel
// banner's "Back to stable" button to send the user to the GitHub releases
// page. URL validation happens client-side — the renderer only passes
// the hardcoded STABLE_DOWNLOAD_URL constant today.
ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))

// ─── Discord IPC ──────────────────────────────────────────────────────────────
ipcMain.handle('discord:setActivity', async (_e, activity: Presence) => {
  if (!discordReady || !discordRpc) return
  try {
    await discordRpc.setActivity(activity)
  } catch {
    discordReady = false
    discordRpc = null
    setTimeout(initDiscordRPC, 30_000)
  }
})
ipcMain.handle('discord:clearActivity', async () => {
  if (!discordReady || !discordRpc) return
  try {
    await discordRpc.clearActivity()
  } catch {
    discordReady = false
    discordRpc = null
  }
})

// ─── Updater IPC ──────────────────────────────────────────────────────────────
ipcMain.handle('update:download', () => autoUpdater.downloadUpdate())
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(true, true))
ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => {}))

// ─── Channel IPC ──────────────────────────────────────────────────────────────
// CHANNEL_ID is the channel BAKED into this binary. desiredChannel is what
// the user picked via Settings. They differ only mid-transition (user clicked
// Apply, electron-updater is on its way to swapping the binary).
ipcMain.handle('channel:getBaked', () => CHANNEL_ID)
ipcMain.handle('channel:getDesired', () => {
  const desired = store.get('desiredChannel') as ValorChannel | null
  return desired ?? CHANNEL_ID
})
ipcMain.handle('channel:setDesired', async (_e, channel: ValorChannel) => {
  if (!['stable', 'seth', 'brazen'].includes(channel)) {
    return { switched: false, reason: 'invalid channel' }
  }
  store.set('desiredChannel', channel)

  // Always re-pin autoUpdater to the new desired channel, even if it's
  // the same as the binary's baked channel — the previous click might
  // have left autoUpdater.channel pointing somewhere else. allowPrerelease
  // stays false on purpose (see setupAutoUpdater comment).
  autoUpdater.channel = channel === 'stable' ? 'latest' : channel
  autoUpdater.allowDowngrade = (channel !== CHANNEL_ID)

  if (channel === CHANNEL_ID) {
    return { switched: false, reason: 'already on this channel' }
  }

  try {
    let result = await autoUpdater.checkForUpdates()
    if (!result?.updateInfo) {
      return { switched: false, reason: 'no release available on that channel yet' }
    }
    const version = result.updateInfo.version

    // Cross-channel switch quirk: when the remote version is the same as ours
    // (or only mildly lower despite allowDowngrade), electron-updater's
    // isUpdateAvailable returns false → no downloadPromise, AND in some
    // 6.x release paths the internal updateInfoAndProvider is left in a
    // state where a follow-up downloadUpdate() throws "Please check update
    // first". The cleanest workaround is to briefly tell electron-updater
    // we're at 0.0.0 so the comparison flips to "update available" and the
    // full download/install pipeline engages. Version is restored before
    // anything else can read it.
    if (!result.downloadPromise) {
      const realGetVersion = app.getVersion.bind(app) as () => string
      ;(app as { getVersion: () => string }).getVersion = () => '0.0.0'
      try {
        result = await autoUpdater.checkForUpdates() ?? result
      } finally {
        ;(app as { getVersion: () => string }).getVersion = realGetVersion
      }
    }

    mainWindow?.webContents.send('update:available', {
      version,
      releaseNotes: (result.updateInfo as { releaseNotes?: string | null }).releaseNotes ?? null,
    })
    return { switched: true, version }
  } catch (e) {
    return { switched: false, reason: (e as Error).message }
  }
})

// ─── Player window system for mpv ───────────────────────────────────────────
// Architecture:
//   playerWindow  — black, non-transparent, full-screen. mpv embeds into it via --wid.
//   overlayWindow — transparent child of playerWindow. Renders UI controls on top of video.
// This gives us: overlay UI → mpv video → black background.
// No separate floating window, no desktop bleed-through, no alwaysOnTop conflicts.

/** Get the native window handle as a decimal string for mpv --wid */
function getWindowWid(win: BrowserWindow): string {
  const buf = win.getNativeWindowHandle()
  // Windows: 4-byte LE HWND. Linux/Mac: varies but same concept.
  return buf.readUInt32LE(0).toString()
}

function createPlayerWindow(): void {
  if (playerWindow) { playerWindow.close(); playerWindow = null }
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null }

  // Open player on the same monitor as the main window
  const currentDisplay = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()
  const { x, y, width, height } = currentDisplay.bounds

  // Host window for mpv — transparent so mpv renders through via --wid.
  // The overlay provides an opaque black backdrop while buffering.
  playerWindow = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    show: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  playerWindow.maximize()

  // Transparent overlay — child of playerWindow, so it stays above mpv
  // but doesn't block other apps (no alwaysOnTop needed)
  overlayWindow = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    parent: playerWindow,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  overlayWindow.maximize()

  // Click-through: transparent areas pass events to mpv (inside playerWindow)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  // Sync both windows when moved (Win+Shift+Arrow, drag, etc.)
  // The overlay and playerWindow are separate native windows — when one moves
  // we need to manually move the other to match.
  let syncingWindows = false
  function syncWindows(movedWindow: BrowserWindow, otherWindow: BrowserWindow | null) {
    if (syncingWindows || !otherWindow || otherWindow.isDestroyed()) return
    const movedBounds = movedWindow.getBounds()
    const otherBounds = otherWindow.getBounds()
    // Only sync if bounds actually differ (avoid feedback loop)
    if (movedBounds.x === otherBounds.x && movedBounds.y === otherBounds.y &&
        movedBounds.width === otherBounds.width && movedBounds.height === otherBounds.height) {
      return
    }
    syncingWindows = true
    try {
      // Move other window to the new display, then maximize
      const targetDisplay = screen.getDisplayMatching(movedBounds)
      otherWindow.setBounds({
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
      })
      otherWindow.maximize()
      // Also re-maximize the moved window in case Win+Shift+Arrow left it un-maximized
      const movedDisplay = screen.getDisplayMatching(movedWindow.getBounds())
      if (movedDisplay.id === targetDisplay.id) movedWindow.maximize()
    } finally {
      // Defer the flag reset so the setBounds call's own move event is ignored
      setTimeout(() => { syncingWindows = false }, 50)
    }
  }
  playerWindow.on('move', () => syncWindows(playerWindow!, overlayWindow))
  overlayWindow.on('move', () => syncWindows(overlayWindow!, playerWindow))
  // Also listen for resize (Win+Up to maximize, snap layouts, etc.)
  playerWindow.on('resize', () => syncWindows(playerWindow!, overlayWindow))
  overlayWindow.on('resize', () => syncWindows(overlayWindow!, playerWindow))

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    overlayWindow.loadURL(`${rendererUrl}#/player-overlay`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/player-overlay' })
  }

  // Ctrl+Shift+I toggles DevTools in overlay too
  overlayWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      overlayWindow?.webContents.toggleDevTools()
    }
  })

  overlayWindow.on('closed', () => { overlayWindow = null })
  playerWindow.on('closed', () => {
    playerWindow = null
    // If player window is closed (e.g. Alt+F4), clean up mpv
    if (mpvInstance) { mpvInstance.quit(); mpvInstance = null; mpvPayload = null }
    if (overlayWindow && !overlayWindow.isDestroyed()) { overlayWindow.close() }
    overlayWindow = null
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
  })
}

function closePlayerWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close()
    overlayWindow = null
  }
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.close()
    playerWindow = null
  }
  // Restore main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
}

// ─── mpv Player IPC ──────────────────────────────────────────────────────────
ipcMain.handle('mpv:available', () => isMpvAvailable())
ipcMain.handle('mpv:get-payload', () => mpvPayload)

// Overlay mouse events: renderer tells us when cursor is over interactive controls
ipcMain.handle('overlay:set-ignore-mouse', (_e, ignore: boolean) => {
  if (!overlayWindow) return
  if (ignore) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  } else {
    overlayWindow.setIgnoreMouseEvents(false)
  }
})

// Serialise mpv:launch so a second invocation that arrives while the first
// is still spinning up can't race the named pipe. Without this, two rapid
// launches both spawn mpv processes; the second fails with exit code 2
// because the first hasn't released \\.\pipe\valor-mpv-ipc yet.
let launchInFlight: Promise<void> | null = null
ipcMain.handle('mpv:launch', async (_e, payload: unknown) => {
  if (launchInFlight) {
    console.warn('[mpv:launch] already launching — ignoring duplicate call')
    return launchInFlight
  }
  launchInFlight = (async () => {
    // Quit any existing instance and WAIT for the process to fully exit so
    // the named pipe is free before we spawn the new mpv.
    if (mpvInstance) {
      console.log('[mpv:launch] killing previous instance before relaunch')
      await mpvInstance.quit().catch(() => {})
      mpvInstance = null
    }
    mpvPayload = payload

  const p = payload as { job: { directStreamUrl?: string; hlsUrl: string; mpvOptions?: Record<string, string> }; startPositionTicks: number; title: string }
  const url = p.job.directStreamUrl || p.job.hlsUrl
  console.log('[mpv:launch] url:', url?.slice(0, 120), '| startTicks:', p.startPositionTicks)

  // Convert backend mpvOptions (e.g. { cache: 'yes', 'cache-secs': '30' }) to CLI flags
  const extraArgs: string[] = []
  if (p.job.mpvOptions) {
    for (const [key, val] of Object.entries(p.job.mpvOptions)) {
      extraArgs.push(`--${key}=${val}`)
    }
    console.log('[mpv:launch] extra args:', extraArgs.join(' '))
  }

  if (!url) {
    console.error('[mpv:launch] No URL found in payload — aborting')
    return
  }

  mpvInstance = new MpvPlayer()

  // Helper to send to both main window and overlay
  const broadcast = (channel: string, ...args: unknown[]) => {
    mainWindow?.webContents.send(channel, ...args)
    overlayWindow?.webContents.send(channel, ...args)
  }

  mpvInstance.on({
    timeupdate: (time) => broadcast('mpv:time', time),
    duration:   (dur)  => broadcast('mpv:duration', dur),
    paused:     (v)    => broadcast('mpv:paused', v),
    ended:      ()     => {
      broadcast('mpv:ended')
      mpvInstance = null
      mpvPayload = null
      closePlayerWindow()
    },
    error:      (err)  => broadcast('mpv:error', err),
    ready:      ()     => {
      broadcast('mpv:ready')
    },
  })

  // Hide main window so player + overlay are the only visible windows
  mainWindow?.hide()

  // Create player host + overlay before launching mpv
  createPlayerWindow()

    try {
      const wid = playerWindow ? getWindowWid(playerWindow) : undefined
      console.log('[mpv:launch] Embedding into HWND:', wid)
      await mpvInstance!.launch(url, {
        startSecs: p.startPositionTicks > 0 ? p.startPositionTicks / 10_000_000 : undefined,
        title: p.title,
        wid,
        extraArgs,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[mpv:launch] Failed:', msg)
      broadcast('mpv:error', `mpv failed to start: ${msg}`)
      mpvInstance = null
      mpvPayload = null
      closePlayerWindow()
    }
  })()
  try { await launchInFlight } finally { launchInFlight = null }
})

ipcMain.handle('mpv:toggle-pause',  ()         => mpvInstance?.togglePause())
ipcMain.handle('mpv:pause',         ()         => mpvInstance?.pause())
ipcMain.handle('mpv:resume',        ()         => mpvInstance?.resume())
ipcMain.handle('mpv:seek',          (_e, secs: number) => mpvInstance?.seek(secs))
ipcMain.handle('mpv:seek-absolute', (_e, secs: number) => mpvInstance?.seekAbsolute(secs))
ipcMain.handle('mpv:volume',        (_e, vol: number)  => mpvInstance?.setVolume(vol))
ipcMain.handle('mpv:load-file',     (_e, url: string)  => mpvInstance?.loadFile(url))
ipcMain.handle('mpv:set-aid',       (_e, aid: number)  => mpvInstance?.setAid(aid))
ipcMain.handle('mpv:set-sid',       (_e, sid: number)  => mpvInstance?.setSid(sid))
ipcMain.handle('mpv:set-speed',    (_e, speed: number) => mpvInstance?.setSpeed(speed))
ipcMain.handle('mpv:set-sub-delay', (_e, secs: number) => mpvInstance?.setSubDelay(secs))
ipcMain.handle('mpv:sub-add',      (_e, path: string) => mpvInstance?.subAdd(path))
ipcMain.handle('mpv:quit',          ()         => { mpvInstance?.quit(); mpvInstance = null; mpvPayload = null; closePlayerWindow() })
ipcMain.handle('mpv:fullscreen',   ()         => {
  if (playerWindow) {
    playerWindow.setFullScreen(!playerWindow.isFullScreen())
  }
})

// Bypass Chromium's autoplay policy so audio plays without requiring an active
// user gesture at the exact moment video.play() is called. Without this,
// Chromium silently mutes audio when video.play() fires asynchronously (e.g.
// inside HLS.js's MANIFEST_PARSED callback after an API round-trip).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Force sRGB color profile so video colors match browser playback.
// Without this, Chromium may use the OS/monitor color profile for video decode,
// producing washed-out or oversaturated colors compared to Chrome/Firefox.
app.commandLine.appendSwitch('force-color-profile', 'srgb')

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  initDiscordRPC()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  if (mpvInstance) { mpvInstance.quit(); mpvInstance = null }
  closePlayerWindow()
  if (discordRpc && discordReady) {
    discordRpc.clearActivity().catch(() => {})
    discordRpc.destroy().catch(() => {})
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
