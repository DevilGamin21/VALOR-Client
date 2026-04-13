import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, SkipForward, Subtitles, Volume2, Settings, List, Loader2 } from 'lucide-react'
import type { AudioTrack, SubtitleTrack, EpisodeInfo } from '@/types/media'

const QUALITY_PRESETS = [{ label: 'Original', bitrate: 0 }, { label: '1440p', bitrate: 20_000_000 }, { label: '1080p', bitrate: 10_000_000 }, { label: '720p', bitrate: 4_000_000 }, { label: '480p', bitrate: 2_000_000 }]

interface Props {
  playing: boolean; currentTime: number; duration: number; buffering: boolean; title: string; episodeLabel?: string | null; isDirectPlay?: boolean
  audioTracks: AudioTrack[]; subtitleTracks: SubtitleTrack[]; activeAudio: number; activeSub: number | null; activeQuality?: string
  episodeList: EpisodeInfo[]; currentEpisodeId: string; hasNextEpisode: boolean
  onPlay: () => void; onPause: () => void; onSeek: (s: number) => void; onSetAudio: (i: number) => void; onSetSubtitle: (i: number | null) => void
  onSetQuality: (l: string) => void; onNextEpisode: () => void; onSwitchEpisode: (ep: EpisodeInfo) => void; onClose: () => void
}

type Zone = 'hidden' | 'center' | 'seekbar' | 'actions'
type Picker = null | 'subtitles' | 'audio' | 'quality' | 'episodes'
const HIDE_DELAY = 3000; const SCRUB_STEP = 10

function fmt(s: number): string { if (!s||s<0) return '0:00'; const h=Math.floor(s/3600); const m=Math.floor((s%3600)/60); const sec=Math.floor(s%60); return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}` }

export default function TvPlayerControls({ playing,currentTime,duration,buffering,title,episodeLabel,isDirectPlay,audioTracks,subtitleTracks,activeAudio,activeSub,activeQuality,episodeList,currentEpisodeId,hasNextEpisode,onPlay,onPause,onSeek,onSetAudio,onSetSubtitle,onSetQuality,onNextEpisode,onSwitchEpisode,onClose }: Props) {
  const [zone, setZone] = useState<Zone>('hidden'); const [actionIdx, setActionIdx] = useState(0); const [picker, setPicker] = useState<Picker>(null); const [pickerIdx, setPickerIdx] = useState(0); const [scrubTime, setScrubTime] = useState<number|null>(null); const hideTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const actions = [...(subtitleTracks.length>0?[{id:'subtitles' as const,icon:Subtitles}]:[]), ...(audioTracks.length>1?[{id:'audio' as const,icon:Volume2}]:[]), {id:'quality' as const,icon:Settings}, ...(episodeList.length>1?[{id:'episodes' as const,icon:List}]:[]), ...(hasNextEpisode?[{id:'next' as const,icon:SkipForward}]:[])]

  const resetHide = useCallback(() => { if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => { if (!picker) { setZone('hidden'); setScrubTime(null) } }, HIDE_DELAY) }, [picker])
  const show = useCallback(() => { setZone('center'); resetHide() }, [resetHide])
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current) }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key
      if (picker) { e.preventDefault(); if (k==='Escape'||k==='Backspace'||k==='XF86Back'||(e as any).keyCode===10009) { setPicker(null); resetHide(); return }; pickerNav(k); return }
      if (zone==='hidden') { e.preventDefault(); show(); return }
      e.preventDefault(); resetHide()
      if (zone==='center') {
        if (k==='Enter'||k===' ') playing?onPause():onPlay()
        else if (k==='ArrowDown') { setZone('seekbar'); setScrubTime(null) }
        else if (k==='ArrowUp') setZone('hidden')
        else if (k==='ArrowLeft') onSeek(Math.max(0,currentTime-SCRUB_STEP))
        else if (k==='ArrowRight') onSeek(Math.min(duration,currentTime+SCRUB_STEP))
        else if (k==='Escape'||k==='Backspace'||(e as any).keyCode===10009) onClose()
      } else if (zone==='seekbar') {
        if (k==='ArrowLeft') setScrubTime(p=>Math.max(0,(p??currentTime)-SCRUB_STEP))
        else if (k==='ArrowRight') setScrubTime(p=>Math.min(duration,(p??currentTime)+SCRUB_STEP))
        else if (k==='Enter'||k===' ') { if (scrubTime!==null) { onSeek(scrubTime); setScrubTime(null) }; setZone('center') }
        else if (k==='ArrowUp') { setScrubTime(null); setZone('center') }
        else if (k==='ArrowDown') { setScrubTime(null); setZone('actions'); setActionIdx(0) }
        else if (k==='Escape'||k==='Backspace') { setScrubTime(null); setZone('center') }
      } else if (zone==='actions') {
        if (k==='ArrowLeft') setActionIdx(i=>Math.max(0,i-1))
        else if (k==='ArrowRight') setActionIdx(i=>Math.min(actions.length-1,i+1))
        else if (k==='ArrowUp') { setZone('seekbar'); setScrubTime(null) }
        else if (k==='ArrowDown') setZone('hidden')
        else if (k==='Enter'||k===' ') activateAction(actions[actionIdx]?.id)
      }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [zone,picker,actionIdx,actions.length,scrubTime,currentTime,duration,playing])

  function activateAction(id?: string) { if (id==='subtitles'||id==='audio'||id==='quality'||id==='episodes') openPicker(id); else if (id==='next') onNextEpisode() }
  function openPicker(p: Picker) { setPicker(p); setPickerIdx(0); if (hideTimer.current) clearTimeout(hideTimer.current) }
  function pickerNav(k: string) { const items=getPickerItems(); if (k==='ArrowUp') setPickerIdx(i=>Math.max(0,i-1)); else if (k==='ArrowDown') setPickerIdx(i=>Math.min(items.length-1,i+1)); else if (k==='Enter'||k===' ') { activatePickerItem(items[pickerIdx]); setPicker(null); resetHide() } }

  function getPickerItems(): {id:string;label:string;active:boolean;sub?:string}[] {
    if (picker==='subtitles') return [{id:'off',label:'Off',active:activeSub===null},...subtitleTracks.map(t=>({id:String(t.index),label:t.label,active:activeSub===t.index,sub:t.isImageBased?'PGS':undefined}))]
    if (picker==='audio') return audioTracks.map(t=>({id:String(t.index),label:t.label,active:activeAudio===t.index,sub:`${t.codec?.toUpperCase()||''} ${t.channels?t.channels+'ch':''}`.trim()||undefined}))
    if (picker==='quality') return QUALITY_PRESETS.map(q=>({id:q.label,label:q.label,active:(activeQuality||'Original')===q.label,sub:q.bitrate?`${(q.bitrate/1e6).toFixed(0)} Mbps`:'No cap'}))
    if (picker==='episodes') return episodeList.map(ep=>({id:ep.jellyfinId,label:`S${String(ep.seasonNumber).padStart(2,'0')}E${String(ep.episodeNumber).padStart(2,'0')}`,active:ep.jellyfinId===currentEpisodeId,sub:ep.title}))
    return []
  }
  function activatePickerItem(item?: {id:string}) { if (!item) return; if (picker==='subtitles') onSetSubtitle(item.id==='off'?null:parseInt(item.id)); else if (picker==='audio') onSetAudio(parseInt(item.id)); else if (picker==='quality') onSetQuality(item.id); else if (picker==='episodes') { const ep=episodeList.find(e=>e.jellyfinId===item.id); if (ep) onSwitchEpisode(ep) } }

  const items = picker?getPickerItems():[]; const pct = duration>0?(scrubTime??currentTime)/duration*100:0; const vis = zone!=='hidden'||!!picker
  return (
    <div className="fixed inset-0 z-[100]" onClick={zone==='hidden'?show:undefined}>
      {buffering && <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"><Loader2 size={48} className="text-white/60 animate-spin" /></div>}
      <div className={`absolute inset-0 transition-opacity duration-200 ${vis?'opacity-100':'opacity-0 pointer-events-none'}`}>
        <div className="absolute top-0 left-0 right-0 px-12 pt-7 pb-20" style={{background:'linear-gradient(to bottom,rgba(0,0,0,0.8),rgba(0,0,0,0.4),transparent)'}}>
          <p className="text-lg font-medium text-white">{title}</p>
          {episodeLabel && <p className="text-sm text-white/60 mt-1">{episodeLabel}</p>}
          {isDirectPlay && <span className="inline-block mt-2 text-[10px] font-bold text-white bg-green-600 px-2.5 py-1 rounded tracking-wider uppercase">Direct</span>}
        </div>
        {!buffering && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><button className={`w-20 h-20 rounded-full flex items-center justify-center transition-all pointer-events-auto ${zone==='center'?'bg-white/40 scale-110':'bg-black/20'}`} onClick={()=>playing?onPause():onPlay()}>{playing?<Pause size={40} fill="white" className="text-white"/>:<Play size={40} fill="white" className="text-white ml-1"/>}</button></div>}
        <div className="absolute bottom-0 left-0 right-0 px-12 pb-5 pt-40" style={{background:'linear-gradient(to top,rgba(0,0,0,0.8),rgba(0,0,0,0.4),transparent)'}}>
          {zone==='seekbar'&&scrubTime!==null&&<div className="flex items-center justify-center mb-3 gap-2"><span className="text-red-500 text-base font-bold">{scrubTime<currentTime?'\u25C4':'\u25BA'}</span><span className="text-2xl font-bold text-white bg-black/80 px-4 py-1 rounded">{fmt(scrubTime)}</span></div>}
          <div className={`relative rounded-full mb-3 transition-all ${zone==='seekbar'?'h-1 bg-white/30':'h-[1px] bg-white/15'}`}><div className="absolute h-full bg-white rounded-full transition-all duration-200" style={{width:`${pct}%`}}/>{zone==='seekbar'&&<div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg" style={{left:`calc(${pct}% - 7px)`}}/>}</div>
          <div className="flex items-center"><span className="text-[13px] text-white tabular-nums">{fmt(scrubTime??currentTime)}</span><span className="text-[13px] text-white/40 mx-1">/</span><span className="text-[13px] text-white/60 tabular-nums">{fmt(duration)}</span><div className="flex-1"/><div className="flex items-center gap-1">{actions.map((b,i)=>{const I=b.icon;const f=zone==='actions'&&i===actionIdx;return <button key={b.id} onClick={()=>activateAction(b.id)} className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${f?'bg-white/20':'bg-transparent'}`}><I size={20} className={f?'text-white':'text-white/70'}/></button>})}</div></div>
        </div>
      </div>
      {picker&&<div className="absolute inset-0 bg-black/50 z-30" onClick={()=>{setPicker(null);resetHide()}}><div className="absolute top-0 right-0 bottom-0 w-[360px] border-l border-white/10" style={{background:'rgba(20,20,20,0.96)'}} onClick={e=>e.stopPropagation()}><div className="px-6 pt-7 pb-4 border-b border-white/[0.15]"><p className="text-xl font-bold text-white capitalize">{picker}</p></div><div className="overflow-y-auto tv-no-scrollbar" style={{maxHeight:'calc(100vh - 72px)'}}>{items.map((it,i)=><button key={it.id} onClick={()=>{activatePickerItem(it);setPicker(null);resetHide()}} className={`w-full text-left px-4 py-3.5 mx-2 my-0.5 flex items-center justify-between transition rounded-[10px] ${i===pickerIdx?'bg-white/20':it.active?'bg-white/10':'bg-transparent'}`} style={{width:'calc(100% - 16px)'}}><div className="min-w-0"><span className={`text-[15px] ${it.active?'font-bold text-white':'text-white/70'}`}>{it.label}</span>{it.sub&&<p className="text-xs text-white/35 mt-0.5">{it.sub}</p>}</div>{it.active&&<span className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0 ml-3"/>}</button>)}</div></div></div>}
    </div>
  )
}
