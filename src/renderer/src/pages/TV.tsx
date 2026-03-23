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

export default function TV() {
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
      state: 'Looking for a show',
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
        .then((data) => setResults(data.filter((i) => i.type === 'tv')))
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
            <p className="px-6 text-white/40 text-sm">No TV shows found.</p>
          ) : (
            <MediaRow title="" items={results} onPlay={setSelected} />
          )}
        </div>
      ) : (
        <>
          <div className="px-6 mb-4 flex items-center gap-3">
            <AnimeToggle />
          </div>
          {!animeOnly && trending?.tv && trending.tv.length > 0 && (
            <MediaRow title="Trending" items={trending.tv} onPlay={setSelected} />
          )}
          {!animeOnly && categories?.topRatedTv && categories.topRatedTv.length > 0 && (
            <MediaRow title="Top Rated" items={categories.topRatedTv} onPlay={setSelected} />
          )}
          {!animeOnly && categories?.sciFiTv && categories.sciFiTv.length > 0 && (
            <MediaRow title="Sci-Fi & Fantasy" items={categories.sciFiTv} onPlay={setSelected} />
          )}
          {animeOnly && trending?.tv && (
            (() => {
              const animeShows = trending.tv.filter((i) => i.isAnime)
              return animeShows.length > 0 ? (
                <MediaRow title="Anime Shows" items={animeShows} onPlay={setSelected} />
              ) : (
                <p className="px-6 text-white/40 text-sm">No anime shows found.</p>
              )
            })()
          )}
          {!trending?.tv?.length && !categories && (
            <p className="px-6 text-white/40 text-sm">No TV shows available.</p>
          )}
        </>
      )}

      <AnimatePresence>
        {selected && <PlayModal item={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
