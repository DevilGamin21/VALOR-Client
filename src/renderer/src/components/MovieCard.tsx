import { useRef, useCallback } from 'react'
import { Play, Plus, Check, X } from 'lucide-react'
import { useWatchlist } from '@/contexts/WatchlistContext'
import { useTheme } from '@/contexts/ThemeContext'
import { pulseDynamicTheme } from '@/lib/dynamicTheme'
import type { UnifiedMedia } from '@/types/media'

interface Props {
  item: UnifiedMedia
  onPlay: (item: UnifiedMedia) => void
  onRemove?: (item: UnifiedMedia) => void
}

export default function MovieCard({ item, onPlay, onRemove }: Props) {
  const { ids, toggle } = useWatchlist()
  const { themeId } = useTheme()
  const inWatchlist = ids.has(item.id)

  const watched = item.playedPercentage != null && item.playedPercentage > 90
  const progress =
    item.playedPercentage && item.playedPercentage >= 5 && item.playedPercentage < 90
      ? item.playedPercentage
      : null

  // Dynamic-theme pulse — throttled to avoid strobing as the cursor scrubs
  // across a row. pulseDynamicTheme is a no-op unless themeId === 'dynamic'.
  const lastPulseAt = useRef(0)
  const handlePosterHover = useCallback(() => {
    const now = Date.now()
    if (now - lastPulseAt.current < 80) return
    lastPulseAt.current = now
    pulseDynamicTheme(item.posterUrl, themeId).catch(() => {})
  }, [item.posterUrl, themeId])

  function handleWatchlist(e: React.MouseEvent) {
    e.stopPropagation()
    toggle(item)
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    onRemove?.(item)
  }

  // Two-element pattern: outer frame anchors the layout bounds + every
  // overlay button (watchlist+, remove-from-CW, badges). Inner .poster-hover
  // div is the ONLY thing that scales — siblings of it never grow with the
  // card, so the watchlist+ button stays put regardless of CSS-var quirks.
  return (
    <div
      data-focusable
      className="group/card relative flex-shrink-0 w-36"
      onMouseEnter={handlePosterHover}
    >
      <div className="relative w-36 h-52">
        {/* The scaling poster. Click target lives here. */}
        <div
          className="poster-hover absolute inset-0 rounded-lg overflow-hidden bg-dark-card cursor-pointer"
          onClick={() => onPlay(item)}
        >
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

          {/* Progress bar — between 5% and 90% */}
          {progress !== null && (
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-white/20 z-10">
              <div className="h-full bg-white" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Hover overlay with play button — fades in with group hover */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
              <Play size={16} fill="black" className="text-black ml-0.5" />
            </div>
          </div>
        </div>

        {/* ─── Siblings of .poster-hover — never grow with the card ─── */}

        {/* Remove from Continue Watching (top-left) */}
        {onRemove && (
          <button
            data-focusable
            onClick={handleRemove}
            className="absolute top-2 left-2 z-20 w-7 h-7 rounded-full
                       bg-black/60 border border-white/20
                       flex items-center justify-center
                       opacity-0 group-hover/card:opacity-100 transition-opacity
                       hover:bg-red-500/40"
          >
            <X size={12} className="text-white" />
          </button>
        )}

        {/* Watchlist + (top-right) */}
        <button
          data-focusable
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

        {/* Bottom-left badges (Watched / Anime) */}
        {(watched || item.isAnime) && (
          <div className="absolute bottom-2 left-2 z-20 flex flex-col gap-1 pointer-events-none">
            {watched && (
              <span className="text-[9px] font-bold bg-emerald-500/90 text-white px-1.5 py-0.5 rounded uppercase tracking-wide">
                Watched
              </span>
            )}
            {item.isAnime && (
              <span className="text-[9px] font-bold bg-purple-500 text-white px-1.5 py-0.5 rounded uppercase tracking-wide">
                Anime
              </span>
            )}
          </div>
        )}
      </div>

      {/* Title & year — under the (unscaled) frame so they don't shift on hover */}
      <p className="mt-1.5 text-xs text-white/70 truncate leading-tight">{item.title}</p>
      {item.year && <p className="text-[10px] text-white/30">{item.year}</p>}
    </div>
  )
}
