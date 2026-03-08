import { createContext, useContext, useEffect, useRef, useCallback, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGamepad } from '@/hooks/useGamepad'
import { usePlayer } from '@/contexts/PlayerContext'

// ─── Types ───────────────────────────────────────────────────────────────────

type Direction = 'up' | 'down' | 'left' | 'right'

interface GamepadNavState {
  connected: boolean
}

const GamepadNavContext = createContext<GamepadNavState | null>(null)

// ─── Spatial helpers ─────────────────────────────────────────────────────────

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
}

function findNearest(from: DOMRect | null, direction: Direction, candidates: Element[]): Element | null {
  const fc = from ? center(from) : { x: 0, y: 0 }
  let best: Element | null = null
  let bestScore = Infinity

  for (const el of candidates) {
    const r = el.getBoundingClientRect()
    const tc = center(r)

    switch (direction) {
      case 'up':    if (tc.y >= fc.y - 1) continue; break
      case 'down':  if (tc.y <= fc.y + 1) continue; break
      case 'left':  if (tc.x >= fc.x - 1) continue; break
      case 'right': if (tc.x <= fc.x + 1) continue; break
    }

    let mainDist: number, crossDist: number
    if (direction === 'up' || direction === 'down') {
      mainDist = Math.abs(tc.y - fc.y)
      crossDist = Math.abs(tc.x - fc.x)
    } else {
      mainDist = Math.abs(tc.x - fc.x)
      crossDist = Math.abs(tc.y - fc.y)
    }

    const score = mainDist + crossDist * 3
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }

  return best
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function GamepadNavProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { isOpen } = usePlayer()
  const focusedRef = useRef<Element | null>(null)

  // ── Focus management ───────────────────────────────────────────────────

  const setFocus = useCallback((el: Element | null) => {
    if (focusedRef.current) {
      focusedRef.current.classList.remove('gp-focused')
    }
    focusedRef.current = el
    if (el) {
      el.classList.add('gp-focused')
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }, [])

  const clearFocus = useCallback(() => {
    if (focusedRef.current) {
      focusedRef.current.classList.remove('gp-focused')
      focusedRef.current = null
    }
  }, [])

  // ── Mouse clears gamepad focus ─────────────────────────────────────────

  useEffect(() => {
    function onMouseMove() {
      clearFocus()
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [clearFocus])

  // ── Ensure focused element is still valid ──────────────────────────────

  function ensureFocus(): Element | null {
    if (focusedRef.current) {
      if (document.body.contains(focusedRef.current) && isVisible(focusedRef.current)) {
        return focusedRef.current
      }
      clearFocus()
    }
    return null
  }

  // ── Get focusable candidates — scoped to topmost modal if one is open ──

  function getCandidates(): Element[] {
    // If a modal (z-50 fixed overlay) is open, restrict navigation to its contents
    const modals = document.querySelectorAll('[data-modal-close]')
    if (modals.length > 0) {
      // Find the modal container — walk up from the close button to the fixed overlay
      const closeBtn = modals[modals.length - 1]
      let modalRoot: Element | null = closeBtn
      while (modalRoot && modalRoot !== document.body) {
        const style = window.getComputedStyle(modalRoot)
        if (style.position === 'fixed' && modalRoot.classList.contains('z-50')) break
        modalRoot = modalRoot.parentElement
      }
      if (modalRoot && modalRoot !== document.body) {
        return Array.from(modalRoot.querySelectorAll('[data-focusable]')).filter(isVisible)
      }
    }
    // No modal — all visible focusable elements
    return Array.from(document.querySelectorAll('[data-focusable]')).filter(isVisible)
  }

  // ── Scroll the main content area ──────────────────────────────────────

  function scrollMainContent(direction: 'up' | 'down') {
    const main = document.querySelector('main')
    if (!main) return
    const amount = direction === 'down' ? 300 : -300
    main.scrollBy({ top: amount, behavior: 'smooth' })
  }

  // ── Move focus ─────────────────────────────────────────────────────────

  const move = useCallback((direction: Direction) => {
    const current = ensureFocus()
    const candidates = getCandidates().filter((el) => el !== current)

    if (candidates.length === 0) return

    if (!current) {
      setFocus(candidates[0])
      return
    }

    const from = current.getBoundingClientRect()
    const next = findNearest(from, direction, candidates)

    if (next) {
      setFocus(next)
    } else if (direction === 'down') {
      // No focusable element below — scroll the page down
      scrollMainContent('down')
    } else if (direction === 'up') {
      scrollMainContent('up')
    }
  }, [setFocus])

  // ── A button → activate ────────────────────────────────────────────────

  const activate = useCallback(() => {
    const current = ensureFocus()
    if (current && current instanceof HTMLElement) {
      current.click()
    }
  }, [])

  // ── B button → close modal or go back ──────────────────────────────────

  const goBack = useCallback(() => {
    const closeButtons = document.querySelectorAll('[data-modal-close]')
    if (closeButtons.length > 0) {
      const last = closeButtons[closeButtons.length - 1]
      if (last instanceof HTMLElement) {
        // Clear focus before closing so it doesn't stick to removed element
        clearFocus()
        last.click()
        return
      }
    }
    navigate(-1)
  }, [navigate, clearFocus])

  // ── Gamepad hook ───────────────────────────────────────────────────────

  const { connected } = useGamepad({
    buttons: {
      0:  { onPress: activate },                                                          // A — select
      1:  { onPress: goBack },                                                            // B — back
      12: { onPress: () => move('up'),    onRepeat: () => move('up'),    repeatDelay: 400, repeatInterval: 150 }, // DPad Up
      13: { onPress: () => move('down'),  onRepeat: () => move('down'),  repeatDelay: 400, repeatInterval: 150 }, // DPad Down
      14: { onPress: () => move('left'),  onRepeat: () => move('left'),  repeatDelay: 400, repeatInterval: 150 }, // DPad Left
      15: { onPress: () => move('right'), onRepeat: () => move('right'), repeatDelay: 400, repeatInterval: 150 }, // DPad Right
    },
    axes: [
      { axis: 0, direction: 'negative', onPress: () => move('left'),  onRepeat: () => move('left'),  repeatDelay: 400, repeatInterval: 150 },
      { axis: 0, direction: 'positive', onPress: () => move('right'), onRepeat: () => move('right'), repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'negative', onPress: () => move('up'),    onRepeat: () => move('up'),    repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'positive', onPress: () => move('down'),  onRepeat: () => move('down'),  repeatDelay: 400, repeatInterval: 150 },
    ],
    enabled: !isOpen, // Disabled when video player is open — it has its own controls
  })

  return (
    <GamepadNavContext.Provider value={{ connected }}>
      {children}
    </GamepadNavContext.Provider>
  )
}

export function useGamepadNav(): GamepadNavState {
  const ctx = useContext(GamepadNavContext)
  if (!ctx) throw new Error('useGamepadNav must be used within GamepadNavProvider')
  return ctx
}
