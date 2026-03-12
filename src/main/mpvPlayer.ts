import { spawn, ChildProcess } from 'child_process'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import net from 'net'

// ─── Path resolution ──────────────────────────────────────────────────────────

function getMpvPath(): string {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv'
  if (app.isPackaged) {
    return join(process.resourcesPath, 'mpv', exe)
  }
  // Dev: check project-local resources/mpv/ first
  const devPath = resolve(process.cwd(), 'resources', 'mpv', exe)
  if (existsSync(devPath)) return devPath
  // Fallback: expect mpv to be on PATH
  return exe
}

function getIpcPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\valor-mpv-ipc'
  }
  return '/tmp/valor-mpv-ipc.sock'
}

export function isMpvAvailable(): boolean {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv'
  if (app.isPackaged) {
    return existsSync(join(process.resourcesPath, 'mpv', exe))
  }
  const devPath = resolve(process.cwd(), 'resources', 'mpv', exe)
  return existsSync(devPath)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MpvLaunchOptions {
  startSecs?: number
  title?: string
  /** Native window handle (HWND on Windows, XID on X11) to embed mpv into */
  wid?: string
}

type MpvEventHandlers = {
  timeupdate?: (time: number) => void
  duration?: (duration: number) => void
  paused?: (paused: boolean) => void
  ended?: () => void
  error?: (err: string) => void
  ready?: () => void
}

// ─── MpvPlayer ────────────────────────────────────────────────────────────────

export class MpvPlayer {
  private proc: ChildProcess | null = null
  private ipcClient: net.Socket | null = null
  private requestId = 1
  private pendingRequests = new Map<number, (data: unknown) => void>()
  private handlers: MpvEventHandlers = {}
  private recvBuf = ''
  private readonly ipcPath: string
  private ipcConnected = false
  private quitting = false

  constructor() {
    this.ipcPath = getIpcPath()
  }

  on(handlers: MpvEventHandlers): this {
    this.handlers = { ...this.handlers, ...handlers }
    return this
  }

  async launch(url: string, opts: MpvLaunchOptions = {}): Promise<void> {
    const mpvPath = getMpvPath()

    const ipcFlag =
      process.platform === 'win32'
        ? `--input-ipc-server=${this.ipcPath}`
        : `--input-unix-socket=${this.ipcPath}`

    const args: string[] = [
      url,
      '--no-terminal',
      '--keepaspect=yes',
      '--hwdec=auto',
      // Disable built-in OSC — VALOR's overlay provides controls
      '--no-osc',
      '--osd-font-size=32',
      ipcFlag,
    ]

    if (opts.wid) {
      // Embed mpv into the target window — no separate mpv window
      args.push(`--wid=${opts.wid}`)
      // Prevent mpv from capturing keyboard/mouse — Electron handles all input
      args.push('--no-input-default-bindings', '--input-vo-keyboard=no', '--cursor-autohide=no')
    } else {
      // Standalone mpv window (fallback)
      args.push('--force-window=yes', '--window-maximized=yes')
    }

    if (opts.title) args.push(`--title=${opts.title}`)
    if (opts.startSecs && opts.startSecs > 0) args.push(`--start=${opts.startSecs}`)

    this.proc = spawn(mpvPath, args, { detached: false, stdio: ['ignore', 'pipe', 'pipe'] })

    // Forward mpv stderr to Electron console for debugging crashes
    this.proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line) console.error('[mpv]', line)
    })

    this.proc.on('error', (err) => {
      this.handlers.error?.(`mpv failed to start: ${err.message}`)
    })

    this.proc.on('exit', (code, signal) => {
      this.ipcClient?.destroy()
      this.ipcClient = null
      // Fire 'ended' whenever mpv exits after IPC was established.
      // This covers: user closing the mpv window, normal EOF, quit command.
      // The quit() method sets this.quitting to suppress the event when WE initiated the close.
      if (this.ipcConnected && !this.quitting) {
        this.handlers.ended?.()
      }
      if (code !== 0 && code !== null && signal == null && this.ipcConnected && !this.quitting) {
        this.handlers.error?.(`mpv exited unexpectedly (code ${code})`)
      }
    })

    await this.waitForIpc()
    this.observeProperties()
    this.handlers.ready?.()
  }

  // ─── IPC connection ─────────────────────────────────────────────────────────

  private async waitForIpc(maxAttempts = 60): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(200)
      // Bail early if process already died — no point waiting the full timeout
      if (this.proc?.exitCode != null) {
        throw new Error(`mpv exited before IPC connected (code ${this.proc.exitCode})`)
      }
      try {
        await this.tryConnect()
        return
      } catch {
        // retry
      }
    }
    throw new Error('Could not connect to mpv IPC socket after 12 seconds')
  }

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.ipcPath)
      sock.once('connect', () => {
        this.ipcClient = sock
        this.ipcConnected = true
        this.recvBuf = ''
        sock.on('data', (d) => this.onData(d.toString()))
        sock.on('close', () => { this.ipcClient = null })
        resolve()
      })
      sock.once('error', reject)
    })
  }

  private onData(chunk: string) {
    this.recvBuf += chunk
    const lines = this.recvBuf.split('\n')
    this.recvBuf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { this.handleMessage(JSON.parse(line)) } catch { /* ignore */ }
    }
  }

  private handleMessage(msg: Record<string, unknown>) {
    // Command response
    if (typeof msg.request_id === 'number') {
      const cb = this.pendingRequests.get(msg.request_id)
      if (cb) {
        cb(msg.data)
        this.pendingRequests.delete(msg.request_id)
      }
      return
    }
    // Property change event
    if (msg.event === 'property-change') {
      const { name, data } = msg
      if (name === 'time-pos' && typeof data === 'number') {
        this.handlers.timeupdate?.(data)
      } else if (name === 'duration' && typeof data === 'number') {
        this.handlers.duration?.(data)
      } else if (name === 'pause' && typeof data === 'boolean') {
        this.handlers.paused?.(data)
      } else if (name === 'eof-reached' && data === true) {
        this.handlers.ended?.()
      }
    }
  }

  private observeProperties() {
    this.send(['observe_property', 1, 'time-pos'])
    this.send(['observe_property', 2, 'duration'])
    this.send(['observe_property', 3, 'pause'])
    this.send(['observe_property', 4, 'eof-reached'])
  }

  // ─── Command helpers ─────────────────────────────────────────────────────────

  send(cmd: unknown[]): Promise<unknown> {
    return new Promise((resolve) => {
      if (!this.ipcClient) { resolve(null); return }
      const id = this.requestId++
      this.pendingRequests.set(id, resolve)
      this.ipcClient.write(JSON.stringify({ command: cmd, request_id: id }) + '\n')
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          resolve(null)
        }
      }, 2000)
    })
  }

  togglePause()                { return this.send(['cycle', 'pause']) }
  pause()                      { return this.send(['set_property', 'pause', true]) }
  resume()                     { return this.send(['set_property', 'pause', false]) }
  seek(secs: number)           { return this.send(['seek', secs, 'relative']) }
  seekAbsolute(secs: number)   { return this.send(['seek', secs, 'absolute']) }
  setVolume(pct: number)       { return this.send(['set_property', 'volume', Math.round(pct)]) }
  loadFile(url: string)        { return this.send(['loadfile', url]) }
  /** Switch audio track by mpv's 1-based aid (0 = no audio) */
  setAid(aid: number)          { return this.send(['set_property', 'aid', aid]) }
  /** Switch subtitle track by mpv's 1-based sid (0 = no subtitle) */
  setSid(sid: number)          { return this.send(['set_property', 'sid', sid]) }
  /** Set playback speed (1.0 = normal) */
  setSpeed(speed: number)      { return this.send(['set_property', 'speed', speed]) }
  /** Load an external subtitle file */
  subAdd(path: string)         { return this.send(['sub-add', path]) }

  quit() {
    this.quitting = true
    this.send(['quit']).catch(() => {})
    setTimeout(() => {
      if (this.proc && !this.proc.killed) this.proc.kill()
    }, 600)
    this.ipcClient?.destroy()
    this.ipcClient = null
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
