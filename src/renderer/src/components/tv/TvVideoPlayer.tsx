import { useEffect, useRef, useState, useCallback } from 'react'
import Hls from 'hls.js'
import { motion } from 'framer-motion'
import TvPlayerControls from './TvPlayerControls'
import * as api from '@/services/api'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings, QUALITY_BITRATES } from '@/contexts/SettingsContext'
import { useConnect } from '@/contexts/ConnectContext'
import type { PlayJob, EpisodeInfo } from '@/types/media'

interface Props { job: PlayJob; startPositionTicks: number; onClose: () => void }

export default function TvVideoPlayer({ job, startPositionTicks, onClose }: Props) {
  const { episodeList, currentEpisodeId, updateJob, setCurrentEpisodeId } = usePlayer()
  const { autoplayNext, defaultQuality, discordRPC } = useSettings()
  const connectCtx = useConnect()
  const videoRef = useRef<HTMLVideoElement>(null); const hlsRef = useRef<Hls | null>(null)
  const [playing, setPlaying] = useState(false); const [currentTime, setCurrentTime] = useState(0); const [duration, setDuration] = useState(0)
  const [buffering, setBuffering] = useState(true); const [activeAudio, setActiveAudio] = useState(job.audioTracks[0]?.index ?? 0)
  const [activeSub, setActiveSub] = useState<number | null>(null); const [activeQuality, setActiveQuality] = useState('Original')

  const loadSrc = useCallback((url: string, seekTo?: number) => {
    const v = videoRef.current; if (!v) return; if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    if (job.directStreamUrl) { v.src = url; v.load(); if (seekTo) v.currentTime = seekTo; v.play().catch(() => {}); return }
    if (!Hls.isSupported()) { v.src = url; v.load(); return }
    const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 }); hlsRef.current = hls; hls.loadSource(url); hls.attachMedia(v)
    hls.on(Hls.Events.MANIFEST_PARSED, () => { if (seekTo) v.currentTime = seekTo; v.play().catch(() => {}) })
  }, [job.directStreamUrl])

  useEffect(() => { const url = job.directStreamUrl || job.hlsUrl; if (!url) { onClose(); return }; loadSrc(url, startPositionTicks > 0 ? startPositionTicks / 10_000_000 : undefined); return () => { hlsRef.current?.destroy() } }, [])

  useEffect(() => {
    const v = videoRef.current; if (!v) return
    const h = { play: () => setPlaying(true), pause: () => setPlaying(false), timeupdate: () => { setCurrentTime(v.currentTime); setBuffering(false) }, durationchange: () => setDuration(v.duration), waiting: () => setBuffering(true), playing: () => setBuffering(false), ended: () => { if (hasNextEpisode && autoplayNext) handleNextEpisode(); else onClose() } }
    Object.entries(h).forEach(([e, fn]) => v.addEventListener(e, fn)); return () => { Object.entries(h).forEach(([e, fn]) => v.removeEventListener(e, fn)) }
  }, [autoplayNext])

  useEffect(() => { const i = setInterval(() => { const v = videoRef.current; if (!v || !duration) return; const ep = episodeList.find(e => e.jellyfinId === currentEpisodeId); api.reportProgress({ itemId: job.itemId, positionTicks: Math.floor(v.currentTime * 1e7), durationTicks: Math.floor(duration * 1e7), isPaused: v.paused, playSessionId: job.playSessionId, seriesId: job.seriesId, title: job.seriesName || job.title, posterUrl: job.posterUrl, type: job.seriesId ? 'tv' : job.type, tmdbId: job.tmdbId, seasonNumber: ep?.seasonNumber ?? job.seasonNumber, episodeNumber: ep?.episodeNumber ?? job.episodeNumber }).catch(() => {}) }, 10_000); return () => clearInterval(i) }, [job, duration, currentEpisodeId, episodeList])

  useEffect(() => { if (!connectCtx?.pushState) return; const push = () => { const v = videoRef.current; connectCtx.pushState({ playing: v ? !v.paused : false, positionSeconds: v ? Math.floor(v.currentTime) : 0, durationSeconds: v ? Math.floor(duration) : 0, mediaMeta: { title: job.seriesName || job.title, tmdbId: job.tmdbId, type: job.seriesId ? 'tv' : job.type } }) }; push(); const i = setInterval(push, 5000); return () => clearInterval(i) }, [connectCtx, job, duration])

  const ci = episodeList.findIndex(e => e.jellyfinId === currentEpisodeId); const nextEp = ci >= 0 && ci < episodeList.length - 1 ? episodeList[ci + 1] : null; const hasNextEpisode = !!nextEp
  const handleNextEpisode = useCallback(() => { if (nextEp) switchEpisode(nextEp) }, [nextEp])
  const QM: Record<string, number | undefined> = { Original: undefined, '1440p': 20e6, '1080p': 10e6, '720p': 4e6, '480p': 2e6 }

  async function handleQualityChange(label: string) { const v = videoRef.current; const t = v ? v.currentTime : 0; setActiveQuality(label); setBuffering(true); try { const j = await api.startPlayJob({ itemId: job.itemId, maxBitrate: QM[label], audioStreamIndex: activeAudio, startTimeTicks: t > 0 ? Math.floor(t * 1e7) : undefined, previousPlaySessionId: job.playSessionId || undefined, previousDeviceId: job.deviceId, tmdbId: job.tmdbId }); updateJob(j); loadSrc(j.directStreamUrl || j.hlsUrl, t) } catch { setBuffering(false) } }
  async function switchEpisode(ep: EpisodeInfo) { setBuffering(true); try { const j = await api.startPlayJob({ itemId: ep.jellyfinId, directPlay: false, maxBitrate: QUALITY_BITRATES[defaultQuality], tmdbId: job.tmdbId }); updateJob(j); setCurrentEpisodeId(ep.jellyfinId); loadSrc(j.directStreamUrl || j.hlsUrl, 0) } catch {} }

  const handleClose = useCallback(() => { const v = videoRef.current; if (v && duration > 0) api.reportProgress({ itemId: job.itemId, positionTicks: Math.floor(v.currentTime * 1e7), durationTicks: Math.floor(duration * 1e7), isPaused: true, playSessionId: job.playSessionId, isStopped: true, seriesId: job.seriesId, title: job.seriesName || job.title, posterUrl: job.posterUrl, type: job.seriesId ? 'tv' : job.type, tmdbId: job.tmdbId }).catch(() => {}); hlsRef.current?.destroy(); connectCtx?.pushState({ playing: false, mediaMeta: null, positionSeconds: 0, durationSeconds: 0 }); if (discordRPC) window.electronAPI.discord.clearActivity().catch(() => {}); onClose() }, [job, duration, onClose, connectCtx, discordRPC])

  const ep = episodeList.find(e => e.jellyfinId === currentEpisodeId); const epLabel = (() => { const s = ep?.seasonNumber ?? job.seasonNumber; const e2 = ep?.episodeNumber ?? job.episodeNumber; const n = ep?.title ?? job.episodeName; return s != null && e2 != null ? `S${String(s).padStart(2, '0')}E${String(e2).padStart(2, '0')}${n ? ' \u00B7 ' + n : ''}` : null })()

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] bg-black">
      <video ref={videoRef} className="w-full h-full object-contain" playsInline />
      <TvPlayerControls playing={playing} currentTime={currentTime} duration={isFinite(duration) ? duration : (job.durationTicks ?? 0) / 1e7} buffering={buffering} title={job.seriesName || job.title} episodeLabel={epLabel} isDirectPlay={!!job.directStreamUrl} audioTracks={job.audioTracks} subtitleTracks={job.subtitleTracks} activeAudio={activeAudio} activeSub={activeSub} activeQuality={activeQuality} episodeList={episodeList} currentEpisodeId={currentEpisodeId} hasNextEpisode={hasNextEpisode} onPlay={() => videoRef.current?.play()} onPause={() => videoRef.current?.pause()} onSeek={s => { if (videoRef.current) videoRef.current.currentTime = s }} onSetAudio={i => setActiveAudio(i)} onSetSubtitle={i => setActiveSub(i)} onSetQuality={handleQualityChange} onNextEpisode={handleNextEpisode} onSwitchEpisode={switchEpisode} onClose={handleClose} />
    </motion.div>
  )
}
