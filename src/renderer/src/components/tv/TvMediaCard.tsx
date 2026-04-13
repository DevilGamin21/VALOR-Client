import type { UnifiedMedia } from '@/types/media'
interface Props { item: UnifiedMedia; onPlay: (item: UnifiedMedia) => void }
export default function TvMediaCard({ item, onPlay }: Props) {
  const watched = item.playedPercentage != null && item.playedPercentage > 90
  const progress = item.playedPercentage && item.playedPercentage >= 5 && item.playedPercentage < 90 ? item.playedPercentage : null
  return (
    <div data-focusable className="tv-card flex-shrink-0 rounded-lg overflow-hidden cursor-pointer" style={{ width: 150 }} onClick={() => onPlay(item)}>
      <div className="relative bg-[#1a1a1a] overflow-hidden" style={{ aspectRatio: '2/3' }}>
        {item.posterUrl ? <img src={item.posterUrl} alt={item.title} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center"><span className="text-3xl font-bold text-white/[0.08]">{item.title[0]}</span></div>}
        {progress !== null && <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20"><div className="h-full bg-red-600" style={{ width: `${progress}%` }} /></div>}
        {watched && <span className="absolute top-1.5 right-1.5 text-[9px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded">Watched</span>}
      </div>
      <p className="mt-1.5 text-xs text-white/70 truncate px-0.5">{item.title}</p>
    </div>
  )
}
