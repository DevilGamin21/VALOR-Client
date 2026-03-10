import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import {
  RefreshCw, RotateCcw, Trash2, Loader2, Play, Minus, Plus,
  ChevronDown, ChevronRight, Search, Film, Tv2, Download,
  Check, X, Clock, HardDriveDownload, Users, Shield,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import * as api from '@/services/api'

// ─── Types ───────────────────────────────────────────────────────────────────

type PrunaItem = {
  id: string
  title: string
  type: string
  state: string
  imdbId: string | null
  year: number | null
  isAnime: boolean
  stateUpdatedAt: string | null
  createdAt: string | null
  torrent?: { title?: string; quality?: string; seeders?: number; size?: number }
  realDebrid?: { progress?: number; speed?: number; status?: string }
  symlinks?: { paths?: string[]; fileCount?: number }
  episodes?: Record<string, {
    state: string; symlinkPath?: string; rdTorrentId?: string
    quality?: string; season?: number; episode?: number
  }>
  error?: string | null
  activeEpisodes?: { active: number; total: number; states: Record<string, number> } | null
}

type DashboardData = {
  success: boolean
  stateCounts: Record<string, number>
  activeItems: PrunaItem[]
  completedItems: PrunaItem[]
  failedItems: PrunaItem[]
  timestamp: string
}

type QueueData = {
  maxActive: number
  activeCount: number
  queued: Array<{ id: string; title: string; type: string; createdAt: string; position: number }>
}

type LibraryItem = PrunaItem & {
  source?: 'pruna' | 'filesystem'
  category?: string
  folderPath?: string
  tmdbId?: number | null
  episodeCount?: number
}

type OngoingShow = {
  imdbId: string
  tmdbId: number | null
  title: string
  year: number | null
  isAnime: boolean
  lastCheckedAt: string | null
  lastKnownEpisode: { season: number; episode: number } | null
  enabled: boolean
}

type EpisodeInfo = {
  episodeNumber: number
  title: string | null
  airDate: string | null
  aired: boolean
  installed: boolean
  symlinkPath: string | null
  episodeKey: string
  prunaState: string | null
  quality: string | null
}

type SeasonInfo = {
  seasonNumber: number
  title: string | null
  episodes: EpisodeInfo[]
}

type TorrentResult = {
  title: string
  magnetUri: string
  seeders: number
  size: number
  quality: string | null
  source: string
  indexer?: string
  score: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  installed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  symlinking: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  waiting_zurg: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  downloading: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  scraping: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  requested: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  paused: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  episodes_processing: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
}

function StateBadge({ state }: { state: string }) {
  const color = STATE_COLORS[state] || 'bg-white/10 text-white/60 border-white/20'
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${color}`}>
      {state.replace(/_/g, ' ')}
    </span>
  )
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
      {type === 'movie' ? 'Movie' : type === 'tv' ? 'TV' : type}
    </span>
  )
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 0) return 'just now'
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}

function formatSpeed(bytesPerSec: number | undefined): string {
  if (!bytesPerSec) return ''
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

function SectionHeader({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">
        {title}
        {count != null && <span className="ml-2 text-white/40 font-normal">({count})</span>}
      </h2>
      {children}
    </div>
  )
}

// ─── Episode Manager ─────────────────────────────────────────────────────────

function EpisodeManager({
  item,
  onRefetchEpisode,
  onDeleteEpisode,
  onRefreshLibrary,
}: {
  item: LibraryItem
  onRefetchEpisode: (itemId: string, epKey: string, mode: string) => Promise<void>
  onDeleteEpisode: (itemId: string, epKey: string) => Promise<void>
  onRefreshLibrary: () => void
}) {
  const [seasons, setSeasons] = useState<SeasonInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [torrentPickerEp, setTorrentPickerEp] = useState<{ seasonNum: number; episodeNum: number; epKey: string } | null>(null)
  const [torrents, setTorrents] = useState<TorrentResult[]>([])
  const [torrentsLoading, setTorrentsLoading] = useState(false)
  const [installMagnetLoading, setInstallMagnetLoading] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getPrunaLibraryEpisodes(item.id, item.tmdbId ?? undefined)
      .then((data) => {
        if (!cancelled && (data as { success?: boolean }).success) {
          const s = (data as { seasons?: SeasonInfo[] }).seasons || []
          setSeasons(s)
          if (s.length > 0) setExpandedSeason(s[0].seasonNumber)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [item.id, item.tmdbId])

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const selectAllMissing = (seasonNum: number) => {
    const season = seasons.find((s) => s.seasonNumber === seasonNum)
    if (!season) return
    setSelected((prev) => {
      const next = new Set(prev)
      for (const ep of season.episodes) {
        if (!ep.installed && ep.aired && !ep.prunaState) next.add(ep.episodeKey)
      }
      return next
    })
  }

  const handleSearchSelected = async () => {
    if (selected.size === 0) return
    setSearching(true)
    try {
      const episodes = Array.from(selected).map((key) => {
        const m = key.match(/S(\d+)E(\d+)/)
        return { seasonNum: parseInt(m![1], 10), episodeNum: parseInt(m![2], 10) }
      })
      await api.prunaSearchEpisodes(item.id, { episodes, tmdbId: item.tmdbId })
      setSelected(new Set())
      onRefreshLibrary()
    } catch { /* ignore */ }
    finally { setSearching(false) }
  }

  const handleSearchSeason = async (seasonNum: number) => {
    setSearching(true)
    try {
      await api.prunaSearchEpisodes(item.id, { season: seasonNum, tmdbId: item.tmdbId })
      onRefreshLibrary()
    } catch { /* ignore */ }
    finally { setSearching(false) }
  }

  const handleDelete = async (epKey: string) => {
    if (!confirm(`Delete ${epKey}?`)) return
    setActionLoading(epKey)
    try { await onDeleteEpisode(item.id, epKey) }
    finally { setActionLoading(null) }
  }

  const handleRefetch = async (epKey: string) => {
    setActionLoading(epKey)
    try { await onRefetchEpisode(item.id, epKey, 'new_search') }
    finally { setActionLoading(null) }
  }

  const handleSearchTorrents = async (seasonNum: number, episodeNum: number, epKey: string) => {
    setTorrentPickerEp({ seasonNum, episodeNum, epKey })
    setTorrents([])
    setTorrentsLoading(true)
    try {
      const data = await api.prunaSearchTorrents(item.id, { seasonNum, episodeNum, tmdbId: item.tmdbId }) as { success?: boolean; torrents?: TorrentResult[] }
      if (data.success) setTorrents(data.torrents || [])
    } catch { /* ignore */ }
    finally { setTorrentsLoading(false) }
  }

  const handleInstallMagnet = async (magnetUri: string, quality: string | null) => {
    if (!torrentPickerEp) return
    setInstallMagnetLoading(magnetUri)
    try {
      await api.prunaInstallMagnet(item.id, {
        seasonNum: torrentPickerEp.seasonNum,
        episodeNum: torrentPickerEp.episodeNum,
        magnetUri, quality, tmdbId: item.tmdbId,
      })
      setTorrentPickerEp(null)
      setTorrents([])
      onRefreshLibrary()
    } catch { /* ignore */ }
    finally { setInstallMagnetLoading(null) }
  }

  if (loading) {
    return (
      <tr>
        <td colSpan={5} className="py-4 text-center">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2 text-white/40" />
          <span className="text-xs text-white/40">Loading episodes...</span>
        </td>
      </tr>
    )
  }

  if (seasons.length === 0) {
    return (
      <tr>
        <td colSpan={5} className="py-3 pl-10 text-xs text-white/30">
          No episode data available. {!item.tmdbId && 'Link a TMDB ID to see full episode list.'}
        </td>
      </tr>
    )
  }

  return (
    <>
      {selected.size > 0 && (
        <tr className="bg-blue-500/10 border-b border-blue-500/20">
          <td colSpan={5} className="py-2 px-4">
            <div className="flex items-center gap-3">
              <span className="text-xs text-blue-400">{selected.size} episode{selected.size > 1 ? 's' : ''} selected</span>
              <button
                onClick={handleSearchSelected}
                disabled={searching}
                className="px-3 py-1 text-xs font-medium rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
              >
                {searching ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : <Download className="w-3 h-3 inline mr-1" />}
                Search Selected
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-white/40 hover:text-white/70">
                Clear
              </button>
            </div>
          </td>
        </tr>
      )}
      {seasons.map((season) => {
        const isExpanded = expandedSeason === season.seasonNumber
        const installedCount = season.episodes.filter((e) => e.installed).length
        const totalCount = season.episodes.length
        const missingAired = season.episodes.filter((e) => !e.installed && e.aired && !e.prunaState).length

        return (
          <tr key={`season-${season.seasonNumber}`} className="border-b border-white/5">
            <td colSpan={5} className="p-0">
              <button
                onClick={() => setExpandedSeason(isExpanded ? null : season.seasonNumber)}
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/5 transition-colors text-left"
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-white/40" /> : <ChevronRight className="w-3.5 h-3.5 text-white/40" />}
                <span className="text-xs font-medium text-white/70">{season.title || `Season ${season.seasonNumber}`}</span>
                <span className="text-[10px] text-white/30 tabular-nums">{installedCount}/{totalCount}</span>
                {missingAired > 0 && <span className="text-[10px] text-yellow-400/70 ml-auto">{missingAired} missing</span>}
              </button>

              {isExpanded && (
                <div className="bg-white/[0.02]">
                  {missingAired > 0 && (
                    <div className="flex items-center gap-2 px-6 py-1.5 border-t border-white/5">
                      <button onClick={() => selectAllMissing(season.seasonNumber)} className="text-[10px] text-blue-400/70 hover:text-blue-400 transition-colors">
                        Select all missing
                      </button>
                      <span className="text-white/10">|</span>
                      <button
                        onClick={() => handleSearchSeason(season.seasonNumber)}
                        disabled={searching}
                        className="text-[10px] text-blue-400/70 hover:text-blue-400 transition-colors disabled:opacity-50"
                      >
                        {searching ? 'Searching...' : 'Search entire season'}
                      </button>
                    </div>
                  )}
                  {season.episodes.map((ep) => {
                    const isActive = ep.prunaState && !['installed', 'completed'].includes(ep.prunaState)
                    const isFailed = ep.prunaState === 'failed'
                    const isMissingAired = !ep.installed && ep.aired && !isActive
                    const isPickerOpen = torrentPickerEp?.epKey === ep.episodeKey
                    return (
                      <div key={ep.episodeKey}>
                        <div className="flex items-center gap-2 px-6 py-1.5 border-t border-white/5 hover:bg-white/5 transition-colors">
                          {isMissingAired ? (
                            <button
                              onClick={() => toggleSelect(ep.episodeKey)}
                              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                selected.has(ep.episodeKey)
                                  ? 'bg-blue-500 border-blue-500'
                                  : 'border-white/20 hover:border-white/40'
                              }`}
                            >
                              {selected.has(ep.episodeKey) && <Check className="w-2.5 h-2.5 text-white" />}
                            </button>
                          ) : (
                            <div className="w-4 h-4 flex items-center justify-center">
                              {ep.installed ? <Check className="w-3 h-3 text-emerald-400" /> :
                               isActive ? <Loader2 className="w-3 h-3 animate-spin text-blue-400" /> :
                               !ep.aired ? <Clock className="w-3 h-3 text-white/20" /> :
                               <X className="w-3 h-3 text-white/20" />}
                            </div>
                          )}
                          <span className={`w-14 text-[11px] font-mono tabular-nums ${
                            ep.installed ? 'text-emerald-400' : isActive ? 'text-blue-400' : 'text-white/40'
                          }`}>{ep.episodeKey}</span>
                          <span className="flex-1 text-xs text-white/60 truncate min-w-0">{ep.title || ''}</span>
                          {ep.airDate && <span className="text-[10px] text-white/20 tabular-nums whitespace-nowrap">{ep.airDate}</span>}
                          {isActive && <StateBadge state={ep.prunaState!} />}
                          {isFailed && <StateBadge state="failed" />}
                          {ep.quality && <span className="text-[10px] text-white/30">{ep.quality}</span>}
                          {isMissingAired && (
                            <button
                              onClick={() => isPickerOpen ? setTorrentPickerEp(null) : handleSearchTorrents(season.seasonNumber, ep.episodeNumber, ep.episodeKey)}
                              className={`p-0.5 rounded transition-colors ${isPickerOpen ? 'text-blue-400' : 'text-white/30 hover:text-blue-400'}`}
                              title="Search torrents"
                            >
                              <Search className="w-3 h-3" />
                            </button>
                          )}
                          {ep.installed && (
                            <div className="flex gap-1 ml-1">
                              <button
                                onClick={() => handleRefetch(ep.episodeKey)}
                                disabled={actionLoading === ep.episodeKey}
                                className="p-0.5 rounded text-white/30 hover:text-white/70 disabled:opacity-40 transition-colors"
                                title="Refetch"
                              >
                                {actionLoading === ep.episodeKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                              </button>
                              <button
                                onClick={() => handleDelete(ep.episodeKey)}
                                disabled={actionLoading === ep.episodeKey}
                                className="p-0.5 rounded text-white/30 hover:text-red-400 disabled:opacity-40 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {isPickerOpen && (
                          <div className="mx-6 mb-1 rounded-lg bg-[#111] border border-white/10 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                              <span className="text-xs font-medium text-white/70">Torrents for {ep.episodeKey}</span>
                              <button onClick={() => setTorrentPickerEp(null)} className="text-white/30 hover:text-white/70">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {torrentsLoading ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="w-4 h-4 animate-spin text-white/40 mr-2" />
                                <span className="text-xs text-white/40">Searching...</span>
                              </div>
                            ) : torrents.length === 0 ? (
                              <div className="py-4 text-center text-xs text-white/30">No torrents found</div>
                            ) : (
                              <div className="max-h-64 overflow-y-auto">
                                {torrents.map((t, i) => (
                                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-t border-white/5 hover:bg-white/5 transition-colors">
                                    <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                      t.quality === '2160p' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                      t.quality === '1080p' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                      'bg-white/10 text-white/50 border border-white/10'
                                    }`}>{t.quality || '?'}</span>
                                    <span className="flex-1 text-[11px] text-white/60 truncate min-w-0 font-mono" title={t.title}>{t.title}</span>
                                    <span className={`shrink-0 flex items-center gap-0.5 text-[10px] tabular-nums ${
                                      t.seeders > 20 ? 'text-emerald-400' : t.seeders >= 5 ? 'text-yellow-400' : 'text-red-400'
                                    }`}>
                                      <Users className="w-2.5 h-2.5" />{t.seeders}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-white/30 tabular-nums w-14 text-right">{formatSize(t.size)}</span>
                                    <span className="shrink-0 text-[9px] text-white/20 w-14 text-center">
                                      {t.source === 'prowlarr' ? 'Prowlarr' : 'Torrentio'}
                                    </span>
                                    <button
                                      onClick={() => handleInstallMagnet(t.magnetUri, t.quality)}
                                      disabled={installMagnetLoading === t.magnetUri}
                                      className="shrink-0 p-1 rounded bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/40 disabled:opacity-40 transition-colors"
                                      title="Install this torrent"
                                    >
                                      {installMagnetLoading === t.magnetUri ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <HardDriveDownload className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

// ─── Library Row ─────────────────────────────────────────────────────────────

function LibraryRow({
  item,
  actionLoading,
  onDeleteItem,
  onDeleteEpisode,
  onRefetchEpisode,
  onRefreshLibrary,
  onTrackOngoing,
  isTrackedOngoing,
}: {
  item: LibraryItem
  actionLoading: string | null
  onDeleteItem: (id: string, title: string) => void
  onDeleteEpisode: (itemId: string, epKey: string) => Promise<void>
  onRefetchEpisode: (itemId: string, epKey: string, mode: string) => Promise<void>
  onRefreshLibrary: () => void
  onTrackOngoing?: (item: LibraryItem) => void
  isTrackedOngoing?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const isTV = item.type === 'tv'
  const episodeCount = item.episodeCount || 0

  return (
    <>
      <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
        <td className="py-2.5 pr-3">
          {isTV ? (
            <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1.5 text-white/90 font-medium">
              {expanded ? <ChevronDown className="w-3.5 h-3.5 text-white/40" /> : <ChevronRight className="w-3.5 h-3.5 text-white/40" />}
              <span className="truncate max-w-[40vw]">{item.title}</span>
              {item.year && <span className="text-white/30 text-xs">({item.year})</span>}
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-white/90 font-medium">
              <span className="w-3.5" />
              <span className="truncate max-w-[40vw]">{item.title}</span>
              {item.year && <span className="text-white/30 text-xs">({item.year})</span>}
            </div>
          )}
        </td>
        <td className="py-2.5 pr-3">
          <div className="flex items-center gap-1.5">
            {item.type === 'movie' ? <Film className="w-3.5 h-3.5 text-white/30" /> : <Tv2 className="w-3.5 h-3.5 text-white/30" />}
            <TypeBadge type={item.type} />
            {item.isAnime && <span className="text-[9px] px-1 rounded bg-pink-500/20 text-pink-400 border border-pink-500/30">ANI</span>}
          </div>
        </td>
        <td className="py-2.5 pr-3 text-xs text-white/50 tabular-nums">
          {isTV ? `${episodeCount} eps` : item.torrent?.quality || '\u2014'}
        </td>
        <td className="py-2.5 pr-3 text-xs text-white/40 whitespace-nowrap">
          {item.source === 'filesystem' ? (
            <span className="text-[9px] px-1.5 rounded bg-white/5 text-white/30 border border-white/10">FS</span>
          ) : timeAgo(item.stateUpdatedAt)}
        </td>
        <td className="py-2.5 text-right whitespace-nowrap">
          <div className="inline-flex gap-1">
            {isTV && item.imdbId && onTrackOngoing && !isTrackedOngoing && (
              <button
                onClick={() => onTrackOngoing(item)}
                className="p-1.5 rounded border border-purple-500/30 text-purple-400/60 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                title="Track ongoing"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => onDeleteItem(item.id, item.title)}
              disabled={actionLoading === item.id}
              className="p-1.5 rounded border border-white/15 text-white/50 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30 disabled:opacity-40 transition-colors"
              title="Delete all"
            >
              {actionLoading === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </td>
      </tr>
      {expanded && isTV && (
        <EpisodeManager
          item={item}
          onRefetchEpisode={onRefetchEpisode}
          onDeleteEpisode={onDeleteEpisode}
          onRefreshLibrary={onRefreshLibrary}
        />
      )}
    </>
  )
}

// ─── Pruna Page ──────────────────────────────────────────────────────────────

export default function Pruna() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [queueData, setQueueData] = useState<QueueData | null>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [libraryFilter, setLibraryFilter] = useState('')
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<'all' | 'movie' | 'tv'>('all')
  const [ongoing, setOngoing] = useState<OngoingShow[]>([])
  const [ongoingLoading, setOngoingLoading] = useState(false)

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/home', { replace: true })
    }
  }, [user, navigate])

  const fetchQueue = useCallback(async () => {
    try {
      const json = await api.getPrunaQueue()
      setQueueData(json as unknown as QueueData)
    } catch { /* ignore */ }
  }, [])

  const fetchOngoing = useCallback(async () => {
    try {
      const json = await api.getPrunaOngoing() as { success?: boolean; shows?: OngoingShow[] }
      if (json.success) setOngoing(json.shows || [])
    } catch { /* ignore */ }
  }, [])

  const fetchLibrary = useCallback(async () => {
    try {
      const json = await api.getPrunaLibrary() as { success?: boolean; items?: LibraryItem[] }
      if (json.success && Array.isArray(json.items)) setLibrary(json.items)
    } catch { /* ignore */ }
  }, [])

  const fetchDashboard = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const [dashJson] = await Promise.all([
        api.getPrunaDashboard(),
        fetchQueue(),
        fetchLibrary(),
        fetchOngoing(),
      ])
      const json = dashJson as unknown as DashboardData
      if (json.success) { setData(json); setError(null) }
      else setError('Failed to load dashboard')
    } catch {
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }, [fetchQueue, fetchLibrary, fetchOngoing])

  useEffect(() => {
    fetchDashboard(true)
  }, [fetchDashboard])

  useEffect(() => {
    if (!autoRefresh) return
    intervalRef.current = setInterval(() => fetchDashboard(false), 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, fetchDashboard])

  // Actions
  const handleRetry = async (prunaId: string) => {
    setActionLoading(prunaId)
    try { await api.prunaRetry(prunaId); await fetchDashboard(false) } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleRemove = async (prunaId: string, title: string) => {
    if (!confirm(`Remove "${title}" from Pruna? This will delete symlinks and RD torrents.`)) return
    setActionLoading(prunaId)
    try { await api.prunaRemove(prunaId); await fetchDashboard(false) } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handlePromote = async (itemId: string) => {
    setActionLoading(itemId)
    try { await api.prunaPromote(itemId); await fetchDashboard(false) } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleQueueConfig = async (delta: number) => {
    const current = queueData?.maxActive ?? 5
    const next = Math.max(1, Math.min(20, current + delta))
    if (next === current) return
    setConfigLoading(true)
    try { await api.prunaQueueConfig(next); await fetchDashboard(false) } catch { /* ignore */ }
    finally { setConfigLoading(false) }
  }

  const handleTrackOngoing = async (item: LibraryItem) => {
    if (!item.imdbId) return
    setOngoingLoading(true)
    try {
      await api.prunaTrackOngoing({
        imdbId: item.imdbId, tmdbId: item.tmdbId, title: item.title,
        year: item.year, isAnime: item.isAnime,
      })
      await fetchOngoing()
    } catch { /* ignore */ }
    finally { setOngoingLoading(false) }
  }

  const handleRemoveOngoing = async (imdbId: string) => {
    try { await api.prunaRemoveOngoing(imdbId); await fetchOngoing() } catch { /* ignore */ }
  }

  const handleToggleOngoing = async (imdbId: string, enabled: boolean) => {
    try { await api.prunaToggleOngoing(imdbId, enabled); await fetchOngoing() } catch { /* ignore */ }
  }

  const handleCheckOngoing = async () => {
    setOngoingLoading(true)
    try {
      await api.prunaCheckOngoing()
      setTimeout(() => fetchDashboard(false), 3000)
    } catch { /* ignore */ }
    finally { setOngoingLoading(false) }
  }

  const handleClearFailed = async () => {
    const count = data?.failedItems?.length || 0
    if (!confirm(`Clear all ${count} failed items?`)) return
    setActionLoading('clear-failed')
    try { await api.prunaClearFailed(); await fetchDashboard(false) } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleDeleteLibraryItem = async (itemId: string, title: string) => {
    if (!confirm(`Delete "${title}"? This removes all symlinks and RD torrents.`)) return
    setActionLoading(itemId)
    try { await api.prunaDeleteLibraryItem(itemId); await fetchDashboard(false) } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleDeleteEpisode = async (itemId: string, epKey: string) => {
    setActionLoading(`${itemId}-${epKey}`)
    try { await api.prunaDeleteEpisode(itemId, epKey); await fetchDashboard(false) } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleRefetchEpisode = async (itemId: string, epKey: string, mode: string) => {
    setActionLoading(`${itemId}-${epKey}`)
    try { await api.prunaRefetchEpisode(itemId, epKey, mode); await fetchDashboard(false) } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-white/30" />
      </div>
    )
  }

  const activeItems = data?.activeItems ?? []
  const completedItems = data?.completedItems ?? []
  const failedItems = data?.failedItems ?? []

  const filteredLibrary = library.filter((item) => {
    if (libraryTypeFilter !== 'all' && item.type !== libraryTypeFilter) return false
    if (libraryFilter && !item.title.toLowerCase().includes(libraryFilter.toLowerCase())) return false
    return true
  })

  return (
    <div className="p-6 pb-8 max-w-[90rem] w-full mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Shield size={20} className="text-purple-500" />
          <h1 className="text-xl font-bold text-white">PRUNA</h1>
          {queueData && (
            <span className="text-xs text-white/40">
              Active: <span className="text-white/60">{queueData.activeCount}/{queueData.maxActive}</span>
              {queueData.queued.length > 0 && <> | Queued: <span className="text-blue-400">{queueData.queued.length}</span></>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {data?.timestamp && <span className="text-xs text-white/30">{timeAgo(data.timestamp)}</span>}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`text-[11px] px-2.5 py-1 rounded border transition-colors ${
              autoRefresh ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-dark-border text-white/50 hover:bg-white/5'
            }`}
          >
            {autoRefresh ? 'Auto' : 'Manual'}
          </button>
          <button
            onClick={() => fetchDashboard(true)}
            disabled={loading}
            className="p-2 rounded-lg border border-dark-border text-white/70 hover:bg-white/10 disabled:opacity-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">{error}</p>}

      <div className="space-y-6">
        {/* Stats Grid */}
        {data && Object.keys(data.stateCounts).length > 0 && (
          <div>
            <p className="text-[11px] text-white/30 uppercase tracking-wider mb-2">Pipeline Status</p>
            <div className="grid grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-3">
              {Object.entries(data.stateCounts)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([state, count]) => (
                  <div key={state} className="bg-dark-card border border-dark-border rounded-lg p-3 flex flex-col items-center gap-1.5">
                    <span className="text-2xl font-bold text-white tabular-nums">{(count as number).toLocaleString()}</span>
                    <StateBadge state={state} />
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Queue */}
        {queueData && (
          <div className="bg-dark-card border border-blue-500/20 rounded-lg p-4">
            <SectionHeader title="Queue" count={queueData.queued.length}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/40">Processing limit:</span>
                <div className="inline-flex items-center gap-0.5 rounded border border-dark-border bg-white/5">
                  <button onClick={() => handleQueueConfig(-1)} disabled={configLoading || (queueData.maxActive ?? 5) <= 1}
                    className="p-1 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors rounded-l">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-xs font-semibold text-white tabular-nums px-2 min-w-[24px] text-center">
                    {configLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : queueData.maxActive}
                  </span>
                  <button onClick={() => handleQueueConfig(1)} disabled={configLoading || (queueData.maxActive ?? 5) >= 20}
                    className="p-1 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors rounded-r">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </SectionHeader>
            {queueData.queued.length === 0 ? (
              <p className="text-xs text-white/30 py-4 text-center">No items queued</p>
            ) : (
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-dark-card z-10">
                    <tr className="text-[10px] uppercase tracking-wider text-white/30 border-b border-white/10">
                      <th className="text-left py-2 pr-3 font-medium">#</th>
                      <th className="text-left py-2 pr-3 font-medium">Title</th>
                      <th className="text-left py-2 pr-3 font-medium">Type</th>
                      <th className="text-left py-2 pr-3 font-medium">Queued</th>
                      <th className="text-right py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueData.queued.map((item, i) => (
                      <tr key={`q-${item.id}`} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-3 text-xs text-blue-400 font-semibold tabular-nums">{i + 1}</td>
                        <td className="py-2.5 pr-3 text-white/90 font-medium truncate max-w-[40vw]">{item.title}</td>
                        <td className="py-2.5 pr-3"><TypeBadge type={item.type} /></td>
                        <td className="py-2.5 pr-3 text-xs text-white/40 whitespace-nowrap">{timeAgo(item.createdAt)}</td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex gap-1.5">
                            <button onClick={() => handlePromote(item.id)} disabled={actionLoading === item.id}
                              className="p-1.5 rounded border border-emerald-500/30 text-emerald-400/70 hover:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors" title="Promote">
                              {actionLoading === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => handleRemove(item.id, item.title)} disabled={actionLoading === item.id}
                              className="p-1.5 rounded border border-white/15 text-white/50 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30 disabled:opacity-40 transition-colors" title="Remove">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Ongoing Shows */}
        {ongoing.length > 0 && (
          <div className="bg-dark-card border border-purple-500/20 rounded-lg p-4">
            <SectionHeader title="Ongoing" count={ongoing.length}>
              <button
                onClick={handleCheckOngoing}
                disabled={ongoingLoading}
                className="text-[11px] px-2.5 py-1 rounded border border-purple-500/30 text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/10 disabled:opacity-50 transition-colors"
              >
                {ongoingLoading ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                Check Now
              </button>
            </SectionHeader>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-dark-card z-10">
                  <tr className="text-[10px] uppercase tracking-wider text-white/30 border-b border-white/10">
                    <th className="text-left py-2 pr-3 font-medium">Title</th>
                    <th className="text-left py-2 pr-3 font-medium">Last Episode</th>
                    <th className="text-left py-2 pr-3 font-medium">Last Checked</th>
                    <th className="text-left py-2 pr-3 font-medium">Status</th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ongoing.map((show) => (
                    <tr key={show.imdbId} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pr-3 text-white/90 font-medium truncate max-w-[200px]">
                        {show.title}
                        {show.year && <span className="text-white/30 text-xs ml-1">({show.year})</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-white/50 tabular-nums whitespace-nowrap">
                        {show.lastKnownEpisode
                          ? `S${String(show.lastKnownEpisode.season).padStart(2, '0')}E${String(show.lastKnownEpisode.episode).padStart(2, '0')}`
                          : '\u2014'}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-white/40 whitespace-nowrap">{timeAgo(show.lastCheckedAt)}</td>
                      <td className="py-2.5 pr-3">
                        <button
                          onClick={() => handleToggleOngoing(show.imdbId, !show.enabled)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                            show.enabled ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-white/30 border-white/15'
                          }`}
                        >
                          {show.enabled ? 'Active' : 'Paused'}
                        </button>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => handleRemoveOngoing(show.imdbId)}
                          className="p-1 rounded text-white/40 hover:text-red-400 transition-colors"
                          title="Remove from ongoing"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Active Items */}
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <SectionHeader title="Active" count={activeItems.length} />
          {activeItems.length === 0 ? (
            <p className="text-xs text-white/30 py-4 text-center">Pipeline is clear</p>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-dark-card z-10">
                  <tr className="text-[10px] uppercase tracking-wider text-white/30 border-b border-white/10">
                    <th className="text-left py-2 pr-3 font-medium">Title</th>
                    <th className="text-left py-2 pr-3 font-medium">Type</th>
                    <th className="text-left py-2 pr-3 font-medium">State</th>
                    <th className="text-left py-2 pr-3 font-medium">Progress</th>
                    <th className="text-left py-2 pr-3 font-medium">Updated</th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeItems.map((item) => (
                    <tr key={`a-${item.id}`} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pr-3 text-white/90 font-medium truncate max-w-[200px]">
                        {item.title}
                        {item.error && <span className="ml-2 text-[10px] text-red-400">{item.error}</span>}
                      </td>
                      <td className="py-2.5 pr-3"><TypeBadge type={item.type} /></td>
                      <td className="py-2.5 pr-3">
                        <StateBadge state={item.state} />
                        {item.state === 'episodes_processing' && item.activeEpisodes && (
                          <span className="ml-1 text-[10px] text-blue-400">{item.activeEpisodes.active} ep{item.activeEpisodes.active > 1 ? 's' : ''}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-white/50 tabular-nums whitespace-nowrap">
                        {item.state === 'downloading' && item.realDebrid?.progress != null ? (
                          <span>{item.realDebrid.progress}%{item.realDebrid.speed ? ` @ ${formatSpeed(item.realDebrid.speed)}` : ''}</span>
                        ) : item.state === 'episodes_processing' && item.activeEpisodes ? (
                          <span>{Object.entries(item.activeEpisodes.states).map(([s, c]) => `${c} ${s}`).join(', ')}</span>
                        ) : '\u2014'}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-white/40 whitespace-nowrap">{timeAgo(item.stateUpdatedAt)}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1.5">
                          <button onClick={() => handleRetry(item.id)} disabled={actionLoading === item.id}
                            className="p-1.5 rounded border border-white/15 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors" title="Retry">
                            {actionLoading === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => handleRemove(item.id, item.title)} disabled={actionLoading === item.id}
                            className="p-1.5 rounded border border-white/15 text-white/50 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30 disabled:opacity-40 transition-colors" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Completed Items */}
        {completedItems.length > 0 && (
          <div className="bg-dark-card border border-emerald-500/20 rounded-lg p-4">
            <SectionHeader title="Completed" count={completedItems.length} />
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-dark-card z-10">
                  <tr className="text-[10px] uppercase tracking-wider text-white/30 border-b border-white/10">
                    <th className="text-left py-2 pr-3 font-medium">Title</th>
                    <th className="text-left py-2 pr-3 font-medium">Type</th>
                    <th className="text-left py-2 pr-3 font-medium">Quality</th>
                    <th className="text-left py-2 pr-3 font-medium">Completed</th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {completedItems.map((item) => (
                    <tr key={`c-${item.id}`} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pr-3 text-white/90 font-medium truncate max-w-[40vw]">{item.title}</td>
                      <td className="py-2.5 pr-3"><TypeBadge type={item.type} /></td>
                      <td className="py-2.5 pr-3 text-xs text-white/50">{item.torrent?.quality || '\u2014'}</td>
                      <td className="py-2.5 pr-3 text-xs text-white/40 whitespace-nowrap">{timeAgo(item.stateUpdatedAt)}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => handleRemove(item.id, item.title)} disabled={actionLoading === item.id}
                          className="p-1.5 rounded border border-white/15 text-white/50 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30 disabled:opacity-40 transition-colors" title="Remove">
                          {actionLoading === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Failed Items */}
        {failedItems.length > 0 && (
          <div className="bg-dark-card border border-red-500/20 rounded-lg p-4">
            <SectionHeader title="Failed" count={failedItems.length}>
              <button
                onClick={handleClearFailed}
                disabled={actionLoading === 'clear-failed'}
                className="text-[11px] px-2.5 py-1 rounded border border-red-500/30 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'clear-failed' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                Clear All
              </button>
            </SectionHeader>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-dark-card z-10">
                  <tr className="text-[10px] uppercase tracking-wider text-white/30 border-b border-white/10">
                    <th className="text-left py-2 pr-3 font-medium">Title</th>
                    <th className="text-left py-2 pr-3 font-medium">Type</th>
                    <th className="text-left py-2 pr-3 font-medium">Error</th>
                    <th className="text-left py-2 pr-3 font-medium">Failed</th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {failedItems.map((item) => (
                    <tr key={`f-${item.id}`} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pr-3 text-white/90 font-medium truncate max-w-[40vw]">{item.title}</td>
                      <td className="py-2.5 pr-3"><TypeBadge type={item.type} /></td>
                      <td className="py-2.5 pr-3 text-xs text-red-400/80 max-w-[30vw] truncate" title={item.error || ''}>{item.error || '\u2014'}</td>
                      <td className="py-2.5 pr-3 text-xs text-white/40 whitespace-nowrap">{timeAgo(item.stateUpdatedAt)}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1.5">
                          <button onClick={() => handleRetry(item.id)} disabled={actionLoading === item.id}
                            className="p-1.5 rounded border border-white/15 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors" title="Retry">
                            {actionLoading === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => handleRemove(item.id, item.title)} disabled={actionLoading === item.id}
                            className="p-1.5 rounded border border-white/15 text-white/50 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30 disabled:opacity-40 transition-colors" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Library */}
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <SectionHeader title="Library" count={library.length}>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded border border-dark-border bg-white/5 text-[10px]">
                {(['all', 'tv', 'movie'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setLibraryTypeFilter(t)}
                    className={`px-2 py-0.5 transition-colors ${
                      libraryTypeFilter === t ? 'bg-white/10 text-white/80' : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {t === 'all' ? 'All' : t === 'tv' ? 'TV' : 'Movies'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                <input
                  type="text"
                  value={libraryFilter}
                  onChange={(e) => setLibraryFilter(e.target.value)}
                  placeholder="Filter..."
                  className="w-40 bg-white/5 border border-dark-border rounded-md pl-8 pr-3 py-1 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/40"
                />
              </div>
            </div>
          </SectionHeader>
          {filteredLibrary.length === 0 ? (
            <p className="text-xs text-white/30 py-4 text-center">
              {library.length === 0 ? 'No installed content' : 'No matches'}
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-dark-card z-10">
                  <tr className="text-[10px] uppercase tracking-wider text-white/30 border-b border-white/10">
                    <th className="text-left py-2 pr-3 font-medium">Title</th>
                    <th className="text-left py-2 pr-3 font-medium">Type</th>
                    <th className="text-left py-2 pr-3 font-medium">Info</th>
                    <th className="text-left py-2 pr-3 font-medium">Source</th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLibrary.map((item) => (
                    <LibraryRow
                      key={item.id}
                      item={item}
                      actionLoading={actionLoading}
                      onDeleteItem={handleDeleteLibraryItem}
                      onDeleteEpisode={handleDeleteEpisode}
                      onRefetchEpisode={handleRefetchEpisode}
                      onRefreshLibrary={() => fetchDashboard(false)}
                      onTrackOngoing={handleTrackOngoing}
                      isTrackedOngoing={ongoing.some((s) => s.imdbId === item.imdbId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
