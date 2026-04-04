import { AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Bookmark } from 'lucide-react'
import { useWatchlist } from '@/contexts/WatchlistContext'
import MovieCard from '@/components/MovieCard'
import TvMediaCard from '@/components/tv/TvMediaCard'
import PlayModal from '@/components/PlayModal'
import { isTv } from '@/hooks/usePlatform'
import type { UnifiedMedia } from '@/types/media'

function Card({ item, onPlay }: { item: UnifiedMedia; onPlay: (i: UnifiedMedia) => void }) {
  return isTv
    ? <TvMediaCard item={item} onPlay={onPlay} />
    : <MovieCard item={item} onPlay={onPlay} />
}

// Extract tmdbId from synthetic TMDB IDs (e.g. "tmdb-movie-12345" → 12345)
function extractTmdbId(item: UnifiedMedia): UnifiedMedia {
  if (item.tmdbId) return item
  const match = String(item.id).match(/^tmdb-(?:movie|tv)-(\d+)$/)
  if (match) return { ...item, tmdbId: parseInt(match[1], 10) }
  return item
}

export default function Watchlist() {
  const { items } = useWatchlist()
  const [selected, setSelected] = useState<UnifiedMedia | null>(null)

  return (
    <div className={isTv ? 'px-6 py-8' : 'p-6 pb-8'}>
      <h1 className={`font-bold text-white mb-6 ${isTv ? 'text-2xl px-0' : 'text-xl'}`}>Watchlist</h1>

      {items.length === 0 ? (
        <div className={`flex flex-col items-center justify-center text-white/30 ${isTv ? 'h-96' : 'h-64'}`}>
          <Bookmark size={isTv ? 56 : 40} className="mb-3" />
          <p className={isTv ? 'text-base' : 'text-sm'}>Your watchlist is empty</p>
          <p className={`mt-1 ${isTv ? 'text-sm' : 'text-xs'}`}>Click the + on any title to save it here</p>
        </div>
      ) : (
        <div className={isTv ? 'tv-grid-6' : 'flex flex-wrap gap-4'}>
          {items.map((item) => (
            <Card key={`${item.id}-${item.type}`} item={item} onPlay={(i) => setSelected(extractTmdbId(i))} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {selected && <PlayModal item={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
