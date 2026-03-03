import { AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Bookmark } from 'lucide-react'
import { useWatchlist } from '@/contexts/WatchlistContext'
import MovieCard from '@/components/MovieCard'
import PlayModal from '@/components/PlayModal'
import type { UnifiedMedia } from '@/types/media'

export default function Watchlist() {
  const { items } = useWatchlist()
  const [selected, setSelected] = useState<UnifiedMedia | null>(null)

  return (
    <div className="p-6 pb-8">
      <h1 className="text-xl font-bold text-white mb-6">Watchlist</h1>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-white/30">
          <Bookmark size={40} className="mb-3" />
          <p className="text-sm">Your watchlist is empty</p>
          <p className="text-xs mt-1">Click the + on any title to save it here</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          {items.map((item) => (
            <MovieCard key={`${item.id}-${item.type}`} item={item} onPlay={setSelected} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {selected && <PlayModal item={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
