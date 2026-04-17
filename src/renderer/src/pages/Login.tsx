import { useState, useMemo, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import TitleBar from '@/components/TitleBar'

type Stage = 'idle' | 'submitting' | 'dot' | 'confirmed' | 'success' | 'failure' | 'reverting'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.09, delayChildren: 0.15 },
  },
}

const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isAddAccount = searchParams.get('addAccount') === 'true'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [stage, setStage] = useState<Stage>('idle')

  // Generate particles once
  const particles = useMemo(() =>
    Array.from({ length: 66 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 3 + Math.random() * 10,
      initRotate: Math.random() * 360,
      rotateCw: Math.random() > 0.5,
      driftX: (Math.random() - 0.5) * 160,
      driftY: (Math.random() - 0.5) * 140,
      driftDuration: 5 + Math.random() * 10,
      opacity: 0.03 + Math.random() * 0.28,
    })),
  [])

  const particleCss = useMemo(() =>
    particles.map((p) => {
      const endRotate = p.initRotate + (p.rotateCw ? 180 : -180)
      return `@keyframes vp-${p.id}{0%,100%{transform:translate(0,0) rotate(${p.initRotate}deg)}50%{transform:translate(${p.driftX}px,${p.driftY}px) rotate(${endRotate}deg)}}`
    }).join('\n'),
  [particles])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (stage !== 'idle') return
    setError('')
    setStage('submitting')

    await new Promise((r) => setTimeout(r, 350))
    setStage('dot')

    try {
      await login(username, password)
      setStage('confirmed')
      await new Promise((r) => setTimeout(r, 1000))
      setStage('success')
      await new Promise((r) => setTimeout(r, 900))
      navigate('/home', { replace: true })
    } catch (err) {
      setStage('failure')
      await new Promise((r) => setTimeout(r, 500))
      setStage('reverting')
      await new Promise((r) => setTimeout(r, 400))
      setStage('idle')
      setError((err as Error).message || 'Invalid credentials')
    }
  }

  const isAnimating = stage !== 'idle' && stage !== 'reverting'
  const showCard = stage === 'idle' || stage === 'submitting' || stage === 'reverting'
  const showDot = stage === 'dot' || stage === 'confirmed' || stage === 'success' || stage === 'failure'
  const isGreen = stage === 'confirmed' || stage === 'success'

  const inputClass = 'w-full rounded-xl bg-black/50 border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/15 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="flex flex-col h-screen bg-[#06060a] overflow-hidden">
      {/* Title bar */}
      <TitleBar />

      <div className="flex-1 relative flex items-center justify-center">
        {/* Background glow blobs */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-[30%] -right-[20%] w-[70vw] h-[70vw] rounded-full bg-red-950/40 blur-[140px]" />
          <div className="absolute -bottom-[25%] -left-[20%] w-[60vw] h-[60vw] rounded-full bg-indigo-950/30 blur-[120px]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[45vw] h-[45vw] rounded-full bg-red-950/20 blur-[90px]" />
        </div>

        {/* Dot-grid texture */}
        <div
          className="fixed inset-0 pointer-events-none opacity-[0.018]"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* Floating square particles */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <style dangerouslySetInnerHTML={{ __html: particleCss }} />
          {particles.map((p) => (
            <div
              key={p.id}
              className="absolute bg-white"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
                opacity: p.opacity,
                animation: `vp-${p.id} ${p.driftDuration}s ease-in-out infinite`,
                willChange: 'transform',
              }}
            />
          ))}
        </div>

        {/* Login card */}
        <AnimatePresence mode="wait">
          {showCard && (
            <motion.div
              key="card"
              className="relative z-10 w-full px-4 max-w-[22rem]"
              variants={container}
              initial="hidden"
              animate={
                stage === 'submitting'
                  ? { scale: 0.97, opacity: 0.6, filter: 'blur(3px)' }
                  : stage === 'reverting'
                  ? 'show'
                  : 'show'
              }
              exit={{ opacity: 0, scale: 0, filter: 'blur(16px)' }}
              transition={{ duration: 0.35 }}
            >
              {/* Brand mark */}
              <motion.div className="text-center mb-9" variants={item}>
                <h1 className="font-black tracking-[0.42em] text-white leading-none text-[2.6rem]">
                  VALOR
                </h1>
                <p className="mt-3 tracking-[0.3em] text-red-400/50 uppercase text-[10px]">
                  {isAddAccount ? 'Add Account' : 'Sign In'}
                </p>
              </motion.div>

              {/* Card */}
              <motion.div
                variants={item}
                layout
                className="p-px rounded-2xl bg-gradient-to-b from-white/10 via-white/[0.04] to-white/[0.02]"
              >
                <div className="relative rounded-2xl bg-[#0c0c11]/95 backdrop-blur-3xl px-7 py-8 shadow-[0_20px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.04)]">
                  {/* Scan-line shimmer */}
                  <motion.div
                    className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent rounded-full"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  />

                  {/* Error */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-5 overflow-hidden"
                      >
                        <div className="flex items-center gap-2.5 rounded-xl bg-red-500/8 border border-red-500/20 px-3.5 py-2.5">
                          <AlertCircle className="text-red-400 shrink-0 w-3.5 h-3.5" />
                          <p className="text-red-300 leading-snug text-xs">{error}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Form */}
                  <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div>
                      <label className={`block uppercase tracking-[0.22em] text-white/35 font-semibold select-none ${'text-[9px] mb-2'}`}>
                        Username
                      </label>
                      <input
                        data-focusable
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        disabled={isAnimating}
                        className={inputClass}
                        autoComplete="username"
                      />
                    </div>
                    <div>
                      <label className={`block uppercase tracking-[0.22em] text-white/35 font-semibold select-none ${'text-[9px] mb-2'}`}>
                        Password
                      </label>
                      <input
                        data-focusable
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isAnimating}
                        className={inputClass}
                        autoComplete="current-password"
                      />
                    </div>
                    <button
                      data-focusable
                      type="submit"
                      disabled={isAnimating}
                      className={`group relative w-full overflow-hidden rounded-xl py-3.5 text-[11px] font-bold tracking-[0.25em] uppercase transition-all duration-300 mt-1 ${
                            isAnimating
                              ? 'bg-red-900/30 text-red-400/40 cursor-wait'
                              : 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-[0_4px_30px_rgba(220,38,38,0.35)] hover:shadow-[0_4px_40px_rgba(220,38,38,0.5)] hover:from-red-500 hover:to-red-600'
                          }`}
                    >
                      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-500 ease-in-out group-hover:translate-x-[200%]" />
                      <span className="relative flex items-center justify-center gap-2">
                        {isAnimating && <Loader2 className="animate-spin w-3.5 h-3.5" />}
                        {isAnimating ? 'Signing in...' : 'Sign In'}
                      </span>
                    </button>

                    {isAddAccount && !isAnimating && (
                      <button
                        data-focusable
                        type="button"
                        onClick={() => navigate('/home', { replace: true })}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-[10px] uppercase tracking-[0.2em] text-white/40 hover:text-white/70 transition"
                      >
                        <ArrowLeft size={12} />
                        Cancel
                      </button>
                    )}
                  </form>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* Animated dot */}
          {showDot && (
            <motion.div
              key="dot"
              className="relative z-10 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                animate={
                  stage === 'success'
                    ? { scale: 200, opacity: 1 }
                    : stage === 'failure'
                    ? { x: [0, -14, 14, -10, 10, -6, 0] }
                    : { width: 20, height: 20 }
                }
                transition={
                  stage === 'success'
                    ? { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
                    : stage === 'failure'
                    ? { duration: 0.5 }
                    : {}
                }
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: stage === 'success' ? 0 : '50%',
                  background: stage === 'success'
                    ? '#0a0a0a'
                    : isGreen
                    ? 'radial-gradient(circle, rgba(16,185,129,0.95) 0%, rgba(16,185,129,0.5) 50%, transparent 75%)'
                    : 'radial-gradient(circle, rgba(220,38,38,0.95) 0%, rgba(220,38,38,0.5) 50%, transparent 75%)',
                  boxShadow: stage === 'success'
                    ? 'none'
                    : isGreen
                    ? '0 0 60px 15px rgba(16,185,129,0.5), 0 0 120px 40px rgba(16,185,129,0.2)'
                    : '0 0 60px 15px rgba(220,38,38,0.5), 0 0 120px 40px rgba(220,38,38,0.2)',
                }}
              />
              {stage !== 'success' && (
                <motion.div
                  className={`absolute rounded-full border-2 transition-colors duration-500 ${
                    isGreen
                      ? 'border-emerald-500/30 border-t-emerald-400'
                      : 'border-red-500/25 border-t-red-400'
                  }`}
                  style={{ width: 48, height: 48, animation: 'valor-spin 0.8s linear infinite' }}
                />
              )}
              {stage !== 'success' && (
                <motion.div
                  className={`absolute rounded-full border ${isGreen ? 'border-emerald-500/20' : 'border-red-500/15'}`}
                  style={{ width: 72, height: 72 }}
                  animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Black overlay during success */}
        <AnimatePresence>
          {stage === 'success' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="fixed inset-0 bg-[#0a0a0a] z-50"
              transition={{ delay: 0.7, duration: 0.4, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
