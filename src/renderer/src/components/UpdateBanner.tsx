import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, RefreshCw, X, Loader2, AlertCircle } from 'lucide-react'

const AUTO_RESTART_SECS = 5

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
  const [countdown, setCountdown] = useState(AUTO_RESTART_SECS)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const visible = state.stage !== 'idle' && !dismissed

  useEffect(() => {
    onVisibilityChange?.(visible)
  }, [visible, onVisibilityChange])

  const doInstall = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    window.electronAPI.updates.install()
  }, [])

  // Auto-restart countdown when update is ready
  useEffect(() => {
    if (state.stage !== 'ready') {
      setCountdown(AUTO_RESTART_SECS)
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
      return
    }
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          doInstall()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [state.stage, doInstall])

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
              {state.stage === 'ready'       && `v${state.version} ready — restarting in ${countdown}s`}
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
                onClick={doInstall}
                className="flex-shrink-0 relative px-3 py-1 rounded-full overflow-hidden
                           text-white text-xs font-medium transition-colors hover:brightness-110"
              >
                {/* Filling background — shrinks as countdown progresses */}
                <span
                  className="absolute inset-0 bg-green-600/80 rounded-full origin-left transition-[width] ease-linear"
                  style={{ width: `${(countdown / AUTO_RESTART_SECS) * 100}%`, transitionDuration: '1s' }}
                />
                <span className="absolute inset-0 bg-green-900/40 rounded-full" />
                <span className="relative">Restart ({countdown}s)</span>
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
