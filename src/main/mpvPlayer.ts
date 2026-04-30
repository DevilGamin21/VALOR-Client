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
  /** Window handle to embed mpv into (--wid). If omitted, mpv opens its own window. */
  wid?: string
  /** Extra CLI flags from the backend (e.g. cache/buffer settings for direct play) */
  extraArgs?: string[]
}

type MpvEventHandlers = {
  timeupdate?: (time: number) => void
  duration?: (duration: number) => void
  paused?: (paused: boolean) => void
  ended?: () => void
  error?: (err: string) => void
  ready?: () => void
  /** Fires when mpv window gains/loses OS focus (for overlay z-order management) */
  focused?: (hasFocus: boolean) => void
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
      // Force verbose-info logging to stderr so we can diagnose silent exits.
      // Without this some shinchiro builds emit nothing on certain failure
      // modes (e.g. d3d11 init failure) and the renderer has no clue why mpv
      // closed.
      '--msg-level=all=info',
      '--keepaspect=yes',
      // Force D3D11 hardware decode on Windows — 'auto' can silently fall back to CPU
      ...(process.platform === 'win32'
        ? ['--hwdec=d3d11va']
        : ['--hwdec=auto']),
      // Smooth frame timing: resample to display refresh + interpolate between frames
      '--video-sync=display-resample',
      '--interpolation',
      // Disable built-in OSC — VALOR's overlay provides controls
      '--no-osc',
      '--osd-font-size=32',
      ipcFlag,
    ]

    if (opts.wid) {
      // Embed mpv as a child window inside the given HWND.
      // Use gpu/d3d11 with libplacebo HDR pipeline so Dolby Vision profiles,
      // HDR10, and 10-bit content render with correct colours instead of the
      // green/purple tint you get from --vo=direct3d (D3D9). If this turns out
      // to crash on a given GPU, the v0.2.95 stderr instrumentation surfaces
      // the actual mpv error to DevTools so we can diagnose rather than
      // assuming d3d11 is the culprit.
      args.push(
        `--wid=${opts.wid}`,
        '--vo=gpu',
        '--gpu-context=d3d11',
        '--target-colorspace-hint',
        '--tone-mapping=auto',
        '--hdr-compute-peak=auto',
      )
    } else {
      // Standalone borderless fullscreen window — overlay sits on top with controls
      args.push('--force-window=yes', '--window-maximized=yes', '--no-border')
    }
    // Prevent mpv from capturing keyboard — Electron overlay handles all input
    args.push('--no-input-default-bindings', '--input-vo-keyboard=no')

    if (opts.title) args.push(`--title=${opts.title}`)
    if (opts.startSecs && opts.startSecs > 0) args.push(`--start=${opts.startSecs}`)
    if (opts.extraArgs?.length) args.push(...opts.extraArgs)

    this.proc = spawn(mpvPath, args, { detached: false, stdio: ['ignore', 'pipe', 'pipe'] })

    // Buffer mpv stderr so we can include the last few lines in the error
    // event when mpv exits unexpectedly — production builds have no terminal
    // for console.error, so without this the user sees the overlay close
    // and has nothing in DevTools to diagnose with.
    const stderrBuf: string[] = []
    this.proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (!line) return
      console.error('[mpv]', line)
      stderrBuf.push(line)
      // Cap retention so a chatty mpv doesn't balloon memory
      if (stderrBuf.length > 200) stderrBuf.splice(0, stderrBuf.length - 200)
    })

    this.proc.on('error', (err) => {
      this.handlers.error?.(`mpv failed to start: ${err.message}`)
    })

    this.proc.on('exit', (code, signal) => {
      this.ipcClient?.destroy()
      this.ipcClient = null
      // Last 30 stderr lines — usually contains the codec/render error that
      // killed mpv. Forwarded with the ended/error events so DevTools shows it.
      const tail = stderrBuf.slice(-30).join('\n')
      const why = this.quitting
        ? 'quit-requested'
        : this.ipcConnected
          ? 'crashed-after-ipc'
          : 'died-pre-ipc'
      console.log('[mpv] exit code=', code, 'signal=', signal, 'why=', why)
      if (tail) console.log('[mpv] stderr tail:\n' + tail)

      // Always surface the exit to the renderer, even with no stderr — without
      // this, silent exits (clean code-0 exit with no log output) leave the
      // user staring at a closed overlay with no diagnostic at all.
      this.handlers.error?.(
        `mpv exit (${why}, code=${code}, signal=${signal})` +
        (tail ? '. stderr:\n' + tail : ' — no stderr captured'),
      )

      if (this.ipcConnected && !this.quitting) {
        this.handlers.ended?.()
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
      } else if (name === 'focused' && typeof data === 'boolean') {
        this.handlers.focused?.(data)
      }
    }
  }

  private observeProperties() {
    this.send(['observe_property', 1, 'time-pos'])
    this.send(['observe_property', 2, 'duration'])
    this.send(['observe_property', 3, 'pause'])
    this.send(['observe_property', 4, 'eof-reached'])
    this.send(['observe_property', 5, 'focused'])
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
  /** Set subtitle delay in seconds (positive = later, negative = earlier) */
  setSubDelay(secs: number)    { return this.send(['set_property', 'sub-delay', secs]) }
  /** Load an external subtitle file */
  subAdd(path: string)         { return this.send(['sub-add', path]) }

  /** Resolves when the mpv process has fully exited and the named pipe is
   *  released. Important: relaunching mpv before the previous instance has
   *  exited fails with code 2 (pipe \\.\pipe\valor-mpv-ipc still bound). */
  quit(): Promise<void> {
    this.quitting = true
    return new Promise<void>((resolve) => {
      const proc = this.proc
      if (!proc || proc.exitCode != null || proc.killed) {
        this.ipcClient?.destroy()
        this.ipcClient = null
        resolve()
        return
      }
      proc.once('exit', () => resolve())
      this.send(['quit']).catch(() => {})
      // Hard-kill if mpv hasn't exited gracefully in 600ms
      setTimeout(() => {
        if (proc && !proc.killed && proc.exitCode == null) proc.kill()
      }, 600)
      this.ipcClient?.destroy()
      this.ipcClient = null
    })
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
