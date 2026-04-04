import { useState, useEffect } from 'react'
import { useSettings, detectDirectPlaySupport, type QualityPreset, type SubtitleSize, type PlayerEngine } from '@/contexts/SettingsContext'
import { Zap, Film, Mic2, Subtitles, SkipForward, RotateCcw, Info, Cpu, CheckCircle2, XCircle, RefreshCw, AlertTriangle, MessageSquare, Monitor } from 'lucide-react'
import { platform } from '@/platform'
import { isTv } from '@/hooks/usePlatform'

const QUALITY_OPTIONS: { value: QualityPreset; label: string; desc: string }[] = [
  { value: 'original', label: 'Original', desc: 'No bitrate cap — stream copy when possible' },
  { value: '1440p',    label: '1440p',    desc: '~20 Mbps — high quality, near-original' },
  { value: '1080p',    label: '1080p',    desc: '~10 Mbps — reliable quality, moderate time' },
  { value: '720p',     label: '720p',     desc: '~4 Mbps — good balance of speed and quality' },
  { value: '480p',     label: '480p',     desc: '~2 Mbps — fastest start, lowest quality' },
]

const AUDIO_LANGS = [
  { value: 'auto',  label: 'Auto (server default)' },
  { value: 'en',    label: 'English' },
  { value: 'ja',    label: 'Japanese' },
  { value: 'fr',    label: 'French' },
  { value: 'de',    label: 'German' },
  { value: 'es',    label: 'Spanish' },
  { value: 'it',    label: 'Italian' },
  { value: 'pt',    label: 'Portuguese' },
  { value: 'ko',    label: 'Korean' },
  { value: 'zh',    label: 'Chinese' },
]

const SUBTITLE_LANGS = [
  { value: 'off',   label: 'Off' },
  { value: 'auto',  label: 'Auto (match audio language)' },
  { value: 'en',    label: 'English' },
  { value: 'ja',    label: 'Japanese' },
  { value: 'fr',    label: 'French' },
  { value: 'de',    label: 'German' },
  { value: 'es',    label: 'Spanish' },
  { value: 'it',    label: 'Italian' },
  { value: 'pt',    label: 'Portuguese' },
  { value: 'ko',    label: 'Korean' },
  { value: 'zh',    label: 'Chinese' },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      data-focusable
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 relative ${
        checked ? 'bg-red-600' : 'bg-white/15'
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
          checked ? 'translate-x-[20px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export default function Settings() {
  const {
    defaultQuality, directPlay, autoplayNext,
    preferredAudioLang, preferredSubtitleLang,
    subtitleSize, subtitleBgOpacity,
    hasRunHardwareScan, detectedDirectPlay,
    discordRPC, playerEngine,
    update, reset,
  } = useSettings()

  const [scanning, setScanning] = useState(false)
  const [mpvAvailable, setMpvAvailable] = useState(false)

  useEffect(() => {
    if (platform.supportsMpv) {
      window.electronAPI.mpv.isAvailable().then(setMpvAvailable).catch(() => {})
    }
  }, [])

  async function handleRescan() {
    setScanning(true)
    try {
      const supported = await detectDirectPlaySupport()
      update({ directPlay: supported, detectedDirectPlay: supported, hasRunHardwareScan: true })
    } finally {
      setScanning(false)
    }
  }

  const userOverriddenDirectPlay = detectedDirectPlay !== null && directPlay !== detectedDirectPlay

  // TV-style settings row wrapper
  const SettingsRow = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    isTv ? (
      <div data-focusable tabIndex={0} className="tv-settings-row" onClick={onClick}>{children}</div>
    ) : (
      <div className="rounded-xl bg-white/5 border border-white/8 p-4">{children}</div>
    )
  )

  const sectionTitle = isTv ? 'text-base font-semibold text-white/70 uppercase tracking-widest mb-4' : 'flex items-center gap-2 text-white/60 text-xs font-semibold uppercase tracking-widest'
  const labelSize = isTv ? 'text-base' : 'text-sm'
  const descSize = isTv ? 'text-sm' : 'text-xs'

  return (
    <div className={isTv ? 'max-w-3xl mx-auto px-12 py-8 space-y-10' : 'max-w-2xl mx-auto px-6 py-8 space-y-10'}>
      <div>
        <h1 className={`font-bold text-white ${isTv ? 'text-3xl' : 'text-2xl'}`}>Settings</h1>
        <p className={`text-white/40 mt-1 ${descSize}`}>Preferences are saved automatically.</p>
      </div>

      {/* ── Playback ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className={sectionTitle}>
          <Film size={isTv ? 16 : 13} />
          <span className={isTv ? 'ml-2' : ''}>Playback</span>
        </div>

        {/* Default Quality */}
        <div className={isTv ? 'space-y-3' : `rounded-xl bg-white/5 border border-white/8 p-4 space-y-3 transition ${directPlay ? 'opacity-50' : ''}`}>
          <div>
            <p className={`font-medium text-white ${labelSize}`}>Default Quality</p>
            <p className={`text-white/45 mt-0.5 ${descSize}`}>
              {directPlay ? 'Used when switching to transcoded stream mid-playback.' : 'Lower quality starts faster.'}
            </p>
          </div>
          <div className={isTv ? 'flex flex-wrap gap-3' : 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
            {QUALITY_OPTIONS.map((opt) => (
              <button
                data-focusable
                key={opt.value}
                onClick={() => update({ defaultQuality: opt.value })}
                className={isTv
                  ? `tv-chip ${defaultQuality === opt.value ? 'tv-chip-selected' : ''}`
                  : `text-left px-3 py-2.5 rounded-lg border transition ${
                      defaultQuality === opt.value
                        ? 'bg-red-600/20 border-red-500/50 text-white'
                        : 'bg-white/5 border-white/8 text-white/60 hover:bg-white/8 hover:text-white'
                    }`
                }
              >
                {isTv ? opt.label : (
                  <>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-[10px] text-white/40 mt-0.5 leading-tight">{opt.desc}</p>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Autoplay next */}
        {isTv ? (
          <div data-focusable tabIndex={0} className="tv-settings-row" onClick={() => update({ autoplayNext: !autoplayNext })}>
            <div>
              <p className={`font-medium text-white ${labelSize}`}>Auto-play Next Episode</p>
              <p className={`text-white/45 mt-0.5 ${descSize}`}>Automatically load the next episode.</p>
            </div>
            <Toggle checked={autoplayNext} onChange={() => update({ autoplayNext: !autoplayNext })} />
          </div>
        ) : (
          <div className="rounded-xl bg-white/5 border border-white/8 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <SkipForward size={15} className="text-white/50 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Autoplay Next Episode</p>
                  <p className="text-xs text-white/45 mt-0.5">Automatically load the next episode when one finishes.</p>
                </div>
              </div>
              <Toggle checked={autoplayNext} onChange={() => update({ autoplayNext: !autoplayNext })} />
            </div>
          </div>
        )}

        {/* Direct Play */}
        {isTv ? (
          <div data-focusable tabIndex={0} className="tv-settings-row" onClick={() => update({ directPlay: !directPlay })}>
            <div>
              <p className={`font-medium text-white ${labelSize}`}>Direct Play</p>
              <p className={`text-white/45 mt-0.5 ${descSize}`}>Stream original quality, no re-encoding.</p>
            </div>
            <Toggle checked={directPlay} onChange={() => update({ directPlay: !directPlay })} />
          </div>
        ) : (
          <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Zap size={15} className="text-amber-400 flex-shrink-0" />
                  <p className="text-sm font-medium text-white">Direct Play</p>
                  {userOverriddenDirectPlay && (
                    <span className="text-[10px] bg-amber-400/15 text-amber-400/80 border border-amber-400/20 px-1.5 py-0.5 rounded-full">
                      Manual override
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/45 mt-1.5 leading-relaxed">
                  Streams at original quality with no bitrate cap. Video is remuxed without
                  re-encoding for a fast start; audio is transcoded to AAC for browser
                  compatibility. Disable to use your configured quality preset instead.
                </p>
              </div>
              <Toggle checked={directPlay} onChange={() => update({ directPlay: !directPlay })} />
            </div>
            {directPlay && (
              <div className="flex items-start gap-2 text-xs text-blue-400/80 bg-blue-400/8 border border-blue-400/15 rounded-lg px-3 py-2">
                <Info size={12} className="flex-shrink-0 mt-0.5" />
                <p>Audio and quality switching are fully available in the player. Seek and track changes are instant.</p>
              </div>
            )}
          </div>
        )}

        {/* Player Engine — desktop only */}
        {!isTv && mpvAvailable && (
          <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <Monitor size={15} className="text-white/50 flex-shrink-0" />
                <p className="text-sm font-medium text-white">Player Engine</p>
              </div>
              <p className="text-xs text-white/45 mt-1.5 leading-relaxed">
                Choose the video player backend. mpv offers better codec support (HEVC, AV1),
                hardware-accelerated decoding, and lower CPU usage for high-bitrate content.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'builtin' as PlayerEngine, label: 'Built-in', desc: 'HTML5 video + HLS.js' },
                { value: 'mpv' as PlayerEngine, label: 'mpv', desc: 'External player — wider codec support' },
              ]).map((opt) => (
                <button
                  data-focusable
                  key={opt.value}
                  onClick={() => update({ playerEngine: opt.value })}
                  className={`text-left px-3 py-2.5 rounded-lg border transition ${
                    playerEngine === opt.value
                      ? 'bg-red-600/20 border-red-500/50 text-white'
                      : 'bg-white/5 border-white/8 text-white/60 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-[10px] text-white/40 mt-0.5 leading-tight">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Integrations — desktop only ──────────────────────────────────────── */}
      {platform.supportsDiscord && (
        <section className="space-y-4">
          <div className={sectionTitle}>
            <MessageSquare size={isTv ? 16 : 13} />
            <span className={isTv ? 'ml-2' : ''}>Integrations</span>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/8 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <MessageSquare size={15} className="text-[#5865F2] flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Discord Rich Presence</p>
                  <p className="text-xs text-white/45 mt-0.5">Show what you're watching as your Discord activity.</p>
                </div>
              </div>
              <Toggle checked={discordRPC} onChange={() => update({ discordRPC: !discordRPC })} />
            </div>
          </div>
        </section>
      )}

      {/* ── Language Preferences ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className={sectionTitle}>
          <Mic2 size={isTv ? 16 : 13} />
          <span className={isTv ? 'ml-2' : ''}>Language</span>
        </div>

        {isTv ? (
          <>
            <div data-focusable tabIndex={0} className="tv-settings-row">
              <p className={`font-medium text-white ${labelSize}`}>Preferred Audio</p>
              <span className="text-red-500 text-base">{AUDIO_LANGS.find(l => l.value === preferredAudioLang)?.label}</span>
            </div>
            <div data-focusable tabIndex={0} className="tv-settings-row">
              <p className={`font-medium text-white ${labelSize}`}>Preferred Subtitles</p>
              <span className="text-red-500 text-base">{SUBTITLE_LANGS.find(l => l.value === preferredSubtitleLang)?.label}</span>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Mic2 size={14} className="text-white/50" />
                <p className="text-sm font-medium text-white">Preferred Audio</p>
              </div>
              <select
                data-focusable
                value={preferredAudioLang}
                onChange={(e) => update({ preferredAudioLang: e.target.value })}
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/40 transition"
              >
                {AUDIO_LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Subtitles size={14} className="text-white/50" />
                <p className="text-sm font-medium text-white">Preferred Subtitles</p>
              </div>
              <select
                data-focusable
                value={preferredSubtitleLang}
                onChange={(e) => update({ preferredSubtitleLang: e.target.value })}
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/40 transition"
              >
                {SUBTITLE_LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </section>

      {/* ── Subtitle Styling ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className={sectionTitle}>
          <Subtitles size={isTv ? 16 : 13} />
          <span className={isTv ? 'ml-2' : ''}>Subtitle Styling</span>
        </div>

        <div className={isTv ? 'space-y-3' : 'rounded-xl bg-white/5 border border-white/8 p-4 space-y-3'}>
          <p className={`font-medium text-white ${labelSize}`}>Text Size</p>
          <div className={isTv ? 'flex gap-3' : 'grid grid-cols-4 gap-2'}>
            {([
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
              { value: 'xl', label: 'XL' },
            ] as { value: SubtitleSize; label: string }[]).map((opt) => (
              <button
                data-focusable
                key={opt.value}
                onClick={() => update({ subtitleSize: opt.value })}
                className={isTv
                  ? `tv-chip ${subtitleSize === opt.value ? 'tv-chip-selected' : ''}`
                  : `py-2 rounded-lg border text-sm text-center transition ${
                      subtitleSize === opt.value
                        ? 'bg-red-600/20 border-red-500/50 text-white'
                        : 'bg-white/5 border-white/8 text-white/60 hover:bg-white/8 hover:text-white'
                    }`
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Hardware — desktop only ──────────────────────────────────────────── */}
      {!isTv && (
        <section className="space-y-4">
          <div className={sectionTitle}>
            <Cpu size={13} />
            <span>Hardware</span>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-white">Hardware Playback Detection</p>
              <p className="text-xs text-white/45 mt-0.5 leading-relaxed">
                Scans your GPU for H.264 hardware decode support.
              </p>
            </div>
            {!hasRunHardwareScan || scanning ? (
              <div className="flex items-center gap-2 text-xs text-white/40 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                <RefreshCw size={13} className="flex-shrink-0 animate-spin" />
                Scanning hardware…
              </div>
            ) : detectedDirectPlay ? (
              <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/8 border border-green-400/20 px-3 py-2 rounded-lg">
                <CheckCircle2 size={13} className="flex-shrink-0" />
                GPU hardware decode supported
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-white/50 bg-white/5 border border-white/10 px-3 py-2 rounded-lg">
                <XCircle size={13} className="flex-shrink-0" />
                Hardware decode unavailable
              </div>
            )}
            {userOverriddenDirectPlay && hasRunHardwareScan && !scanning && (
              <div className="flex items-start gap-2 text-xs text-amber-400/70 bg-amber-400/8 border border-amber-400/15 px-3 py-2 rounded-lg">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <p>Direct Play is {directPlay ? 'on' : 'off'} but hardware detection says {detectedDirectPlay ? 'supported' : 'not supported'}.</p>
              </div>
            )}
            <button
              data-focusable
              onClick={handleRescan}
              disabled={scanning}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-white/60 hover:text-white text-xs transition disabled:opacity-50"
            >
              <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
              Re-detect hardware
            </button>
          </div>
        </section>
      )}

      {/* ── Reset ───────────────────────────────────────────────────────────── */}
      <section>
        <button
          data-focusable
          onClick={reset}
          className={isTv
            ? 'tv-btn-outline flex items-center gap-2'
            : 'flex items-center gap-2 px-4 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-white/50 hover:text-white text-sm transition'
          }
        >
          <RotateCcw size={14} />
          Reset to defaults
        </button>
      </section>

      {/* ── Version ──────────────────────────────────────────────────────────── */}
      <div className={`text-center text-white/20 pb-4 ${isTv ? 'text-sm' : 'text-xs'}`}>
        VALOR v{__APP_VERSION__}
      </div>
    </div>
  )
}
