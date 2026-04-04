import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import * as api from '@/services/api'
import MediaRow from '@/components/MediaRow'
import MovieCard from '@/components/MovieCard'
import PlayModal from '@/components/PlayModal'
import FilterBar, { type FilterState, DEFAULT_FILTERS, hasActiveFilters } from '@/components/FilterBar'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'
import type { UnifiedMedia, TrendingResponse } from '@/types/media'

export default function Movies() {
  const { isOpen } = usePlayer()
  const { discordRPC } = useSettings()
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''

  // Category rows (default view)
  const [trending, setTrending] = useState<TrendingResponse | null>(null)
  const [categories, setCategories] = useState<api.HomeCategories | null>(null)
  const [searchResults, setSearchResults] = useState<UnifiedMedia[]>([])
  const [loading, setLoading] = useState(true)

  // Filter state
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [browseResults, setBrowseResults] = useState<UnifiedMedia[]>([])
  const [browsePage, setBrowsePage] = useState(1)
  const [browseTotalPages, setBrowseTotalPages] = useState(1)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false)
  const filterActive = hasActiveFilters(filters)

  const [selected, setSelected] = useState<UnifiedMedia | null>(null)

  // Discord RPC
  useEffect(() => {
    if (isOpen || !discordRPC) return
    window.electronAPI.discord.setActivity({
      details: 'VALOR',
      state: 'Looking at movies to watch',
      largeImageKey: 'logo',
      largeImageText: 'VALOR',
    }).catch(() => {})
  }, [isOpen, discordRPC])

  // Load category rows (default view)
  useEffect(() => {
    if (q || filterActive) return
    setLoading(true)
    setCategories(null)
    api.getTrending()
      .then(setTrending)
      .catch(console.error)
      .finally(() => {
        setLoading(false)
        api.getHomeCategories().then(setCategories).catch(() => {})
      })
  }, [q, filterActive])

  // Search
  useEffect(() => {
    if (!q) return
    setLoading(true)
    api.searchItems(q)
      .then((data) => setSearchResults(data.filter((i) => i.type === 'movie')))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [q])

  // Browse with filters
  const browseAbort = useRef(0)
  useEffect(() => {
    if (!filterActive || q) return
    const id = ++browseAbort.current
    setBrowseLoading(true)
    setBrowseResults([])
    setBrowsePage(1)
    api.browse({
      type: 'movie',
      genres: filters.genres.length ? filters.genres.join(',') : undefined,
      rating: filters.rating || undefined,
      anime: filters.anime || undefined,
      year: filters.year || undefined,
      language: filters.language || undefined,
      sort: filters.sort,
      page: 1,
    }).then((res) => {
      if (id !== browseAbort.current) return
      setBrowseResults(res.items)
      setBrowseTotalPages(res.totalPages)
    }).catch(console.error).finally(() => {
      if (id === browseAbort.current) setBrowseLoading(false)
    })
  }, [filters, filterActive, q])

  const loadMore = useCallback(() => {
    if (browseLoadingMore || browsePage >= browseTotalPages) return
    const nextPage = browsePage + 1
    setBrowseLoadingMore(true)
    api.browse({
      type: 'movie',
      genres: filters.genres.length ? filters.genres.join(',') : undefined,
      rating: filters.rating || undefined,
      anime: filters.anime || undefined,
      year: filters.year || undefined,
      language: filters.language || undefined,
      sort: filters.sort,
      page: nextPage,
    }).then((res) => {
      setBrowseResults(prev => [...prev, ...res.items])
      setBrowsePage(nextPage)
      setBrowseTotalPages(res.totalPages)
    }).catch(console.error).finally(() => setBrowseLoadingMore(false))
  }, [browseLoadingMore, browsePage, browseTotalPages, filters])

  if (loading && !filterActive) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-red-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="pb-8 pt-6">
      {/* Filter bar — always visible */}
      {!q && (
        <div className="px-6 mb-5">
          <FilterBar type="movie" filters={filters} onChange={setFilters} />
        </div>
      )}

      {q ? (
        /* Search results */
        <div>
          <h1 className="px-6 text-lg font-bold text-white mb-6">
            Results for &quot;{q}&quot;
          </h1>
          {searchResults.length === 0 ? (
            <p className="px-6 text-white/40 text-sm">No movies found.</p>
          ) : (
            <MediaRow title="" items={searchResults} onPlay={setSelected} />
          )}
        </div>
      ) : filterActive ? (
        /* Filtered browse results — grid layout */
        <div className="px-6">
          {browseLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={24} className="animate-spin text-white/30" />
            </div>
          ) : browseResults.length === 0 ? (
            <p className="text-white/40 text-sm text-center py-12">No movies match your filters.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-4">
                {browseResults.map((item) => (
                  <MovieCard key={`${item.id}-${item.type}`} item={item} onPlay={setSelected} />
                ))}
              </div>
              {browsePage < browseTotalPages && (
                <div className="flex justify-center mt-6">
                  <button
                    data-focusable
                    onClick={loadMore}
                    disabled={browseLoadingMore}
                    className="px-6 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white/60 text-sm transition disabled:opacity-40"
                  >
                    {browseLoadingMore ? <Loader2 size={16} className="animate-spin mx-4" /> : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* Default category rows */
        <>
          {trending?.movies && trending.movies.length > 0 && (
            <MediaRow title="Trending" items={trending.movies} onPlay={setSelected} />
          )}
          {categories?.nowPlayingMovies && categories.nowPlayingMovies.length > 0 && (
            <MediaRow title="Now Playing" items={categories.nowPlayingMovies} onPlay={setSelected} />
          )}
          {categories?.topRatedMovies && categories.topRatedMovies.length > 0 && (
            <MediaRow title="Top Rated" items={categories.topRatedMovies} onPlay={setSelected} />
          )}
          {categories?.actionMovies && categories.actionMovies.length > 0 && (
            <MediaRow title="Action" items={categories.actionMovies} onPlay={setSelected} />
          )}
          {categories?.comedyMovies && categories.comedyMovies.length > 0 && (
            <MediaRow title="Comedy" items={categories.comedyMovies} onPlay={setSelected} />
          )}
          {categories?.horrorMovies && categories.horrorMovies.length > 0 && (
            <MediaRow title="Horror" items={categories.horrorMovies} onPlay={setSelected} />
          )}
          {categories?.thrillerMovies && categories.thrillerMovies.length > 0 && (
            <MediaRow title="Thriller" items={categories.thrillerMovies} onPlay={setSelected} />
          )}
          {categories?.dramaMovies && categories.dramaMovies.length > 0 && (
            <MediaRow title="Drama" items={categories.dramaMovies} onPlay={setSelected} />
          )}
          {categories?.romanceMovies && categories.romanceMovies.length > 0 && (
            <MediaRow title="Romance" items={categories.romanceMovies} onPlay={setSelected} />
          )}
          {categories?.animationMovies && categories.animationMovies.length > 0 && (
            <MediaRow title="Animation" items={categories.animationMovies} onPlay={setSelected} />
          )}
          {categories?.documentaryMovies && categories.documentaryMovies.length > 0 && (
            <MediaRow title="Documentaries" items={categories.documentaryMovies} onPlay={setSelected} />
          )}
          {categories?.familyMovies && categories.familyMovies.length > 0 && (
            <MediaRow title="Family" items={categories.familyMovies} onPlay={setSelected} />
          )}
          {categories?.upcomingMovies && categories.upcomingMovies.length > 0 && (
            <MediaRow title="Upcoming" items={categories.upcomingMovies} onPlay={setSelected} />
          )}
          {!trending?.movies?.length && !categories && (
            <p className="px-6 text-white/40 text-sm">No movies available.</p>
          )}
        </>
      )}

      <AnimatePresence>
        {selected && <PlayModal item={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
