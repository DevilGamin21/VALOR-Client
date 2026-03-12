import { app, BrowserWindow, ipcMain, session, shell, nativeImage } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import type { Client as DiscordRpcClient, Presence } from 'discord-rpc'
import { MpvPlayer, isMpvAvailable } from './mpvPlayer'

const store = new Store<{ token: string }>()
const API_ORIGIN = 'https://valor.dawn-star.co.uk'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
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

// ─── Auth token IPC ───────────────────────────────────────────────────────────
ipcMain.handle('auth:getToken', () => store.get('token', null))
ipcMain.handle('auth:setToken', (_e, token: string) => store.set('token', token))
ipcMain.handle('auth:clearToken', () => store.delete('token'))

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

// ─── Overlay window for mpv ──────────────────────────────────────────────────

function getMainWindowWid(): string | undefined {
  if (!mainWindow) return undefined
  const buf = mainWindow.getNativeWindowHandle()
  // Windows: HWND is pointer-sized (4 or 8 bytes). Linux X11: XID is 4 bytes.
  if (process.platform === 'win32') {
    const hwnd = buf.length >= 8 ? Number(buf.readBigUInt64LE()) : buf.readUInt32LE()
    return String(hwnd)
  }
  // Linux X11
  return String(buf.readUInt32LE())
}

function createOverlayWindow(): void {
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null }

  overlayWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    // Owned by main window — moves with it, no extra taskbar entry
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  overlayWindow.maximize()

  // Click-through: transparent areas pass events to mpv window behind
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
}

function closeOverlayWindow(): void {
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }
  // Restore focus to the main window so gamepad input resumes
  if (mainWindow && !mainWindow.isDestroyed()) {
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
      closeOverlayWindow()
    },
    error:      (err)  => broadcast('mpv:error', err),
    ready:      ()     => broadcast('mpv:ready'),
  })

  // Create overlay window before launching mpv so it's ready when mpv opens
  createOverlayWindow()

  // Get main window HWND to embed mpv directly into it (no separate mpv window)
  const wid = getMainWindowWid()
  console.log('[mpv:launch] wid:', wid ?? '(standalone)')

  try {
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
    closeOverlayWindow()
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
ipcMain.handle('mpv:quit',          ()         => { mpvInstance?.quit(); mpvInstance = null; mpvPayload = null; closeOverlayWindow() })

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
  closeOverlayWindow()
  if (discordRpc && discordReady) {
    discordRpc.clearActivity().catch(() => {})
    discordRpc.destroy().catch(() => {})
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
