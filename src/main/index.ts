import { app, BrowserWindow, ipcMain, session, shell, nativeImage } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import type { Client as DiscordRpcClient, Presence } from 'discord-rpc'

const store = new Store<{ token: string }>()
const API_ORIGIN = 'https://valor.dawn-star.co.uk'

let mainWindow: BrowserWindow | null = null

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
autoUpdater.autoDownload = true            // download in background automatically
autoUpdater.autoInstallOnAppQuit = true   // install when app quits after download
autoUpdater.logger = null                 // suppress default console output
autoUpdater.allowElevation = false        // never use elevate.exe — prevents UAC prompts

function setupAutoUpdater(): void {
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
      backgroundThrottling: false   // Keep gamepad polling active when window loses focus
    }
  })

  // ── Gamepad: keep page "visible" when unfocused ─────────────────────────
  // Chromium's Gamepad API checks Page::IsPageVisible() at the C++ level.
  // Use CDP to emulate focus + override JS visibility so gamepads stay active.
  try { mainWindow.webContents.debugger.attach('1.3') } catch { /* ok */ }
  mainWindow.on('blur', () => {
    try {
      mainWindow?.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    } catch { /* ignore */ }
  })
  mainWindow.on('focus', () => {
    try {
      mainWindow?.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false })
    } catch { /* ignore */ }
  })
  // JS-level visibility override as fallback
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript(`
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
    `)
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

// Bypass Chromium's autoplay policy so audio plays without requiring an active
// user gesture at the exact moment video.play() is called. Without this,
// Chromium silently mutes audio when video.play() fires asynchronously (e.g.
// inside HLS.js's MANIFEST_PARSED callback after an API round-trip).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Keep renderer alive and gamepad-accessible even when window loses OS focus.
// These prevent Chromium from throttling/suspending the renderer process and
// ensure navigator.getGamepads() continues returning data in the background.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  initDiscordRPC()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  if (discordRpc && discordReady) {
    discordRpc.clearActivity().catch(() => {})
    discordRpc.destroy().catch(() => {})
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
