import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import * as api from '@/services/api'
import MediaRow from '@/components/MediaRow'
import PlayModal from '@/components/PlayModal'
import AnimeToggle from '@/components/AnimeToggle'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'
import type { UnifiedMedia, TrendingResponse } from '@/types/media'

export default function Movies() {
  const { isOpen } = usePlayer()
  const { discordRPC } = useSettings()
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const animeOnly = searchParams.get('anime') === '1'

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
      api.getTrending()
        .then(setTrending)
        .catch(console.error)
        .finally(() => {
          setLoading(false)
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
            Results for &quot;{q}&quot;
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
            <AnimeToggle />
          </div>
          {!animeOnly && trending?.movies && trending.movies.length > 0 && (
            <MediaRow title="Trending" items={trending.movies} onPlay={setSelected} />
          )}
          {!animeOnly && categories?.topRatedMovies && categories.topRatedMovies.length > 0 && (
            <MediaRow title="Top Rated" items={categories.topRatedMovies} onPlay={setSelected} />
          )}
          {!animeOnly && categories?.actionMovies && categories.actionMovies.length > 0 && (
            <MediaRow title="Action" items={categories.actionMovies} onPlay={setSelected} />
          )}
          {!animeOnly && categories?.comedyMovies && categories.comedyMovies.length > 0 && (
            <MediaRow title="Comedy" items={categories.comedyMovies} onPlay={setSelected} />
          )}
          {animeOnly && trending?.movies && (
            (() => {
              const animeMovies = trending.movies.filter((i) => i.isAnime)
              return animeMovies.length > 0 ? (
                <MediaRow title="Anime Movies" items={animeMovies} onPlay={setSelected} />
              ) : (
                <p className="px-6 text-white/40 text-sm">No anime movies found.</p>
              )
            })()
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
