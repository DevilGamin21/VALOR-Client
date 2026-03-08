import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, RefreshCw, X, Loader2, AlertCircle } from 'lucide-react'

type UpdateState =
  | { stage: 'idle' }
  | { stage: 'available'; version: string }
  | { stage: 'downloading'; percent: number; kbps: number }
  | { stage: 'ready'; version: string }
  | { stage: 'error'; message: string }

interface Props {
  /** Called whenever the banner visibility changes — used to show a bell icon in the sidebar */
  onVisibilityChange?: (visible: boolean) => void
}

export default function UpdateBanner({ onVisibilityChange }: Props) {
  const [state, setState] = useState<UpdateState>({ stage: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  const visible = state.stage !== 'idle' && !dismissed

  useEffect(() => {
    onVisibilityChange?.(visible)
  }, [visible, onVisibilityChange])

  useEffect(() => {
    window.electronAPI.updates.onAvailable(({ version }) => {
      setState({ stage: 'available', version })
      setDismissed(false)
    })
    window.electronAPI.updates.onProgress(({ percent, bytesPerSecond }) => {
      setState({ stage: 'downloading', percent, kbps: Math.round(bytesPerSecond / 1024) })
    })
    window.electronAPI.updates.onDownloaded(({ version }) => {
      setState({ stage: 'ready', version })
      setDismissed(false)
    })
    window.electronAPI.updates.onError((message) => {
      setState({ stage: 'error', message })
    })
  }, [])

  function handleDownload() {
    window.electronAPI.updates.download()
    setState((s) => s.stage === 'available' ? { stage: 'downloading', percent: 0, kbps: 0 } : s)
  }

  function handleInstall() {
    window.electronAPI.updates.install()
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="update-banner"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0 overflow-hidden border-b border-white/10"
        >
          <div className="flex items-center gap-3 px-4 py-2 bg-black/60 backdrop-blur-xl">
            {/* Icon */}
            <span className="flex-shrink-0">
              {state.stage === 'downloading' && <Loader2 size={13} className="text-amber-400 animate-spin" />}
              {state.stage === 'ready'       && <RefreshCw size={13} className="text-green-400" />}
              {state.stage === 'error'       && <AlertCircle size={13} className="text-red-400" />}
              {state.stage === 'available'   && <Download size={13} className="text-amber-400" />}
            </span>

            {/* Text */}
            <span className="text-xs text-white/70 flex-1 truncate">
              {state.stage === 'available'   && `Update v${state.version} — downloading…`}
              {state.stage === 'downloading' && `Downloading… ${state.percent}%  ${state.kbps} KB/s`}
              {state.stage === 'ready'       && `v${state.version} ready — restart to update`}
              {state.stage === 'error'       && `Update failed: ${state.message}`}
            </span>

            {/* Progress bar (inline, downloading) */}
            {state.stage === 'downloading' && (
              <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden flex-shrink-0">
                <motion.div
                  className="h-full bg-amber-400 rounded-full"
                  animate={{ width: `${state.percent}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            )}

            {/* Action button */}
            {state.stage === 'available' && (
              <Loader2 size={13} className="text-amber-400/60 animate-spin flex-shrink-0" />
            )}
            {state.stage === 'ready' && (
              <button
                data-focusable
                onClick={handleInstall}
                className="flex-shrink-0 px-3 py-1 rounded-full bg-green-600/80 hover:bg-green-500
                           text-white text-xs font-medium transition-colors"
              >
                Restart
              </button>
            )}
            {state.stage === 'error' && (
              <button
                data-focusable
                onClick={() => { window.electronAPI.updates.check(); setState({ stage: 'idle' }) }}
                className="flex-shrink-0 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20
                           text-white/60 text-xs font-medium transition-colors"
              >
                Retry
              </button>
            )}

            {/* Dismiss (not during download) */}
            {state.stage !== 'downloading' && (
              <button
                onClick={() => setDismissed(true)}
                className="flex-shrink-0 text-white/30 hover:text-white/60 transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
