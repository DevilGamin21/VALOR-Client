import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import * as api from '@/services/api'
import MediaRow from '@/components/MediaRow'
import PlayModal from '@/components/PlayModal'
import AnimeToggle from '@/components/AnimeToggle'
import OnDemandToggle from '@/components/OnDemandToggle'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'
import type { UnifiedMedia, TrendingResponse } from '@/types/media'

export default function Movies() {
  const { isOpen } = usePlayer()
  const { discordRPC } = useSettings()
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const animeOnly = searchParams.get('anime') === '1'
  const onDemandOnly = searchParams.get('ondemand') === '1'

  const [library, setLibrary] = useState<UnifiedMedia[]>([])
  const [trending, setTrending] = useState<TrendingResponse | null>(null)
  const [categories, setCategories] = useState<api.HomeCategories | null>(null)
  const [results, setResults] = useState<UnifiedMedia[]>([])
  const [selected, setSelected] = useState<UnifiedMedia | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isOpen || !discordRPC) return
    window.electronAPI.discord.setActivity({
      details: 'VALOR',
      state: 'Looking at movies to watch',
      largeImageKey: 'logo',
      largeImageText: 'VALOR',
    }).catch(() => {})
  }, [isOpen, discordRPC])

  useEffect(() => {
    setLoading(true)
    setCategories(null)
    if (q) {
      api
        .searchItems(q)
        .then((data) => setResults(data.filter((i) => i.type === 'movie')))
        .catch(console.error)
        .finally(() => setLoading(false))
    } else {
      Promise.all([
        api.getJellyfinLatest(80).then(items => items.filter(i => i.type === 'movie')),
        api.getTrending(),
      ])
        .then(([lib, t]) => {
          setLibrary(lib)
          setTrending(t)
        })
        .catch(console.error)
        .finally(() => {
          setLoading(false)
          // Load categories non-blocking after initial paint
          api.getHomeCategories().then(setCategories).catch(() => {})
        })
    }
  }, [q])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-red-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="pb-8 pt-6">
      {q ? (
        <div>
          <h1 className="px-6 text-lg font-bold text-white mb-6">
            Results for "{q}"
          </h1>
          {results.length === 0 ? (
            <p className="px-6 text-white/40 text-sm">No movies found.</p>
          ) : (
            <MediaRow title="" items={results} onPlay={setSelected} />
          )}
        </div>
      ) : (
        <>
          <div className="px-6 mb-4 flex items-center gap-3">
            <OnDemandToggle />
            <AnimeToggle />
          </div>
          {(() => {
            let filtered = library
            if (animeOnly) filtered = filtered.filter((i) => i.isAnime)
            if (onDemandOnly) filtered = filtered.filter((i) => i.onDemand)
            const title = animeOnly ? 'Anime Movies' : onDemandOnly ? 'On Demand Movies' : 'Library'
            return filtered.length > 0 ? (
              <MediaRow title={title} items={filtered} onPlay={setSelected} />
            ) : null
          })()}
          {!animeOnly && !onDemandOnly && trending?.movies && trending.movies.length > 0 && (
            <MediaRow title="Trending" items={trending.movies} onPlay={setSelected} />
          )}
          {!animeOnly && !onDemandOnly && categories?.topRatedMovies && categories.topRatedMovies.length > 0 && (
            <MediaRow title="Top Rated" items={categories.topRatedMovies} onPlay={setSelected} />
          )}
          {!animeOnly && !onDemandOnly && categories?.actionMovies && categories.actionMovies.length > 0 && (
            <MediaRow title="Action" items={categories.actionMovies} onPlay={setSelected} />
          )}
          {!animeOnly && !onDemandOnly && categories?.comedyMovies && categories.comedyMovies.length > 0 && (
            <MediaRow title="Comedy" items={categories.comedyMovies} onPlay={setSelected} />
          )}
          {library.length === 0 && !trending?.movies?.length && !categories && (
            <p className="px-6 text-white/40 text-sm">No movies available.</p>
          )}
          {animeOnly && library.filter((i) => i.isAnime).length === 0 && (
            <p className="px-6 text-white/40 text-sm">No anime movies found in library.</p>
          )}
          {onDemandOnly && !animeOnly && library.filter((i) => i.onDemand).length === 0 && (
            <p className="px-6 text-white/40 text-sm">No on demand movies found.</p>
          )}
        </>
      )}

      <AnimatePresence>
        {selected && <PlayModal item={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
