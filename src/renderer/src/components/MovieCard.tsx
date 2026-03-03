import { motion } from 'framer-motion'
import { Play, Plus, Check } from 'lucide-react'
import { useWatchlist } from '@/contexts/WatchlistContext'
import type { UnifiedMedia } from '@/types/media'

interface Props {
  item: UnifiedMedia
  onPlay: (item: UnifiedMedia) => void
}

export default function MovieCard({ item, onPlay }: Props) {
  const { ids, toggle } = useWatchlist()
  const inWatchlist = ids.has(item.id)

  const progress =
    item.playedPercentage && item.playedPercentage >= 5 && item.playedPercentage < 90
      ? item.playedPercentage
      : null

  function handleWatchlist(e: React.MouseEvent) {
    e.stopPropagation()
    toggle(item)
  }

  return (
    <motion.div
      data-focusable
      className="relative flex-shrink-0 w-36 cursor-pointer group/card"
      whileHover={{ scale: 1.05, zIndex: 10 }}
      transition={{ duration: 0.2 }}
      onClick={() => onPlay(item)}
    >
      {/* Poster */}
      <div className="relative w-36 h-52 rounded-lg overflow-hidden bg-dark-card">
        {progress !== null && (
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-white/20 z-10">
            <div
              className="h-full bg-white"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-dark-card">
            <span className="text-white/20 text-xs text-center px-2">{item.title}</span>
          </div>
        )}

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
            <Play size={16} fill="black" className="text-black ml-0.5" />
          </div>
        </div>

        {/* Watchlist toggle */}
        <button
          onClick={handleWatchlist}
          className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full
                     bg-black/60 border border-white/20
                     flex items-center justify-center
                     opacity-0 group-hover/card:opacity-100 transition-opacity
                     hover:bg-white/20"
        >
          {inWatchlist ? (
            <Check size={12} className="text-green-400" />
          ) : (
            <Plus size={12} className="text-white" />
          )}
        </button>

        {/* On demand badge */}
        {item.onDemand && (
          <span className="absolute bottom-2 left-2 z-10 text-[9px] font-bold
                           bg-white text-black px-1.5 py-0.5 rounded uppercase tracking-wide">
            On Demand
          </span>
        )}
      </div>

      {/* Title */}
      <p className="mt-1.5 text-xs text-white/70 truncate leading-tight">{item.title}</p>
      {item.year && <p className="text-[10px] text-white/30">{item.year}</p>}
    </motion.div>
  )
}
