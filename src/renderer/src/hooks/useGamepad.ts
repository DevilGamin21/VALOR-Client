import { useEffect, useRef, useState } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GamepadButtonAction {
  /** Fired once on rising edge (button just pressed). */
  onPress?: () => void
  /** Fired repeatedly while held. If omitted, button is single-fire only. */
  onRepeat?: () => void
  /** Ms before repeat starts (default 400). */
  repeatDelay?: number
  /** Ms between repeats once started (default 150). */
  repeatInterval?: number
}

export interface GamepadAxisAction {
  /** Axis index (standard: 0=LX, 1=LY, 2=RX, 3=RY). */
  axis: number
  /** 'positive' = right/down, 'negative' = left/up. */
  direction: 'positive' | 'negative'
  /** Threshold to trigger (default 0.5). */
  threshold?: number
  onPress?: () => void
  onRepeat?: () => void
  repeatDelay?: number
  repeatInterval?: number
}

export interface UseGamepadOptions {
  /** Map of standard button index → action. */
  buttons?: Record<number, GamepadButtonAction>
  /** Axis-based actions. */
  axes?: GamepadAxisAction[]
  /** Called on any button press or axis threshold crossing. */
  onAnyInput?: () => void
  /** Disable polling without unmounting (default true). */
  enabled?: boolean
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useGamepad(options: UseGamepadOptions): { connected: boolean } {
  const [connected, setConnected] = useState(false)

  // Always-fresh options ref — avoids stale closures in the rAF loop.
  const optRef = useRef(options)
  optRef.current = options

  const rafRef = useRef(0)
  const prevBtnsRef = useRef<boolean[]>([])
  const prevAxesRef = useRef<boolean[]>([])
  const repeatRef = useRef<Map<string, { d: ReturnType<typeof setTimeout> | null; i: ReturnType<typeof setInterval> | null }>>(new Map())

  // ── Repeat helpers ──────────────────────────────────────────────────────

  function startRepeat(key: string, action: Pick<GamepadButtonAction, 'onRepeat' | 'repeatDelay' | 'repeatInterval'>) {
    stopRepeat(key)
    const delay = action.repeatDelay ?? 400
    const interval = action.repeatInterval ?? 150
    const d = setTimeout(() => {
      action.onRepeat?.()
      const i = setInterval(() => action.onRepeat?.(), interval)
      const entry = repeatRef.current.get(key)
      if (entry) { entry.d = null; entry.i = i }
    }, delay)
    repeatRef.current.set(key, { d, i: null })
  }

  function stopRepeat(key: string) {
    const entry = repeatRef.current.get(key)
    if (!entry) return
    if (entry.d) clearTimeout(entry.d)
    if (entry.i) clearInterval(entry.i)
    repeatRef.current.delete(key)
  }

  function clearAllRepeats() {
    repeatRef.current.forEach((_, key) => stopRepeat(key))
  }

  // ── Polling loop ────────────────────────────────────────────────────────

  function poll() {
    const opts = optRef.current
    if (opts.enabled === false) {
      clearAllRepeats()
      prevBtnsRef.current = []
      prevAxesRef.current = []
      rafRef.current = requestAnimationFrame(poll)
      return
    }

    const gp = navigator.getGamepads()[0]
    if (!gp) { rafRef.current = requestAnimationFrame(poll); return }

    let anyInput = false
    const btns = opts.buttons ?? {}

    // Buttons
    for (const idxStr of Object.keys(btns)) {
      const idx = Number(idxStr)
      const action = btns[idx]
      const pressed = gp.buttons[idx]?.pressed ?? false
      const was = prevBtnsRef.current[idx] ?? false

      if (pressed && !was) {
        anyInput = true
        action.onPress?.()
        if (action.onRepeat) startRepeat(`b${idx}`, action)
      } else if (!pressed && was) {
        stopRepeat(`b${idx}`)
      }
      prevBtnsRef.current[idx] = pressed
    }

    // Axes
    const axesCfg = opts.axes ?? []
    for (let i = 0; i < axesCfg.length; i++) {
      const a = axesCfg[i]
      const val = gp.axes[a.axis] ?? 0
      const thresh = a.threshold ?? 0.5
      const active = a.direction === 'positive' ? val > thresh : val < -thresh
      const was = prevAxesRef.current[i] ?? false

      if (active && !was) {
        anyInput = true
        a.onPress?.()
        if (a.onRepeat) startRepeat(`a${i}`, a)
      } else if (!active && was) {
        stopRepeat(`a${i}`)
      }
      prevAxesRef.current[i] = active
    }

    if (anyInput) opts.onAnyInput?.()

    rafRef.current = requestAnimationFrame(poll)
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  useEffect(() => {
    let polling = false

    function startPolling() {
      if (polling) return
      polling = true
      prevBtnsRef.current = []
      prevAxesRef.current = []
      rafRef.current = requestAnimationFrame(poll)
    }

    function stopPolling() {
      if (!polling) return
      polling = false
      cancelAnimationFrame(rafRef.current)
      clearAllRepeats()
    }

    function onConnect() {
      setConnected(true)
      startPolling()
    }

    function onDisconnect() {
      setConnected(false)
      stopPolling()
    }

    window.addEventListener('gamepadconnected', onConnect)
    window.addEventListener('gamepaddisconnected', onDisconnect)

    // If a gamepad is already connected when the hook mounts, start immediately.
    if (navigator.getGamepads()[0]) onConnect()

    return () => {
      window.removeEventListener('gamepadconnected', onConnect)
      window.removeEventListener('gamepaddisconnected', onDisconnect)
      stopPolling()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { connected }
}
