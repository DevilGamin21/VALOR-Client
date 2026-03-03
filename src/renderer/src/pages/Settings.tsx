import { useState } from 'react'
import { useSettings, detectDirectPlaySupport, type QualityPreset, type SubtitleSize } from '@/contexts/SettingsContext'
import { Zap, Film, Mic2, Subtitles, SkipForward, RotateCcw, Info, Cpu, CheckCircle2, XCircle, RefreshCw, AlertTriangle, MessageSquare } from 'lucide-react'

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
    discordRPC,
    update, reset,
  } = useSettings()

  const [scanning, setScanning] = useState(false)

  async function handleRescan() {
    setScanning(true)
    try {
      const supported = await detectDirectPlaySupport()
      update({ directPlay: supported, detectedDirectPlay: supported, hasRunHardwareScan: true })
    } finally {
      setScanning(false)
    }
  }

  // True if the user has manually overridden the hardware recommendation
  const userOverriddenDirectPlay = detectedDirectPlay !== null && directPlay !== detectedDirectPlay

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-white/40 mt-1">Preferences are saved automatically.</p>
      </div>

      {/* ── Playback ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-white/60 text-xs font-semibold uppercase tracking-widest">
          <Film size={13} />
          <span>Playback</span>
        </div>

        {/* Direct Play */}
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
              <p>
                Audio and quality switching are fully available in the player.
                Seek and track changes are instant — no restart required.
              </p>
            </div>
          )}
        </div>

        {/* Default Quality */}
        <div className={`rounded-xl bg-white/5 border border-white/8 p-4 space-y-3 transition ${directPlay ? 'opacity-50' : ''}`}>
          <div>
            <p className="text-sm font-medium text-white">Default Transcoding Quality</p>
            <p className="text-xs text-white/45 mt-0.5">
              {directPlay ? 'Used when switching to transcoded stream mid-playback.' : 'Applied when Direct Play is off. Lower quality starts faster.'}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {QUALITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ defaultQuality: opt.value })}
                className={`text-left px-3 py-2.5 rounded-lg border transition ${
                  defaultQuality === opt.value
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

        {/* Autoplay next */}
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
      </section>

      {/* ── Integrations ──────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-white/60 text-xs font-semibold uppercase tracking-widest">
          <MessageSquare size={13} />
          <span>Integrations</span>
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

      {/* ── Language Preferences ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-white/60 text-xs font-semibold uppercase tracking-widest">
          <Mic2 size={13} />
          <span>Language</span>
        </div>

        {/* Audio language */}
        <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Mic2 size={14} className="text-white/50" />
            <p className="text-sm font-medium text-white">Preferred Audio</p>
          </div>
          <select
            value={preferredAudioLang}
            onChange={(e) => update({ preferredAudioLang: e.target.value })}
            className="w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm
                       text-white focus:outline-none focus:border-white/40 transition"
          >
            {AUDIO_LANGS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Subtitle language */}
        <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Subtitles size={14} className="text-white/50" />
            <p className="text-sm font-medium text-white">Preferred Subtitles</p>
          </div>
          <select
            value={preferredSubtitleLang}
            onChange={(e) => update({ preferredSubtitleLang: e.target.value })}
            className="w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm
                       text-white focus:outline-none focus:border-white/40 transition"
          >
            {SUBTITLE_LANGS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
      </section>

      {/* ── Subtitle Styling ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-white/60 text-xs font-semibold uppercase tracking-widest">
          <Subtitles size={13} />
          <span>Subtitle Styling</span>
        </div>

        {/* Text Size */}
        <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
          <p className="text-sm font-medium text-white">Text Size</p>
          <div className="grid grid-cols-4 gap-2">
            {([
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
              { value: 'xl', label: 'XL' },
            ] as { value: SubtitleSize; label: string }[]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ subtitleSize: opt.value })}
                className={`py-2 rounded-lg border text-sm text-center transition ${
                  subtitleSize === opt.value
                    ? 'bg-red-600/20 border-red-500/50 text-white'
                    : 'bg-white/5 border-white/8 text-white/60 hover:bg-white/8 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Background Opacity */}
        <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white">Background Opacity</p>
            <span className="text-xs text-white/40">{Math.round(subtitleBgOpacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={subtitleBgOpacity}
            onChange={(e) => update({ subtitleBgOpacity: Number(e.target.value) })}
            className="w-full accent-red-500"
          />
          {/* Live preview */}
          <div className="flex justify-center py-1">
            <div
              className="px-4 py-1.5 rounded text-white text-sm"
              style={{ backgroundColor: `rgba(0,0,0,${subtitleBgOpacity})` }}
            >
              Subtitle Preview Text
            </div>
          </div>
        </div>
      </section>

      {/* ── Hardware ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-white/60 text-xs font-semibold uppercase tracking-widest">
          <Cpu size={13} />
          <span>Hardware</span>
        </div>

        <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-white">Hardware Playback Detection</p>
            <p className="text-xs text-white/45 mt-0.5 leading-relaxed">
              Scans your GPU for H.264 hardware decode support. Direct Play is set automatically on first launch.
            </p>
          </div>

          {/* Detection result — always reflects actual hardware, not the user's toggle */}
          {!hasRunHardwareScan || scanning ? (
            <div className="flex items-center gap-2 text-xs text-white/40 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
              <RefreshCw size={13} className="flex-shrink-0 animate-spin" />
              Scanning hardware…
            </div>
          ) : detectedDirectPlay ? (
            <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/8 border border-green-400/20 px-3 py-2 rounded-lg">
              <CheckCircle2 size={13} className="flex-shrink-0" />
              GPU hardware decode supported — H.264 1080p can play locally
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-white/50 bg-white/5 border border-white/10 px-3 py-2 rounded-lg">
              <XCircle size={13} className="flex-shrink-0" />
              Hardware decode unavailable — server transcoding recommended
            </div>
          )}

          {/* Warn if user has manually overridden the hardware recommendation */}
          {userOverriddenDirectPlay && hasRunHardwareScan && !scanning && (
            <div className="flex items-start gap-2 text-xs text-amber-400/70 bg-amber-400/8 border border-amber-400/15 px-3 py-2 rounded-lg">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <p>
                Direct Play is {directPlay ? 'on' : 'off'} but hardware detection says {detectedDirectPlay ? 'it is supported' : 'it is not supported'}.
                Click Re-detect to restore the recommended setting.
              </p>
            </div>
          )}

          <button
            onClick={handleRescan}
            disabled={scanning}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12
                       text-white/60 hover:text-white text-xs transition disabled:opacity-50"
          >
            <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
            Re-detect hardware
          </button>
        </div>
      </section>

      {/* ── Reset ───────────────────────────────────────────────────────────── */}
      <section>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/8 hover:bg-white/12
                     text-white/50 hover:text-white text-sm transition"
        >
          <RotateCcw size={14} />
          Reset to defaults
        </button>
        <p className="text-xs text-white/25 mt-2">
          Resets quality, language, and autoplay preferences. Direct Play is restored to your hardware-detected default.
        </p>
      </section>
    </div>
  )
}
