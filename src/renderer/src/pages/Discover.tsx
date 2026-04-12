import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import * as api from '@/services/api'
import type { CollectionSummary, CollectionDetail } from '@/services/api'
import type { UnifiedMedia } from '@/types/media'
import MovieCard from '@/components/MovieCard'
import TvMediaCard from '@/components/tv/TvMediaCard'
import PlayModal from '@/components/tv/TvPlayModalWrapper'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'
import { platform } from '@/platform'
import { isTv } from '@/hooks/usePlatform'

type Tab = 'collections' | 'streaming' | 'recommendations'

const PROVIDERS = [
  { id: 8,    name: 'Netflix' },
  { id: 337,  name: 'Disney+' },
  { id: 9,    name: 'Amazon' },
  { id: 350,  name: 'Apple TV+' },
  { id: 531,  name: 'Paramount+' },
  { id: 39,   name: 'NOW' },
  { id: 29,   name: 'Sky Go' },
  { id: 283,  name: 'Crunchyroll' },
  { id: 1899, name: 'Max' },
]

function Card({ item, onPlay }: { item: UnifiedMedia; onPlay: (i: UnifiedMedia) => void }) {
  return isTv
    ? <TvMediaCard item={item} onPlay={onPlay} />
    : <MovieCard item={item} onPlay={onPlay} />
}

export default function Discover() {
  const { isOpen } = usePlayer()
  const { discordRPC } = useSettings()
  const [tab, setTab] = useState<Tab>('collections')
  const [selected, setSelected] = useState<UnifiedMedia | null>(null)

  useEffect(() => {
    if (isOpen || !discordRPC || !platform.supportsDiscord) return
    platform.discord.setActivity({
      details: 'VALOR',
      state: 'Browsing Discover',
      largeImageKey: 'logo',
      largeImageText: 'VALOR',
    }).catch(() => {})
  }, [isOpen, discordRPC])

  return (
    <div className={`pb-8 ${isTv ? 'pt-8' : 'pt-6'}`}>
      <h1 className={`px-6 font-bold text-white mb-4 ${isTv ? 'text-2xl' : 'text-lg'}`}>Discover</h1>

      {/* Tab bar */}
      <div className={`px-6 flex gap-2 mb-6 ${isTv ? 'gap-3' : ''}`}>
        {(['collections', 'streaming', 'recommendations'] as Tab[]).map((t) => (
          <button
            key={t}
            data-focusable
            onClick={() => setTab(t)}
            className={isTv
              ? `tv-chip ${tab === t ? 'tv-chip-selected' : ''}`
              : `px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  tab === t
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80'
                }`
            }
          >
            {t === 'collections' ? 'Collections' : t === 'streaming' ? 'Streaming Services' : 'Recommendations'}
          </button>
        ))}
      </div>

      {tab === 'collections' && <CollectionsTab onPlay={setSelected} />}
      {tab === 'streaming' && <StreamingTab onPlay={setSelected} />}
      {tab === 'recommendations' && <RecommendationsTab />}

      <AnimatePresence>
        {selected && <PlayModal item={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}

// ─── Collections Tab ──────────────────────────────────────────────────────────

function CollectionsTab({ onPlay }: { onPlay: (item: UnifiedMedia) => void }) {
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [expanded, setExpanded] = useState<CollectionSummary | null>(null)
  const [detail, setDetail] = useState<CollectionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    api.getCollections()
      .then(setCollections)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const openCollection = useCallback(async (col: CollectionSummary) => {
    setExpanded(col)
    setDetail(null)
    if (col.tmdbCollectionId) {
      setDetailLoading(true)
      try {
        const d = await api.getCollection(col.tmdbCollectionId)
        setDetail(d)
      } catch (err) {
        console.error('Failed to load collection', err)
      } finally {
        setDetailLoading(false)
      }
    }
  }, [])

  if (loading) return <Spinner />

  if (expanded) {
    return (
      <div className={isTv ? 'px-12' : 'px-6'}>
        <button
          data-focusable
          onClick={() => { setExpanded(null); setDetail(null) }}
          className={`flex items-center gap-1 text-white/50 hover:text-white mb-4 transition-colors ${isTv ? 'tv-btn-outline text-base py-2 px-4' : 'text-sm'}`}
        >
          <ChevronLeft size={16} /> Back to Collections
        </button>
        <h2 className={`text-white font-bold mb-4 ${isTv ? 'text-xl' : 'text-base'}`}>{expanded.name}</h2>
        {detailLoading ? (
          <Spinner />
        ) : detail ? (
          <>
            {detail.overview && (
              <p className={`text-white/50 mb-4 max-w-2xl ${isTv ? 'text-base' : 'text-sm'}`}>{detail.overview}</p>
            )}
            <div className={isTv ? 'tv-grid-6' : 'flex flex-wrap gap-4'}>
              {detail.items.map((item) => (
                <Card key={item.id} item={item} onPlay={onPlay} />
              ))}
            </div>
            {detail.items.length === 0 && (
              <p className={`text-white/40 ${isTv ? 'text-base' : 'text-sm'}`}>No items in this collection.</p>
            )}
          </>
        ) : (
          <p className={`text-white/40 ${isTv ? 'text-base' : 'text-sm'}`}>
            This collection doesn't have TMDB data. It contains {expanded.itemCount} item{expanded.itemCount !== 1 ? 's' : ''} in Jellyfin.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={isTv ? 'px-6' : 'px-6'}>
      {collections.length === 0 ? (
        <p className={`text-white/40 ${isTv ? 'text-base' : 'text-sm'}`}>No collections found.</p>
      ) : (
        <div className={isTv ? 'tv-grid-6' : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'}>
          {collections.map((col) => (
            <button
              key={col.id}
              data-focusable
              onClick={() => openCollection(col)}
              className={`group relative rounded-lg overflow-hidden text-left outline-none ${
                isTv
                  ? 'tv-card border-2 border-transparent'
                  : 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all'
              }`}
            >
              {col.posterUrl ? (
                <img src={col.posterUrl} alt={col.name} className="w-full aspect-[2/3] object-cover" loading="lazy" />
              ) : (
                <div className="w-full aspect-[2/3] flex items-center justify-center bg-white/5">
                  <span className="text-white/20 text-xs text-center px-2">{col.name}</span>
                </div>
              )}
              <div className="p-2">
                <p className={`text-white font-medium truncate ${isTv ? 'text-sm' : 'text-xs'}`}>{col.name}</p>
                <p className={`text-white/40 ${isTv ? 'text-xs' : 'text-[10px]'}`}>{col.itemCount} item{col.itemCount !== 1 ? 's' : ''}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Streaming Services Tab ───────────────────────────────────────────────────

function StreamingTab({ onPlay }: { onPlay: (item: UnifiedMedia) => void }) {
  const [provider, setProvider] = useState<number | null>(null)
  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie')
  const [results, setResults] = useState<UnifiedMedia[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (provider == null) return
    setLoading(true)
    api.discoverByProvider(mediaType, provider, page)
      .then((res) => {
        setResults(res.results ?? [])
        setTotalPages(res.totalPages ?? 1)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [provider, mediaType, page])

  return (
    <div className={isTv ? 'px-6' : 'px-6'}>
      {/* Provider buttons */}
      <div className={`flex flex-wrap gap-2 mb-4 ${isTv ? 'gap-3' : ''}`}>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            data-focusable
            onClick={() => { setProvider(p.id); setPage(1) }}
            className={isTv
              ? `tv-chip ${provider === p.id ? 'tv-chip-selected' : ''}`
              : `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  provider === p.id
                    ? 'bg-red-600 text-white'
                    : 'bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80'
                }`
            }
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Movie / TV toggle */}
      {provider != null && (
        <div className={`flex gap-2 mb-4 ${isTv ? 'gap-3' : ''}`}>
          {(['movie', 'tv'] as const).map((t) => (
            <button
              key={t}
              data-focusable
              onClick={() => { setMediaType(t); setPage(1) }}
              className={isTv
                ? `tv-chip ${mediaType === t ? 'tv-chip-selected' : ''}`
                : `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    mediaType === t
                      ? 'bg-white text-black'
                      : 'bg-white/10 text-white/50 hover:bg-white/15'
                  }`
              }
            >
              {t === 'movie' ? 'Movies' : 'TV Shows'}
            </button>
          ))}
        </div>
      )}

      {provider == null && (
        <p className={`text-white/40 ${isTv ? 'text-base' : 'text-sm'}`}>Select a streaming service to browse.</p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <>
          {results.length > 0 && (
            <div className={isTv ? 'tv-grid-6 mb-6' : 'flex flex-wrap gap-4 mb-6'}>
              {results.map((item) => (
                <Card key={item.id} item={item} onPlay={onPlay} />
              ))}
            </div>
          )}
          {provider != null && !loading && results.length === 0 && (
            <p className={`text-white/40 ${isTv ? 'text-base' : 'text-sm'}`}>No results found.</p>
          )}

          {/* Pagination */}
          {totalPages > 1 && results.length > 0 && (
            <div className="flex items-center justify-center gap-4 mt-2">
              <button
                data-focusable
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={isTv
                  ? 'tv-btn-outline p-3 disabled:opacity-30'
                  : 'p-2 rounded-lg bg-white/10 text-white/60 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed'
                }
              >
                <ChevronLeft size={16} />
              </button>
              <span className={`text-white/50 ${isTv ? 'text-base' : 'text-sm'}`}>
                Page {page} of {totalPages}
              </span>
              <button
                data-focusable
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={isTv
                  ? 'tv-btn-outline p-3 disabled:opacity-30'
                  : 'p-2 rounded-lg bg-white/10 text-white/60 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed'
                }
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Recommendations Tab ──────────────────────────────────────────────────────

function RecommendationsTab() {
  return (
    <div className={isTv ? 'px-12' : 'px-6'}>
      <div className={`rounded-xl border border-white/10 bg-white/5 text-center max-w-md mx-auto ${isTv ? 'p-12' : 'p-8'}`}>
        <p className={`text-white/70 font-medium mb-1 ${isTv ? 'text-lg' : 'text-sm'}`}>Recommendations</p>
        <p className={`text-white/40 ${isTv ? 'text-base' : 'text-xs'}`}>Coming soon — personalised picks based on your watch history.</p>
      </div>
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
    </div>
  )
}
