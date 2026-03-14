import { app, BrowserWindow, ipcMain, session, shell, nativeImage } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import type { Client as DiscordRpcClient, Presence } from 'discord-rpc'
import { MpvPlayer, isMpvAvailable } from './mpvPlayer'

interface AccountEntry {
  id: string
  username: string
  token: string
  avatarUrl: string | null
}
interface StoreSchema {
  token: string                       // legacy single-token (migrated on first use)
  accounts: AccountEntry[]
  activeAccountId: string | null
}
const store = new Store<StoreSchema>({ defaults: { token: '', accounts: [], activeAccountId: null } })
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
function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.allowElevation = false

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

  // Host window for mpv — opaque black so the user sees a black screen instantly
  // while mpv loads. mpv renders as a native child window (via --wid) on top.
  playerWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    show: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  playerWindow.maximize()

  // Transparent overlay — child of playerWindow, so it stays above mpv
  // but doesn't block other apps (no alwaysOnTop needed)
  overlayWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    transparent: true,
    frame: false,
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

ipcMain.handle('mpv:launch', async (_e, payload: unknown) => {
  // Quit any existing instance
  if (mpvInstance) { mpvInstance.quit(); mpvInstance = null }
  mpvPayload = payload

  const p = payload as { job: { directStreamUrl?: string; hlsUrl: string }; startPositionTicks: number; title: string }
  const url = p.job.directStreamUrl || p.job.hlsUrl
  console.log('[mpv:launch] url:', url?.slice(0, 120), '| startTicks:', p.startPositionTicks)

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
    await mpvInstance.launch(url, {
      startSecs: p.startPositionTicks > 0 ? p.startPositionTicks / 10_000_000 : undefined,
      title: p.title,
      wid,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mpv:launch] Failed:', msg)
    broadcast('mpv:error', `mpv failed to start: ${msg}`)
    mpvInstance = null
    mpvPayload = null
    closePlayerWindow()
  }
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
