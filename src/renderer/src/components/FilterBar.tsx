import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, X } from 'lucide-react'

// ─── Genre definitions ───────────────────────────────────────────────────────

const MOVIE_GENRES = [
  { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' }, { id: 27, name: 'Horror' }, { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Sci-Fi' },
  { id: 53, name: 'Thriller' }, { id: 10752, name: 'War' }, { id: 37, name: 'Western' },
]

const TV_GENRES = [
  { id: 10759, name: 'Action & Adventure' }, { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 10762, name: 'Kids' },
  { id: 9648, name: 'Mystery' }, { id: 10764, name: 'Reality' },
  { id: 10765, name: 'Sci-Fi & Fantasy' }, { id: 53, name: 'Thriller' },
  { id: 10768, name: 'War & Politics' },
]

const RATING_OPTIONS = [
  { label: 'Any Rating', value: 0 },
  { label: '6+', value: 6 },
  { label: '7+', value: 7 },
  { label: '8+', value: 8 },
  { label: '9+', value: 9 },
]

const YEAR_OPTIONS = [
  { label: 'Any Year', value: '' },
  { label: '2026', value: '2026' }, { label: '2025', value: '2025' }, { label: '2024', value: '2024' },
  { label: '2020s', value: '2020s' }, { label: '2010s', value: '2010s' },
  { label: '2000s', value: '2000s' }, { label: '1990s', value: '1990s' }, { label: '1980s', value: '1980s' },
]

const LANGUAGE_OPTIONS = [
  { label: 'Any Language', value: '' },
  { label: 'English', value: 'en' }, { label: 'Hindi', value: 'hi' },
  { label: 'Korean', value: 'ko' }, { label: 'Japanese', value: 'ja' },
  { label: 'Tamil', value: 'ta' }, { label: 'Telugu', value: 'te' },
  { label: 'French', value: 'fr' }, { label: 'Spanish', value: 'es' },
  { label: 'German', value: 'de' }, { label: 'Italian', value: 'it' },
  { label: 'Chinese', value: 'zh' }, { label: 'Thai', value: 'th' },
  { label: 'Turkish', value: 'tr' }, { label: 'Portuguese', value: 'pt' },
  { label: 'Malayalam', value: 'ml' },
]

const SORT_OPTIONS = [
  { label: 'Popular', value: 'popularity' as const },
  { label: 'Highest Rated', value: 'rating' as const },
  { label: 'Newest', value: 'newest' as const },
  { label: 'A–Z', value: 'title' as const },
]

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FilterState {
  genres: number[]
  rating: number
  year: string
  language: string
  sort: 'popularity' | 'rating' | 'newest' | 'title'
  anime: boolean
}

export const DEFAULT_FILTERS: FilterState = {
  genres: [],
  rating: 0,
  year: '',
  language: '',
  sort: 'popularity',
  anime: false,
}

export function hasActiveFilters(f: FilterState): boolean {
  return f.genres.length > 0 || f.rating > 0 || f.year !== '' || f.language !== '' || f.sort !== 'popularity' || f.anime
}

interface Props {
  type: 'movie' | 'tv'
  filters: FilterState
  onChange: (filters: FilterState) => void
}

// ─── Dropdown helper ─────────────────────────────────────────────────────────

function Dropdown({ label, active, children }: { label: string; active: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        data-focusable
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
          active
            ? 'bg-red-600/20 text-red-400 border border-red-500/30'
            : 'bg-white/[0.06] text-white/50 hover:bg-white/[0.1] hover:text-white/70 border border-transparent'
        }`}
      >
        {label}
        <ChevronDown size={12} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] max-h-64 overflow-y-auto
                        bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-1">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── FilterBar ───────────────────────────────────────────────────────────────

export default function FilterBar({ type, filters, onChange }: Props) {
  const genres = type === 'movie' ? MOVIE_GENRES : TV_GENRES

  const toggleGenre = useCallback((id: number) => {
    const next = filters.genres.includes(id) ? filters.genres.filter(g => g !== id) : [...filters.genres, id]
    onChange({ ...filters, genres: next })
  }, [filters, onChange])

  const genreLabel = filters.genres.length === 0
    ? 'Genres'
    : filters.genres.length === 1
      ? genres.find(g => g.id === filters.genres[0])?.name || 'Genre'
      : `${filters.genres.length} Genres`

  const ratingLabel = filters.rating > 0 ? `${filters.rating}+` : 'Rating'
  const yearLabel = filters.year || 'Year'
  const langLabel = LANGUAGE_OPTIONS.find(l => l.value === filters.language)?.label || 'Language'
  const sortLabel = SORT_OPTIONS.find(s => s.value === filters.sort)?.label || 'Sort'

  const hasFilters = hasActiveFilters(filters)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Genres */}
      <Dropdown label={genreLabel} active={filters.genres.length > 0}>
        {genres.map(g => (
          <button
            key={g.id}
            onClick={() => toggleGenre(g.id)}
            className={`w-full text-left px-3 py-2 text-xs transition flex items-center gap-2 ${
              filters.genres.includes(g.id)
                ? 'text-red-400 bg-red-600/10'
                : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] ${
              filters.genres.includes(g.id) ? 'bg-red-600 border-red-600 text-white' : 'border-white/20'
            }`}>
              {filters.genres.includes(g.id) ? '✓' : ''}
            </span>
            {g.name}
          </button>
        ))}
      </Dropdown>

      {/* Rating */}
      <Dropdown label={ratingLabel} active={filters.rating > 0}>
        {RATING_OPTIONS.map(r => (
          <button
            key={r.value}
            onClick={() => onChange({ ...filters, rating: r.value })}
            className={`w-full text-left px-3 py-2 text-xs transition ${
              filters.rating === r.value ? 'text-red-400 bg-red-600/10' : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {r.label}
          </button>
        ))}
      </Dropdown>

      {/* Year */}
      <Dropdown label={yearLabel} active={filters.year !== ''}>
        {YEAR_OPTIONS.map(y => (
          <button
            key={y.value}
            onClick={() => onChange({ ...filters, year: y.value })}
            className={`w-full text-left px-3 py-2 text-xs transition ${
              filters.year === y.value ? 'text-red-400 bg-red-600/10' : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {y.label}
          </button>
        ))}
      </Dropdown>

      {/* Language */}
      <Dropdown label={langLabel} active={filters.language !== ''}>
        {LANGUAGE_OPTIONS.map(l => (
          <button
            key={l.value}
            onClick={() => onChange({ ...filters, language: l.value })}
            className={`w-full text-left px-3 py-2 text-xs transition ${
              filters.language === l.value ? 'text-red-400 bg-red-600/10' : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {l.label}
          </button>
        ))}
      </Dropdown>

      {/* Sort */}
      <Dropdown label={sortLabel} active={filters.sort !== 'popularity'}>
        {SORT_OPTIONS.map(s => (
          <button
            key={s.value}
            onClick={() => onChange({ ...filters, sort: s.value })}
            className={`w-full text-left px-3 py-2 text-xs transition ${
              filters.sort === s.value ? 'text-red-400 bg-red-600/10' : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {s.label}
          </button>
        ))}
      </Dropdown>

      {/* Anime toggle */}
      <button
        data-focusable
        onClick={() => onChange({ ...filters, anime: !filters.anime })}
        className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
          filters.anime
            ? 'bg-purple-600/20 text-purple-400 border-purple-500/30'
            : 'bg-white/[0.06] text-white/50 hover:bg-white/[0.1] hover:text-white/70 border-transparent'
        }`}
      >
        Anime
      </button>

      {/* Clear all */}
      {hasFilters && (
        <button
          data-focusable
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition"
        >
          <X size={11} />
          Clear
        </button>
      )}
    </div>
  )
}
