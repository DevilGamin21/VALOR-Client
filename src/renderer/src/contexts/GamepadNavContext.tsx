import { createContext, useContext, useEffect, useRef, useCallback, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGamepad } from '@/hooks/useGamepad'
import { usePlayer } from '@/contexts/PlayerContext'

// ─── Types ───────────────────────────────────────────────────────────────────

type Zone = 'sidebar' | 'content'

interface GamepadNavState {
  connected: boolean
}

const GamepadNavContext = createContext<GamepadNavState | null>(null)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isInSidebar(el: Element): boolean {
  return !!el.closest('aside')
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
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
  if (closeBtn.classList.contains('fixed')) return closeBtn
  return null
}

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** Find the scrollable carousel container (overflow-x-auto) for an element */
function findScrollRow(el: Element): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    if (parent.classList.contains('overflow-x-auto')) return parent
    parent = parent.parentElement
  }
  return null
}

/** Find the containing <section> for an element */
function findSection(el: Element): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    if (parent.tagName === 'SECTION') return parent
    parent = parent.parentElement
  }
  return null
}

/** Get all sidebar focusable items in order */
function getSidebarItems(): Element[] {
  const aside = document.querySelector('aside')
  if (!aside) return []
  return Array.from(aside.querySelectorAll('[data-focusable]')).filter(isVisible)
}

/** Get all visible content focusable items (non-sidebar) */
function getAllContentItems(): Element[] {
  return Array.from(document.querySelectorAll('[data-focusable]'))
    .filter(el => isVisible(el) && !isInSidebar(el))
}

/** Get focusable items within the same row/section as the given element */
function getSameRowItems(el: Element): Element[] {
  // First try: same scroll row (overflow-x-auto container)
  const scrollRow = findScrollRow(el)
  if (scrollRow) {
    return Array.from(scrollRow.querySelectorAll('[data-focusable]')).filter(isVisible)
  }
  // Second: same <section>
  const section = findSection(el)
  if (section) {
    return Array.from(section.querySelectorAll('[data-focusable]')).filter(isVisible)
  }
  // Third: nearest parent that contains multiple focusable siblings
  // (catches toggle rows, flex containers, etc.)
  let parent = el.parentElement
  while (parent && parent !== document.body) {
    const items = Array.from(parent.querySelectorAll('[data-focusable]')).filter(isVisible)
    if (items.length > 1) return items
    parent = parent.parentElement
  }
  return []
}

/** Get modal focusable items */
function getModalItems(): Element[] {
  const modalRoot = getModalRoot()
  if (!modalRoot) return []
  return Array.from(modalRoot.querySelectorAll('[data-focusable]')).filter(isVisible)
}

/** Find nearest element by spatial distance, with direction filter */
function findNearest(from: DOMRect, direction: 'up' | 'down' | 'left' | 'right', candidates: Element[]): Element | null {
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
  const zoneRef = useRef<Zone>('content')
  const preModalFocusRef = useRef<Element | null>(null)

  // ── Focus management ───────────────────────────────────────────────────

  const setFocus = useCallback((el: Element | null, zone?: Zone) => {
    if (focusedRef.current) {
      focusedRef.current.classList.remove('gp-focused')
    }
    focusedRef.current = el
    if (zone) zoneRef.current = zone
    if (el) {
      el.classList.add('gp-focused')
      // Horizontal scroll: reveal card in carousel
      const scrollRow = findScrollRow(el)
      if (scrollRow) {
        const rowRect = scrollRow.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        if (elRect.left < rowRect.left || elRect.right > rowRect.right) {
          const offset = elRect.left - rowRect.left - rowRect.width / 2 + elRect.width / 2
          scrollRow.scrollBy({ left: offset, behavior: 'smooth' })
        }
      }
      // Vertical scroll: keep element visible in main
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
      if (document.body.contains(focusedRef.current) && isVisible(focusedRef.current)) {
        return focusedRef.current
      }
      clearFocus()
    }
    return null
  }

  // ── MODAL navigation (pure spatial) ────────────────────────────────────

  const moveInModal = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const items = getModalItems()
    if (items.length === 0) return

    const current = ensureFocus()
    if (!current || !items.includes(current)) {
      const meaningful = items.find(el => !el.hasAttribute('data-modal-close'))
      setFocus(meaningful || items[0])
      return
    }

    const from = current.getBoundingClientRect()
    const candidates = items.filter(el => el !== current)
    const next = findNearest(from, direction, candidates)
    if (next) setFocus(next)
  }, [setFocus, clearFocus])

  // ── SIDEBAR navigation ─────────────────────────────────────────────────

  const moveInSidebar = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const items = getSidebarItems()
    if (items.length === 0) return

    const current = ensureFocus()

    if (!current || !isInSidebar(current)) {
      setFocus(items[0], 'sidebar')
      return
    }

    if (direction === 'right') {
      const contentItems = getAllContentItems()
      if (contentItems.length > 0) {
        const from = current.getBoundingClientRect()
        const nearest = findNearest(from, 'right', contentItems)
        setFocus(nearest || contentItems[0], 'content')
      }
      return
    }

    if (direction === 'up' || direction === 'down') {
      const idx = items.indexOf(current)
      if (idx === -1) { setFocus(items[0], 'sidebar'); return }
      const nextIdx = direction === 'up' ? idx - 1 : idx + 1
      if (nextIdx >= 0 && nextIdx < items.length) {
        setFocus(items[nextIdx], 'sidebar')
      }
      return
    }
  }, [setFocus, clearFocus])

  // ── CONTENT navigation ─────────────────────────────────────────────────

  const moveInContent = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const current = ensureFocus()

    // No focus yet — pick first content item
    if (!current || isInSidebar(current)) {
      const contentItems = getAllContentItems()
      if (contentItems.length > 0) {
        setFocus(contentItems[0], 'content')
      }
      return
    }

    const from = current.getBoundingClientRect()

    // ── LEFT / RIGHT — stay in the SAME row ──
    if (direction === 'left' || direction === 'right') {
      // Only search within the same row (same scroll container / section)
      const rowItems = getSameRowItems(current).filter(el => el !== current)
      const sameRowMatch = findNearest(from, direction, rowItems)

      if (sameRowMatch) {
        setFocus(sameRowMatch, 'content')
        return
      }

      // No visible item in direction within the row — try scrolling the carousel
      const scrollRow = findScrollRow(current)
      if (scrollRow) {
        if (direction === 'right') {
          const maxScroll = scrollRow.scrollWidth - scrollRow.clientWidth
          if (scrollRow.scrollLeft < maxScroll - 5) {
            scrollRow.scrollBy({ left: 200, behavior: 'smooth' })
            setTimeout(() => {
              const newRowItems = getSameRowItems(current).filter(el => el !== current)
              const found = findNearest(from, 'right', newRowItems)
              if (found) setFocus(found, 'content')
            }, 250)
            return
          }
        } else {
          if (scrollRow.scrollLeft > 5) {
            scrollRow.scrollBy({ left: -200, behavior: 'smooth' })
            setTimeout(() => {
              const newRowItems = getSameRowItems(current).filter(el => el !== current)
              const found = findNearest(from, 'left', newRowItems)
              if (found) setFocus(found, 'content')
            }, 250)
            return
          }
        }
      }

      // At the boundary: left at leftmost → enter sidebar
      if (direction === 'left') {
        const sidebarItems = getSidebarItems()
        if (sidebarItems.length > 0) {
          const nearest = findNearest(from, 'left', sidebarItems)
          setFocus(nearest || sidebarItems[0], 'sidebar')
        }
      }
      // Right at rightmost → do nothing (end of row)
      return
    }

    // ── UP / DOWN — move between rows, stay in content ──
    const contentItems = getAllContentItems().filter(el => el !== current)
    const next = findNearest(from, direction, contentItems)

    if (next) {
      setFocus(next, 'content')
    } else {
      const main = document.querySelector('main')
      if (main) {
        const amount = direction === 'down' ? 300 : -300
        main.scrollBy({ top: amount, behavior: 'smooth' })
        setTimeout(() => {
          const newItems = getAllContentItems().filter(el => el !== (focusedRef.current))
          const found = findNearest(from, direction, newItems)
          if (found) setFocus(found, 'content')
        }, 350)
      }
    }
  }, [setFocus, clearFocus])

  // ── Main move dispatcher ───────────────────────────────────────────────

  const move = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (getModalRoot()) {
      // Save pre-modal focus on first modal navigation
      if (!preModalFocusRef.current && focusedRef.current) {
        preModalFocusRef.current = focusedRef.current
      }
      moveInModal(direction)
      return
    }

    // Modal just closed — restore previous focus if still valid
    if (preModalFocusRef.current) {
      const saved = preModalFocusRef.current
      preModalFocusRef.current = null
      if (document.body.contains(saved) && isVisible(saved)) {
        setFocus(saved, isInSidebar(saved) ? 'sidebar' : 'content')
        return
      }
    }

    const current = focusedRef.current
    if (current && document.body.contains(current) && isVisible(current)) {
      zoneRef.current = isInSidebar(current) ? 'sidebar' : 'content'
    }

    if (zoneRef.current === 'sidebar') {
      moveInSidebar(direction)
    } else {
      moveInContent(direction)
    }
  }, [moveInModal, moveInSidebar, moveInContent, setFocus])

  // ── A button → activate ────────────────────────────────────────────────

  const activate = useCallback(() => {
    const current = ensureFocus()
    if (current && current instanceof HTMLElement) {
      current.click()
      // React re-renders (e.g. URL param changes from toggles) can overwrite
      // the className attribute, stripping the gp-focused class we added.
      // Re-apply it on the next frame to keep the visual highlight stable.
      requestAnimationFrame(() => {
        if (focusedRef.current === current && document.body.contains(current)) {
          current.classList.add('gp-focused')
        }
      })
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
        // Restore pre-modal focus after modal close animation
        const saved = preModalFocusRef.current
        preModalFocusRef.current = null
        if (saved) {
          setTimeout(() => {
            if (document.body.contains(saved) && isVisible(saved)) {
              setFocus(saved, isInSidebar(saved) ? 'sidebar' : 'content')
            }
          }, 100)
        }
        return
      }
    }
    navigate(-1)
  }, [navigate, clearFocus, setFocus])

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
