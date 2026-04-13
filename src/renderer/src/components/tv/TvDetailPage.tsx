import { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Play, Plus, Check, Lock, Loader2, Star, Eye, EyeOff, X } from 'lucide-react'
import * as api from '@/services/api'
import { usePlayer } from '@/contexts/PlayerContext'
import { useWatchlist } from '@/contexts/WatchlistContext'
import { useConnect } from '@/contexts/ConnectContext'
import { useTvRemote } from '@/hooks/useTvRemote'
import type { UnifiedMedia, PlayJob, EpisodeInfo } from '@/types/media'

interface Ep { id: string; title: string; episodeNumber: number; seasonNumber: number; jellyfinId?: string; playedPercentage?: number; airDate: string | null; availableAt?: string | null; overview?: string | null; stillUrl?: string | null }
const PH: Record<string, string> = { starting: 'Starting...', resolving: 'Resolving...', checking_cache: 'Checking cache...', scraping: 'Searching torrents...', adding_to_rd: 'Adding to Real-Debrid...', downloading: 'Downloading...', unrestricting: 'Getting stream...', preparing: 'Preparing...', building: 'Building session...' }

interface Props { item: UnifiedMedia; onClose: () => void }

export default function TvDetailPage({ item, onClose }: Props) {
  const { openPlayer } = usePlayer(); const { ids, toggle } = useWatchlist(); const connectCtx = useConnect()
  const inWatchlist = ids.has(item.id); const hasRemoteTarget = !!connectCtx?.targetDevice
  const [rating, setRating] = useState<number | null>(item.rating ?? null); const [genres, setGenres] = useState<{ id: number; name: string }[]>([])
  const [seasons, setSeasons] = useState<api.TmdbSeason[]>([]); const [selSeason, setSelSeason] = useState<number | null>(null); const [episodes, setEpisodes] = useState<Ep[]>([])
  const [loadingS, setLoadingS] = useState(false); const [loadingE, setLoadingE] = useState(false); const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set())
  const [loadingPlay, setLoadingPlay] = useState(false); const [streamId, setStreamId] = useState<string | null>(null); const [streamPhase, setStreamPhase] = useState(''); const [streamMsg, setStreamMsg] = useState(''); const [error, setError] = useState('')
  const [digitalRelease, setDigitalRelease] = useState<{ isReleased: boolean; releaseDate?: string } | null>(null)
  const pendingResumeRef = useRef(0); const pendingEpsRef = useRef<EpisodeInfo[]>([]); const pendingEpIdRef = useRef<string | undefined>(undefined)

  useTvRemote({ enabled: false })
  useEffect(() => { function onKey(e: KeyboardEvent) { if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'XF86Back' || (e as any).keyCode === 10009) { e.preventDefault(); onClose() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])

  useEffect(() => { if (!item.tmdbId) return; api.getTmdbDetail(item.tmdbId, item.type).then(d => { if (d.rating != null) setRating(d.rating); if (d.genres?.length) setGenres(d.genres) }).catch(() => {}) }, [item.tmdbId, item.type])
  useEffect(() => { if (item.type !== 'movie' || !item.tmdbId) return; if (item.source === 'jellyfin') { setDigitalRelease({ isReleased: true }); return }; api.checkDigitalRelease(item.tmdbId, 'movie').then(setDigitalRelease).catch(() => setDigitalRelease({ isReleased: true })) }, [item])
  useEffect(() => { if (item.type !== 'tv' || !item.tmdbId) return; api.getWatchedEpisodes(item.tmdbId).then(k => setWatchedKeys(new Set(k))).catch(() => {}) }, [item.tmdbId, item.type])
  useEffect(() => { if (item.type !== 'tv' || !item.tmdbId) return; setLoadingS(true); api.getTmdbSeasons(item.tmdbId).then(s => { setSeasons(s); if (s.length > 0) setSelSeason(s[0].seasonNumber) }).catch(() => {}).finally(() => setLoadingS(false)) }, [item.tmdbId, item.type])
  useEffect(() => { if (!item.tmdbId || selSeason === null) return; setLoadingE(true); api.getTmdbEpisodes(item.tmdbId, selSeason).then(eps => setEpisodes(eps.map(e => ({ id: e.id, title: e.title, episodeNumber: e.episodeNumber, seasonNumber: e.seasonNumber, airDate: e.airDate, availableAt: e.availableAt, overview: e.overview, stillUrl: e.stillUrl })))).catch(() => {}).finally(() => setLoadingE(false)) }, [item.tmdbId, selSeason])

  useEffect(() => { if (!streamId) return; const iv = setInterval(async () => { try { const s = await api.getStreamStatus(streamId); setStreamPhase(s.phase); setStreamMsg(s.message); if (s.phase === 'ready') { clearInterval(iv); const j: PlayJob = { itemId: s.itemId || s.jellyfinItemId || '', hlsUrl: s.hlsUrl || '', directStreamUrl: s.directStreamUrl, playSessionId: s.playSessionId || null, deviceId: s.deviceId, audioTracks: s.audioTracks || [], subtitleTracks: (s.subtitleTracks || []).map(t => ({ ...t, vttUrl: t.vttUrl ?? (t as any).url ?? null })), title: s.title || item.title, seriesName: s.seriesName, type: s.type || item.type, durationTicks: s.durationTicks, mpvOptions: s.mpvOptions, tmdbId: item.tmdbId, year: item.year }; if (pendingEpIdRef.current && pendingEpsRef.current.length > 0) { const ep = pendingEpsRef.current.find(e => e.jellyfinId === pendingEpIdRef.current); if (ep) { j.seasonNumber = ep.seasonNumber; j.episodeNumber = ep.episodeNumber; j.episodeName = ep.title } }; if (j.seasonNumber == null && s.seasonNumber != null) j.seasonNumber = s.seasonNumber; if (j.episodeNumber == null && s.episodeNumber != null) j.episodeNumber = s.episodeNumber; j.posterUrl = item.posterUrl; j.seriesId = item.seriesId; openPlayer(j, pendingResumeRef.current, pendingEpsRef.current, pendingEpIdRef.current); onClose() } else if (s.phase === 'error') { clearInterval(iv); setError(s.error || s.message || 'Failed'); setStreamId(null); setLoadingPlay(false) } } catch { clearInterval(iv); setError('Lost connection'); setStreamId(null); setLoadingPlay(false) } }, 1500); return () => clearInterval(iv) }, [streamId, openPlayer, onClose, item])

  async function play() { if (!item.tmdbId) return; if (hasRemoteTarget && connectCtx) { connectCtx.playOnTarget({ tmdbId: item.tmdbId, type: item.type, title: item.title, year: item.year ?? undefined }); onClose(); return }; setLoadingPlay(true); setError(''); pendingResumeRef.current = 0; pendingEpsRef.current = []; pendingEpIdRef.current = undefined; try { const r = await api.startStream({ tmdbId: item.tmdbId, type: item.type, title: item.title, year: item.year ?? undefined, isAnime: item.isAnime }); setStreamId(r.streamId); setStreamPhase('starting') } catch (e) { setError((e as Error).message); setLoadingPlay(false) } }
  async function playEp(ep: Ep) { if (!item.tmdbId) return; if (hasRemoteTarget && connectCtx) { connectCtx.playOnTarget({ tmdbId: item.tmdbId, type: 'tv', title: item.title, year: item.year ?? undefined, season: ep.seasonNumber, episode: ep.episodeNumber }); onClose(); return }; setLoadingPlay(true); setError(''); pendingResumeRef.current = 0; pendingEpsRef.current = episodes.map(e => ({ jellyfinId: e.jellyfinId || e.id, title: e.title, episodeNumber: e.episodeNumber, seasonNumber: e.seasonNumber, playedPercentage: e.playedPercentage })); pendingEpIdRef.current = ep.jellyfinId || ep.id; try { const r = await api.startStream({ tmdbId: item.tmdbId, type: 'tv', title: item.title, year: item.year ?? undefined, season: ep.seasonNumber, episode: ep.episodeNumber, isAnime: item.isAnime }); setStreamId(r.streamId); setStreamPhase('starting') } catch (e) { setError((e as Error).message); setLoadingPlay(false) } }
  async function markWatched(ep: Ep, w: boolean) { if (!item.tmdbId) return; const k = `S${ep.seasonNumber}E${ep.episodeNumber}`; try { if (w) await api.addWatchedEpisodes(item.tmdbId, [k]); else await api.removeWatchedEpisodes(item.tmdbId, [k]); setWatchedKeys(p => { const n = new Set(p); if (w) n.add(k); else n.delete(k); return n }) } catch {} }

  const bg = item.backdropUrl || item.posterUrl; const isStreaming = loadingPlay && !!streamId; const released = item.type !== 'movie' || item.source === 'jellyfin' || digitalRelease?.isReleased === true
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-y-auto tv-no-scrollbar">
      <div className="relative" style={{ height: '55vh' }}>{bg && <img src={bg} alt="" className="w-full h-full object-cover" />}<div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom,transparent,rgba(10,10,10,0.4),#0A0A0A)' }} /><div className="absolute inset-0" style={{ background: 'linear-gradient(to right,rgba(10,10,10,0.8),transparent)', width: '50%' }} /></div>
      <div className="relative -mt-[30vh] px-12 pb-12 z-10">
        <button data-focusable onClick={onClose} className="absolute top-4 right-12 tv-icon-btn text-white/50"><X size={24} /></button>
        <h1 className="text-4xl font-bold text-white leading-tight max-w-[60%]">{item.title}</h1>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {rating != null && rating > 0 && <span className="inline-flex items-center gap-1.5 text-base font-bold text-amber-400"><Star size={16} fill="currentColor" />{rating.toFixed(1)}</span>}
          {item.year && <span className="text-base text-white/50">{item.year}</span>}
          {genres.length > 0 && <span className="text-sm text-white/35">{genres.slice(0, 3).map(g => g.name).join(' \u00B7 ')}</span>}
        </div>
        {item.overview && <p className="mt-4 text-sm text-white/50 leading-relaxed max-w-[55%] line-clamp-3">{item.overview}</p>}
        {isStreaming && <div className="mt-4 flex items-center gap-3"><Loader2 size={18} className="animate-spin text-red-500" /><span className="text-sm text-white/70">{PH[streamPhase] || streamMsg}</span></div>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {!isStreaming && <div className="flex items-center gap-3 mt-6">
          {item.type === 'movie' && released && <button data-focusable onClick={play} disabled={loadingPlay} className="tv-btn-primary px-8 py-3 text-base font-semibold flex items-center gap-2 disabled:opacity-50">{loadingPlay ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="white" />}{hasRemoteTarget ? `Play on ${connectCtx?.targetDevice?.deviceName}` : 'Play'}</button>}
          {item.type === 'movie' && !released && <div className="tv-btn-outline px-8 py-3 text-base flex items-center gap-2 opacity-50"><Lock size={18} />Awaiting Release</div>}
          <button data-focusable onClick={() => toggle(item)} className="tv-btn-outline px-6 py-3 text-base flex items-center gap-2">{inWatchlist ? <><Check size={18} className="text-green-400" />Saved</> : <><Plus size={18} />Watchlist</>}</button>
        </div>}
        {item.type === 'tv' && <div className="mt-8">
          <div className="flex gap-2 mb-5 overflow-x-auto tv-no-scrollbar">{loadingS ? <Loader2 size={20} className="animate-spin text-white/30" /> : seasons.map(s => <button key={s.seasonNumber} data-focusable onClick={() => setSelSeason(s.seasonNumber)} className={`flex-shrink-0 px-5 py-2 rounded-full text-sm font-medium transition ${selSeason === s.seasonNumber ? 'bg-white text-black' : 'bg-white/[0.08] text-white/50'}`}>Season {s.seasonNumber}</button>)}</div>
          {loadingE ? <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-white/30" /></div> : <div className="flex gap-3 overflow-x-auto tv-no-scrollbar pb-4">
            {episodes.map(ep => { const ek = `S${ep.seasonNumber}E${ep.episodeNumber}`; const w = watchedKeys.has(ek) || (ep.playedPercentage ?? 0) >= 90; const rel = ep.availableAt ? new Date(ep.availableAt) <= new Date() : !ep.airDate || new Date(ep.airDate) <= new Date(); const ok = !!(item.tmdbId && rel); return (
              <div key={ep.id} data-focusable onClick={ok ? () => playEp(ep) : undefined} className={`tv-card flex-shrink-0 rounded-lg overflow-hidden ${ok ? 'cursor-pointer' : 'opacity-40 grayscale'}`} style={{ width: 220 }}>
                <div className="relative aspect-video bg-[#141414] overflow-hidden">
                  {ep.stillUrl ? <img src={ep.stillUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center"><span className="text-2xl font-bold text-white/[0.06]">{ep.episodeNumber}</span></div>}
                  {!rel && <div className="absolute top-2 right-2 bg-black/70 rounded px-1.5 py-0.5"><Lock size={10} className="text-white/60" /></div>}
                  {w && rel && <div className="absolute top-2 right-2 bg-red-600 rounded px-1.5 py-0.5"><span className="text-[9px] font-bold text-white">Watched</span></div>}
                  {!w && (ep.playedPercentage ?? 0) >= 5 && rel && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/15"><div className="h-full bg-red-600" style={{ width: `${ep.playedPercentage}%` }} /></div>}
                </div>
                <div className="px-2.5 py-2 bg-[#141414]"><div className="flex items-center gap-2"><span className="text-[11px] font-bold text-red-500">E{ep.episodeNumber}</span><p className="text-[13px] font-medium text-white/85 truncate flex-1">{ep.title}</p><button data-focusable onClick={e2 => { e2.stopPropagation(); markWatched(ep, !w) }} className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-white/20 hover:text-white/60">{w ? <EyeOff size={12} /> : <Eye size={12} />}</button></div>
                  {ep.overview && <p className="mt-1 text-[11px] text-white/40 line-clamp-2">{ep.overview}</p>}
                  {!rel && (ep.availableAt || ep.airDate) && <p className="mt-1 text-[11px] text-red-500">{ep.availableAt ? new Date(ep.availableAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : new Date(ep.airDate!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>}
                </div>
              </div>
            ) })}
          </div>}
        </div>}
      </div>
    </motion.div>
  )
}
