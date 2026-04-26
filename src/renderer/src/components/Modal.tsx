import { useEffect, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  /** Called when the user dismisses via the X, the backdrop, or Esc. */
  onClose: () => void
  title?: string
  /** Body content — typically <p> tags or other paragraph elements. */
  children?: ReactNode
  /** Buttons rendered in a right-aligned row at the bottom. */
  actions?: ReactNode
  /** When false, clicking the backdrop does NOT dismiss. Default true. */
  closeOnBackdrop?: boolean
  /** Override the max width — defaults to max-w-md (~28rem). */
  widthClass?: string
}

/** Generic centred modal with darkened backdrop. Drop-in for any popup —
 *  wrap with feature-specific copy via the `title`, `children`, `actions`
 *  props. Gamepad/Esc/backdrop-click all route to onClose. */
export default function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  closeOnBackdrop = true,
  widthClass = 'max-w-md',
}: Props) {
  // Esc to close
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop — 40% black + light blur. data-modal-close lets the
              gamepad B button close it via GamepadNavContext. */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            data-modal-close
            onClick={closeOnBackdrop ? onClose : undefined}
          />

          {/* Box */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`relative z-10 w-full ${widthClass} mx-4
                       bg-[#171717] border border-white/10 rounded-2xl
                       shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)]`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            {/* Close (X) */}
            <button
              data-focusable
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 p-1.5 rounded-lg
                         text-white/40 hover:text-white hover:bg-white/10
                         transition-colors"
            >
              <X size={16} />
            </button>

            {title && (
              <h2 className="px-6 pt-6 pb-2 text-lg font-semibold text-white pr-10">
                {title}
              </h2>
            )}

            {children && (
              <div className="px-6 pb-4 pt-1 text-sm text-white/70 leading-relaxed space-y-2.5">
                {children}
              </div>
            )}

            {actions && (
              <div className="px-6 pb-5 pt-2 flex gap-2 justify-end">
                {actions}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
