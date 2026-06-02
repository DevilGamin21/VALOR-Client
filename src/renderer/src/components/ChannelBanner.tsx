import { useState } from 'react'
import { AlertTriangle, ArrowRight, X } from 'lucide-react'
import { CHANNEL_ID, CHANNEL } from '@/lib/channelConfig'
import { STABLE_DOWNLOAD_URL } from '@/lib/channels'

// SessionStorage key — banner reappears next app launch so testers are
// reminded which track they're on after a restart. Deliberately not
// persistent: "forever-dismissed" is too easy to forget while shipping
// experimental builds.
const DISMISS_KEY = 'valor-channel-banner-dismissed'

const TONE_CLASSES: Record<typeof CHANNEL.tone, string> = {
  stable: '',
  soak: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  beta: 'bg-red-600/15 border-red-500/40 text-red-200',
}

/**
 * Slim top strip rendered only on non-stable channels. Tells the user
 * they're on an experimental build and gives them one-click escapes:
 *   - "Back to stable" — opens the GitHub releases page in the default
 *      browser (where they can grab the stable installer).
 *   - X — hides the banner for this session.
 *
 * Renders inside RootShell's flex column above TitleBar; on stable it
 * returns null and takes no layout space.
 */
export default function ChannelBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  if (CHANNEL_ID === 'stable' || dismissed) return null

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* sessionStorage blocked — banner just hides for this render */
    }
    setDismissed(true)
  }

  const handleBackToStable = () => {
    window.electronAPI.shell.openExternal(STABLE_DOWNLOAD_URL).catch(() => {})
  }

  return (
    <div
      className={`flex-shrink-0 h-7 flex items-center justify-center gap-2 text-[11px] font-medium border-b backdrop-blur ${TONE_CLASSES[CHANNEL.tone]}`}
      role="status"
      aria-label={`You are on the ${CHANNEL_ID} channel (${CHANNEL.label} track)`}
    >
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">
        You&rsquo;re on{' '}
        <strong className="font-semibold capitalize">{CHANNEL_ID}</strong>{' '}
        <span className="opacity-75">({CHANNEL.label} track)</span>
      </span>
      <button
        data-focusable
        type="button"
        onClick={handleBackToStable}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
      >
        Back to stable
        <ArrowRight className="w-2.5 h-2.5" />
      </button>
      <button
        data-focusable
        type="button"
        onClick={handleDismiss}
        className="ml-1 p-1 rounded hover:bg-white/10 transition-colors"
        aria-label="Hide banner for this session"
        title="Hide for this session"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
