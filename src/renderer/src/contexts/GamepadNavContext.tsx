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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function isInViewport(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  // Must be at least partially inside the viewport vertically
  return r.bottom > 0 && r.top < window.innerHeight
}

function isFullyVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
}

/** Check if an element is inside the sidebar (the <aside>) */
function isInSidebar(el: Element): boolean {
  return !!el.closest('aside')
}

/** Find the scrollable carousel container for a focusable element */
function findScrollRow(el: Element): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    if (parent.classList.contains('overflow-x-auto')) return parent
    parent = parent.parentElement
  }
  return null
}

/** Get the modal root if a modal is open, or null */
function getModalRoot(): Element | null {
  const modals = document.querySelectorAll('[data-modal-close]')
  if (modals.length === 0) return null
  const closeBtn = modals[modals.length - 1]
  let el: Element | null = closeBtn
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el)
    if (style.position === 'fixed' && (el.classList.contains('z-50') || el.classList.contains('z-[50]'))) return el
    el = el.parentElement
  }
  // If the close button itself is on the fixed overlay
  if (closeBtn.classList.contains('fixed')) return closeBtn
  return null
}

function findNearest(from: DOMRect, direction: Direction, candidates: Element[]): Element | null {
  const fc = center(from)
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
      // For elements in a horizontal scroll row, scroll the row to reveal the card
      const scrollRow = findScrollRow(el)
      if (scrollRow) {
        const rowRect = scrollRow.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        // If the element is partially or fully outside the row's visible area, scroll it in
        if (elRect.left < rowRect.left || elRect.right > rowRect.right) {
          const offset = elRect.left - rowRect.left - rowRect.width / 2 + elRect.width / 2
          scrollRow.scrollBy({ left: offset, behavior: 'smooth' })
        }
      }
      // Vertical scroll: make sure the element is visible in the main scroll area
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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
    function onMouseMove() { clearFocus() }
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [clearFocus])

  // ── Ensure focused element is still valid ──────────────────────────────

  function ensureFocus(): Element | null {
    if (focusedRef.current) {
      if (document.body.contains(focusedRef.current) && isInViewport(focusedRef.current)) {
        return focusedRef.current
      }
      clearFocus()
    }
    return null
  }

  // ── Get focusable candidates ───────────────────────────────────────────

  function getCandidates(inModal: boolean): Element[] {
    if (inModal) {
      const modalRoot = getModalRoot()
      if (modalRoot) {
        return Array.from(modalRoot.querySelectorAll('[data-focusable]')).filter(isFullyVisible)
      }
    }
    return Array.from(document.querySelectorAll('[data-focusable]')).filter(isInViewport)
  }

  // ── Move focus ─────────────────────────────────────────────────────────

  const move = useCallback((direction: Direction) => {
    const inModal = !!getModalRoot()
    const current = ensureFocus()

    // ── No current focus → pick first meaningful element ──
    if (!current) {
      const candidates = getCandidates(inModal)
      if (candidates.length === 0) return
      if (inModal) {
        // In a modal, skip the close button — focus the first interactive element
        const meaningful = candidates.find(el => !el.hasAttribute('data-modal-close'))
        setFocus(meaningful || candidates[0])
      } else {
        // Prefer content (non-sidebar) element
        const contentEl = candidates.find(el => !isInSidebar(el))
        setFocus(contentEl || candidates[0])
      }
      return
    }

    const currentInSidebar = isInSidebar(current)
    const from = current.getBoundingClientRect()

    // ── Inside a modal → pure spatial nav ──
    if (inModal) {
      const candidates = getCandidates(true).filter(el => el !== current)
      if (candidates.length === 0) return
      const next = findNearest(from, direction, candidates)
      if (next) setFocus(next)
      return
    }

    // ── Sidebar navigation ──
    if (currentInSidebar) {
      if (direction === 'right') {
        // Exit sidebar → first visible content focusable
        const content = getCandidates(false).filter(el => !isInSidebar(el) && isFullyVisible(el))
        if (content.length > 0) {
          const nearest = findNearest(from, 'right', content)
          setFocus(nearest || content[0])
        }
        return
      }
      // Up/down within sidebar
      if (direction === 'up' || direction === 'down') {
        const sidebarItems = getCandidates(false).filter(el => isInSidebar(el) && el !== current)
        const next = findNearest(from, direction, sidebarItems)
        if (next) setFocus(next)
        return
      }
      return
    }

    // ── Content area navigation ──

    if (direction === 'left') {
      // Check if there's a focusable element to the left (in the same row or a carousel)
      const scrollRow = findScrollRow(current)
      const contentItems = getCandidates(false).filter(el => !isInSidebar(el) && el !== current)
      const leftNearest = findNearest(from, 'left', contentItems)

      if (leftNearest) {
        setFocus(leftNearest)
      } else if (scrollRow) {
        // Scroll the carousel left and try again after a brief delay
        scrollRow.scrollBy({ left: -200, behavior: 'smooth' })
        setTimeout(() => {
          const newCandidates = Array.from(document.querySelectorAll('[data-focusable]'))
            .filter(el => !isInSidebar(el) && el !== current && isFullyVisible(el))
          const next = findNearest(from, 'left', newCandidates)
          if (next) setFocus(next)
        }, 200)
      } else {
        // No more content to the left → go to sidebar
        const sidebarItems = getCandidates(false).filter(el => isInSidebar(el))
        if (sidebarItems.length > 0) {
          // Pick sidebar item closest vertically
          const nearest = findNearest(from, 'left', sidebarItems)
          setFocus(nearest || sidebarItems[0])
        }
      }
      return
    }

    if (direction === 'right') {
      const scrollRow = findScrollRow(current)
      const contentItems = getCandidates(false).filter(el => !isInSidebar(el) && el !== current)
      const rightNearest = findNearest(from, 'right', contentItems)

      if (rightNearest) {
        setFocus(rightNearest)
      } else if (scrollRow) {
        // Scroll the carousel right and find newly visible elements
        scrollRow.scrollBy({ left: 200, behavior: 'smooth' })
        setTimeout(() => {
          const newCandidates = Array.from(document.querySelectorAll('[data-focusable]'))
            .filter(el => !isInSidebar(el) && el !== current && isFullyVisible(el))
          const next = findNearest(from, 'right', newCandidates)
          if (next) setFocus(next)
        }, 200)
      }
      return
    }

    // Up/Down — move between rows, only among content elements
    const contentItems = getCandidates(false).filter(el => !isInSidebar(el) && el !== current)
    const next = findNearest(from, direction, contentItems)

    if (next) {
      setFocus(next)
    } else {
      // No focusable element in direction — scroll the page
      const main = document.querySelector('main')
      if (main) {
        const amount = direction === 'down' ? 300 : -300
        main.scrollBy({ top: amount, behavior: 'smooth' })
        // After scrolling, look for newly visible elements
        setTimeout(() => {
          const newCandidates = Array.from(document.querySelectorAll('[data-focusable]'))
            .filter(el => !isInSidebar(el) && el !== (focusedRef.current) && isFullyVisible(el))
          const found = findNearest(from, direction, newCandidates)
          if (found) setFocus(found)
        }, 350)
      }
    }
  }, [setFocus, clearFocus])

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
      0:  { onPress: activate },
      1:  { onPress: goBack },
      12: { onPress: () => move('up'),    onRepeat: () => move('up'),    repeatDelay: 400, repeatInterval: 150 },
      13: { onPress: () => move('down'),  onRepeat: () => move('down'),  repeatDelay: 400, repeatInterval: 150 },
      14: { onPress: () => move('left'),  onRepeat: () => move('left'),  repeatDelay: 400, repeatInterval: 150 },
      15: { onPress: () => move('right'), onRepeat: () => move('right'), repeatDelay: 400, repeatInterval: 150 },
    },
    axes: [
      { axis: 0, direction: 'negative', onPress: () => move('left'),  onRepeat: () => move('left'),  repeatDelay: 400, repeatInterval: 150 },
      { axis: 0, direction: 'positive', onPress: () => move('right'), onRepeat: () => move('right'), repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'negative', onPress: () => move('up'),    onRepeat: () => move('up'),    repeatDelay: 400, repeatInterval: 150 },
      { axis: 1, direction: 'positive', onPress: () => move('down'),  onRepeat: () => move('down'),  repeatDelay: 400, repeatInterval: 150 },
    ],
    enabled: !isOpen,
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
