import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, ChevronLeft, ChevronRight } from 'lucide-react'
import type { UnifiedMedia } from '@/types/media'

interface Props {
  items: UnifiedMedia[]
  onSelect: (item: UnifiedMedia) => void
}

export default function DynamicHero({ items, onSelect }: Props) {
  const heroItems = items.filter((i) => i.backdropUrl || i.posterUrl).slice(0, 5)
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (heroItems.length <= 1) return
    const t = setInterval(() => setIdx((i) => (i + 1) % heroItems.length), 10_000)
    return () => clearInterval(t)
  }, [heroItems.length])

  if (!heroItems.length) return null

  const current = heroItems[idx]

  return (
    <div className="relative h-72 mb-8 overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="absolute inset-0"
        >
          <img
            src={current.backdropUrl || current.posterUrl || ''}
            alt={current.title}
            className="w-full h-full object-cover"
          />
        </motion.div>
      </AnimatePresence>

      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a]/80 to-transparent" />

      <div className="absolute bottom-8 left-8 max-w-md">
        <h1 className="text-3xl font-black text-white mb-2 drop-shadow">{current.title}</h1>
        {current.overview && (
          <p className="text-white/60 text-sm line-clamp-2">{current.overview}</p>
        )}
        <button
          data-focusable
          onClick={() => onSelect(current)}
          className="mt-4 flex items-center gap-2 px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500
                     text-white font-semibold text-sm transition-colors"
        >
          <Play size={14} fill="white" />
          View Details
        </button>
      </div>

      {heroItems.length > 1 && (
        <>
          <button
            onClick={() => setIdx((i) => (i - 1 + heroItems.length) % heroItems.length)}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full
                       bg-black/50 flex items-center justify-center text-white/70
                       hover:text-white hover:bg-black/70 transition"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setIdx((i) => (i + 1) % heroItems.length)}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full
                       bg-black/50 flex items-center justify-center text-white/70
                       hover:text-white hover:bg-black/70 transition"
          >
            <ChevronRight size={16} />
          </button>

          {/* Pagination dots */}
          <div className="absolute bottom-4 right-4 flex gap-1.5">
            {heroItems.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
