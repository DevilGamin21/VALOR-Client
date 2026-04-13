import { useState, useEffect } from 'react'
import type { UnifiedMedia } from '@/types/media'
interface Props { items: UnifiedMedia[]; onSelect: (item: UnifiedMedia) => void }
export default function TvHero({ items, onSelect }: Props) {
  const heroes = items.filter(i => i.backdropUrl).slice(0, 5)
  const [idx, setIdx] = useState(0)
  useEffect(() => { if (heroes.length <= 1) return; const t = setInterval(() => setIdx(i => (i + 1) % heroes.length), 10_000); return () => clearInterval(t) }, [heroes.length])
  const item = heroes[idx]
  if (!item) return null
  return (
    <div className="relative w-full overflow-hidden" style={{ height: 360 }}>
      <img src={item.backdropUrl!} alt="" className="w-full h-full object-cover" />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent, rgba(10,10,10,0.4), #0A0A0A)' }} />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(10,10,10,0.8), transparent)', width: '50%' }} />
      <div className="absolute bottom-8 left-6 max-w-[45%]">
        <h2 className="text-3xl font-bold text-white leading-tight">{item.title}</h2>
        <div className="flex items-center gap-2 mt-2 text-sm text-white/50">{item.year && <span>{item.year}</span>}<span className="uppercase text-xs">{item.type}</span></div>
        {item.overview && <p className="mt-2 text-sm text-white/60 line-clamp-2">{item.overview}</p>}
        <button data-focusable onClick={() => onSelect(item)} className="tv-btn-primary mt-4 px-6 py-2.5 text-sm">More Info</button>
      </div>
      {heroes.length > 1 && <div className="absolute bottom-4 right-6 flex gap-1.5">{heroes.map((_, i) => <div key={i} className={`h-1 rounded-full transition-all ${i === idx ? 'w-6 bg-red-600' : 'w-2 bg-white/30'}`} />)}</div>}
    </div>
  )
}
