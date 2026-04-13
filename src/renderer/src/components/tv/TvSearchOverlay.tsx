import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, X, Loader2 } from 'lucide-react'
import * as api from '@/services/api'
import TvMediaCard from './TvMediaCard'
import type { UnifiedMedia } from '@/types/media'
interface Props { open: boolean; onClose: () => void; onSelect: (item: UnifiedMedia) => void }
export default function TvSearchOverlay({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<UnifiedMedia[]>([]); const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null); const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 100); setQuery(''); setResults([]) } }, [open])
  const doSearch = useCallback((q: string) => { if (debounceRef.current) clearTimeout(debounceRef.current); if (!q.trim()) { setResults([]); setLoading(false); return }; setLoading(true); debounceRef.current = setTimeout(() => { api.searchItems(q.trim()).then(setResults).catch(() => setResults([])).finally(() => setLoading(false)) }, 400) }, [])
  useEffect(() => { if (!open) return; function onKey(e: KeyboardEvent) { if (e.key === 'Escape' || e.key === 'XF86Back') { e.preventDefault(); onClose() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [open, onClose])
  if (!open) return null
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-y-auto tv-no-scrollbar">
      <div className="flex items-center gap-4 px-12 pt-8 pb-6">
        <Search size={24} className="text-red-500 flex-shrink-0" />
        <input ref={inputRef} data-focusable value={query} onChange={(e) => { setQuery(e.target.value); doSearch(e.target.value) }} placeholder="Search movies, shows..." className="flex-1 bg-transparent text-2xl text-white placeholder-white/20 outline-none border-b-2 border-white/10 focus:border-red-500/50 pb-2 transition" />
        <button data-focusable onClick={onClose} className="tv-icon-btn text-white/40 hover:text-white"><X size={24} /></button>
      </div>
      {loading && <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-white/30" /></div>}
      {!loading && results.length > 0 && <div className="px-12 pb-12"><div className="grid grid-cols-6 gap-4">{results.map((item) => <TvMediaCard key={`${item.id}-${item.type}`} item={item} onPlay={onSelect} />)}</div></div>}
      {!loading && query.trim() && results.length === 0 && <p className="text-center text-white/25 text-base py-16">No results found</p>}
      {!query.trim() && !loading && <p className="text-center text-white/15 text-base py-16">Type to search</p>}
    </motion.div>
  )
}
