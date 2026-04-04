import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, SkipBack, SkipForward, X, ChevronUp, ChevronDown,
  Monitor, Smartphone, Tv, Globe, Cast, Volume2,
} from 'lucide-react'
import { useConnect } from '@/contexts/ConnectContext'

const QUALITY_OPTIONS = [
  { label: 'Original', value: 'Original' },
  { label: '4K', value: '4K' },
  { label: '1440p', value: '1440p' },
  { label: '1080p', value: '1080p' },
  { label: '720p', value: '720p' },
  { label: '480p', value: '480p' },
]

function DeviceIcon({ type, size = 14 }: { type: string; size?: number }) {
  switch (type) {
    case 'tv': return <Tv size={size} />
    case 'mobile': return <Smartphone size={size} />
    case 'pc': return <Monitor size={size} />
    default: return <Globe size={size} />
  }
}

function formatTime(secs: number): string {
  if (!secs || secs < 0) return '0:00'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function ConnectBar() {
  const ctx = useConnect()
  const [expanded, setExpanded] = useState(false)

  if (!ctx?.targetDevice) return null

  const { targetDevice: device, sendCommand, disconnect } = ctx
  const { state } = device
  const meta = state.mediaMeta

  const cmd = (command: string, payload?: Record<string, unknown>) =>
    sendCommand(device.deviceId, command, payload)

  // Keyboard shortcuts when bar is focused
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Only handle when no input/textarea is focused
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === ' ' && expanded) { e.preventDefault(); cmd(state.playing ? 'pause' : 'play') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, state.playing])

  const epLabel = meta?.type === 'tv' && meta.seasonNumber != null && meta.episodeNumber != null
    ? `S${String(meta.seasonNumber).padStart(2, '0')}E${String(meta.episodeNumber).padStart(2, '0')}`
    : null

  return (
    <div className="fixed bottom-0 left-16 right-0 z-40">
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-[#0a0f0a]/95 backdrop-blur-xl border-t border-emerald-500/20 overflow-hidden"
          >
            <div className="px-6 py-4 max-w-3xl">
              {/* Seek bar */}
              {state.durationSeconds > 0 && (
                <div className="mb-4">
                  <div
                    className="relative h-1.5 bg-white/10 rounded-full cursor-pointer group"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const pct = (e.clientX - rect.left) / rect.width
                      cmd('seek', { positionSeconds: Math.floor(pct * state.durationSeconds) })
                    }}
                  >
                    <div
                      className="absolute h-full bg-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: `${(state.positionSeconds / state.durationSeconds) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Controls row */}
              <div className="flex items-center gap-3 mb-4">
                <button data-focusable onClick={() => cmd('seek', { positionSeconds: Math.max(0, state.positionSeconds - 10) })}
                  className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.1] flex items-center justify-center text-white/60 hover:text-white transition">
                  <SkipBack size={14} />
                </button>
                <button data-focusable onClick={() => cmd(state.playing ? 'pause' : 'play')}
                  className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center transition">
                  {state.playing ? <Pause size={16} fill="white" className="text-white" /> : <Play size={16} fill="white" className="text-white ml-0.5" />}
                </button>
                <button data-focusable onClick={() => cmd('seek', { positionSeconds: Math.min(state.durationSeconds, state.positionSeconds + 30) })}
                  className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.1] flex items-center justify-center text-white/60 hover:text-white transition">
                  <SkipForward size={14} />
                </button>
              </div>

              {/* Quality */}
              {state.quality !== undefined && (
                <div className="mb-3">
                  <p className="text-[10px] text-white/30 mb-1.5 font-medium uppercase tracking-wider">Quality</p>
                  <div className="flex flex-wrap gap-1">
                    {QUALITY_OPTIONS.map((q) => (
                      <button key={q.value} data-focusable onClick={() => cmd('setQuality', { quality: q.value })}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                          state.quality === q.value ? 'bg-emerald-600 text-white' : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.1]'
                        }`}>{q.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Audio */}
              {state.audioTracks && state.audioTracks.length > 1 && (
                <div className="mb-3">
                  <p className="text-[10px] text-white/30 mb-1.5 font-medium uppercase tracking-wider">Audio</p>
                  <div className="flex flex-wrap gap-1">
                    {state.audioTracks.map((t) => (
                      <button key={t.index} data-focusable onClick={() => cmd('setAudio', { audioIndex: t.index })}
                        className={`px-2.5 py-1 rounded-md text-[11px] transition ${
                          t.active ? 'bg-emerald-600 text-white' : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.1]'
                        }`}>{t.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Subtitles */}
              {state.subtitleTracks && state.subtitleTracks.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/30 mb-1.5 font-medium uppercase tracking-wider">Subtitles</p>
                  <div className="flex flex-wrap gap-1">
                    <button data-focusable onClick={() => cmd('setSubtitle', { subtitleIndex: -1 })}
                      className={`px-2.5 py-1 rounded-md text-[11px] transition ${
                        !state.subtitleTracks.some(t => t.active) ? 'bg-emerald-600 text-white' : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.1]'
                      }`}>Off</button>
                    {state.subtitleTracks.map((t) => (
                      <button key={t.index} data-focusable onClick={() => cmd('setSubtitle', { subtitleIndex: t.index })}
                        className={`px-2.5 py-1 rounded-md text-[11px] transition ${
                          t.active ? 'bg-emerald-600 text-white' : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.1]'
                        }`}>{t.label}{t.isImageBased ? ' (PGS)' : ''}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed bar */}
      <div className="bg-emerald-950/90 backdrop-blur-xl border-t border-emerald-500/30 px-4 h-12 flex items-center gap-3">
        {/* Green dot + device */}
        <div className="flex items-center gap-2 text-emerald-400 flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <DeviceIcon type={device.deviceType} size={13} />
          <span className="text-xs font-medium">{device.deviceName}</span>
        </div>

        <div className="w-px h-5 bg-emerald-500/20 flex-shrink-0" />

        {/* Now playing info */}
        {meta ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs text-white/70 truncate">
              {meta.title}{epLabel ? ` · ${epLabel}` : ''}
            </span>
            {state.durationSeconds > 0 && (
              <span className="text-[10px] text-white/30 tabular-nums flex-shrink-0">
                {formatTime(state.positionSeconds)} / {formatTime(state.durationSeconds)}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-white/30 flex-1">Nothing playing</span>
        )}

        {/* Playback controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button data-focusable onClick={() => cmd('seek', { positionSeconds: Math.max(0, state.positionSeconds - 10) })}
            className="w-7 h-7 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition">
            <SkipBack size={12} />
          </button>
          <button data-focusable onClick={() => cmd(state.playing ? 'pause' : 'play')}
            className="w-7 h-7 rounded flex items-center justify-center text-white hover:bg-white/10 transition">
            {state.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <button data-focusable onClick={() => cmd('seek', { positionSeconds: Math.min(state.durationSeconds, state.positionSeconds + 30) })}
            className="w-7 h-7 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition">
            <SkipForward size={12} />
          </button>
        </div>

        {/* Expand / disconnect */}
        <button data-focusable onClick={() => setExpanded(!expanded)}
          className="w-7 h-7 rounded flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition">
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button data-focusable onClick={disconnect} title="Disconnect"
          className="w-7 h-7 rounded flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10 transition">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
