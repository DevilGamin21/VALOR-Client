import { useEffect, useRef } from 'react'
interface Options { enabled?: boolean; onPlayPause?: () => void }
export function useTvRemote({ enabled = true, onPlayPause }: Options = {}) {
  const lastFocused = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!enabled) return
    function getFocusables(): HTMLElement[] {
      return Array.from(document.querySelectorAll<HTMLElement>('[data-focusable]')).filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    }
    function focusElement(el: HTMLElement) {
      if (lastFocused.current) lastFocused.current.classList.remove('tv-focused')
      el.classList.add('tv-focused'); el.focus({ preventScroll: false }); el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); lastFocused.current = el
    }
    function findNearest(from: DOMRect, dir: 'up'|'down'|'left'|'right', els: HTMLElement[]): HTMLElement|null {
      const fc = { x: from.left+from.width/2, y: from.top+from.height/2 }; let best: HTMLElement|null = null; let bestScore = Infinity
      for (const el of els) {
        if (el === lastFocused.current) continue; const r = el.getBoundingClientRect(); const tc = { x: r.left+r.width/2, y: r.top+r.height/2 }
        if (dir==='up'&&tc.y>=fc.y-1) continue; if (dir==='down'&&tc.y<=fc.y+1) continue; if (dir==='left'&&tc.x>=fc.x-1) continue; if (dir==='right'&&tc.x<=fc.x+1) continue
        const main = (dir==='up'||dir==='down')?Math.abs(tc.y-fc.y):Math.abs(tc.x-fc.x); const cross = (dir==='up'||dir==='down')?Math.abs(tc.x-fc.x):Math.abs(tc.y-fc.y)
        const score = main+cross*3; if (score<bestScore) { bestScore=score; best=el }
      }
      return best
    }
    function onKeyDown(e: KeyboardEvent) {
      const els = getFocusables(); if (!els.length) return
      let dir: 'up'|'down'|'left'|'right'|null = null
      if (e.key==='ArrowUp') dir='up'; else if (e.key==='ArrowDown') dir='down'; else if (e.key==='ArrowLeft') dir='left'; else if (e.key==='ArrowRight') dir='right'
      if (dir) { e.preventDefault(); const c = lastFocused.current; if (!c||!els.includes(c)) { focusElement(els[0]); return }; const n = findNearest(c.getBoundingClientRect(),dir,els); if (n) focusElement(n); return }
      if (e.key==='Enter'||e.key===' ') { e.preventDefault(); lastFocused.current?.click(); return }
      if (e.key==='Escape'||e.key==='Backspace'||e.key==='XF86Back'||(e as any).keyCode===10009) { e.preventDefault(); const mc = document.querySelector<HTMLElement>('[data-modal-close]'); if (mc) { mc.click(); return }; window.history.back(); return }
      if (e.key==='MediaPlayPause'||e.key==='XF86PlayBack'||(e as any).keyCode===10252) { e.preventDefault(); onPlayPause?.() }
    }
    const timer = setTimeout(() => { const els = getFocusables(); if (els.length>0&&!lastFocused.current) focusElement(els[0]) }, 100)
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); clearTimeout(timer); if (lastFocused.current) lastFocused.current.classList.remove('tv-focused') }
  }, [enabled, onPlayPause])
}
