import TvMediaCard from './TvMediaCard'
import type { UnifiedMedia } from '@/types/media'
interface Props { title: string; items: UnifiedMedia[]; onPlay: (item: UnifiedMedia) => void }
export default function TvMediaRow({ title, items, onPlay }: Props) {
  if (!items.length) return null
  return (
    <section className="mb-6">
      <h2 className="tv-section-title">{title}</h2>
      <div className="flex gap-4 overflow-x-auto tv-no-scrollbar px-6 pb-2">
        {items.map((item) => <TvMediaCard key={`${item.id}-${item.type}`} item={item} onPlay={onPlay} />)}
      </div>
    </section>
  )
}
