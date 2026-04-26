import { useEffect, useState } from 'react'
import Modal from './Modal'
import { useSettings } from '@/contexts/SettingsContext'

const STORAGE_KEY = 'valor-popup-mpv-recommend-dismissed'

/** First-time recommendation to switch from the built-in HLS player to mpv.
 *  Shows once per install (dismissal stored in localStorage). Skipped when:
 *    - the user is already on mpv
 *    - mpv isn't bundled in this build
 *    - the user has previously dismissed/accepted
 *
 *  Add other one-shot popups by composing <Modal> the same way — give each
 *  its own STORAGE_KEY so dismissals don't collide. */
export default function MpvRecommendationModal() {
  const { playerEngine, update } = useSettings()
  const [open, setOpen] = useState(false)
  const [mpvAvailable, setMpvAvailable] = useState(false)

  useEffect(() => {
    if (playerEngine !== 'builtin') return
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') return
    } catch { /* localStorage unavailable */ }

    let cancelled = false
    window.electronAPI.mpv.isAvailable().then((available) => {
      if (cancelled || !available) return
      setMpvAvailable(true)
      // Small delay so the popup doesn't slam in before the page paints
      setTimeout(() => { if (!cancelled) setOpen(true) }, 1500)
    }).catch(() => { /* ignore */ })

    return () => { cancelled = true }
  }, [playerEngine])

  function dismiss() {
    setOpen(false)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
  }

  function switchToMpv() {
    update({ playerEngine: 'mpv' })
    dismiss()
  }

  if (!mpvAvailable) return null

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title="Try the mpv player"
      actions={
        <>
          <button
            data-focusable
            onClick={dismiss}
            className="px-4 py-2 rounded-lg text-sm text-white/60
                       hover:text-white hover:bg-white/5 transition"
          >
            Maybe later
          </button>
          <button
            data-focusable
            onClick={switchToMpv}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white
                       bg-red-600 hover:bg-red-500 transition shadow-[0_0_18px_-4px_rgba(220,38,38,0.6)]"
          >
            Switch to mpv
          </button>
        </>
      }
    >
      <p>
        VALOR ships with two playback engines. The default{' '}
        <span className="text-white font-medium">Built-in</span> player works in any
        Electron setup but tends to stutter on high-bitrate releases.
      </p>
      <p>
        <span className="text-white font-medium">mpv</span> handles HEVC, AV1, and
        Dolby Vision/HDR via hardware decode — same playback story as the Android TV app.
        Quality is noticeably better on direct-play sources.
      </p>
      <p className="text-xs text-white/40">
        mpv embedding is newer and may be slightly less stable on some GPUs. You can
        switch back any time in Settings → Playback → Player Engine.
      </p>
    </Modal>
  )
}
