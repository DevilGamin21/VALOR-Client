import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import MovieCard from './MovieCard'
import type { UnifiedMedia } from '@/types/media'

interface Props {
  title: string
  items: UnifiedMedia[]
  onPlay: (item: UnifiedMedia) => void
}

export default function MediaRow({ title, items, onPlay }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)

  function scroll(dir: 'left' | 'right') {
    rowRef.current?.scrollBy({ left: dir === 'left' ? -600 : 600, behavior: 'smooth' })
  }

  if (!items.length) return null

  return (
    <section className="mb-8">
      <h2 className="px-6 mb-3 text-base font-semibold text-white/80">{title}</h2>

      <div className="relative group/row">
        {/* Left arrow */}
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-0 bottom-0 z-30 w-12 flex items-center justify-center
                     bg-gradient-to-r from-eerie to-transparent
                     opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronLeft size={24} className="text-white drop-shadow" />
        </button>

        {/* Row */}
        <div
          ref={rowRef}
          className="flex gap-3 overflow-x-auto scroll-smooth px-6 pb-2 no-scrollbar"
          style={{ scrollbarWidth: 'none' }}
        >
          {items.map((item) => (
            <MovieCard key={`${item.id}-${item.type}`} item={item} onPlay={onPlay} />
          ))}
        </div>

        {/* Right arrow */}
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-0 bottom-0 z-30 w-12 flex items-center justify-center
                     bg-gradient-to-l from-eerie to-transparent
                     opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronRight size={24} className="text-white drop-shadow" />
        </button>
      </div>
    </section>
  )
}
