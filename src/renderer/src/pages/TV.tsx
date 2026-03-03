import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import * as api from '@/services/api'
import MediaRow from '@/components/MediaRow'
import PlayModal from '@/components/PlayModal'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'
import type { UnifiedMedia, TrendingResponse } from '@/types/media'

export default function TV() {
  const { isOpen } = usePlayer()
  const { discordRPC } = useSettings()
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''

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
      Promise.all([
        api.getJellyfinLatest(80).then(items => items.filter(i => i.type === 'tv')),
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
            <p className="px-6 text-white/40 text-sm">No TV shows found.</p>
          ) : (
            <MediaRow title="" items={results} onPlay={setSelected} />
          )}
        </div>
      ) : (
        <>
          {library.length > 0 && (
            <MediaRow title="Library" items={library} onPlay={setSelected} />
          )}
          {trending?.tv && trending.tv.length > 0 && (
            <MediaRow title="Trending" items={trending.tv} onPlay={setSelected} />
          )}
          {categories?.topRatedTv && categories.topRatedTv.length > 0 && (
            <MediaRow title="Top Rated" items={categories.topRatedTv} onPlay={setSelected} />
          )}
          {categories?.sciFiTv && categories.sciFiTv.length > 0 && (
            <MediaRow title="Sci-Fi & Fantasy" items={categories.sciFiTv} onPlay={setSelected} />
          )}
          {library.length === 0 && !trending?.tv?.length && !categories && (
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
