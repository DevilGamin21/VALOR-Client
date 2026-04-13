import { useRef, useState, useEffect, useCallback } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import TopBar from './TopBar'
import TvVideoPlayer from './TvVideoPlayer'
import TvSearchOverlay from './TvSearchOverlay'
import TvDetailPage from './TvDetailPage'
import { usePlayer } from '@/contexts/PlayerContext'
import { useAuth } from '@/contexts/AuthContext'
import { useTvRemote } from '@/hooks/useTvRemote'
import { platform } from '@/platform'
import type { UnifiedMedia } from '@/types/media'

export default function TvRootShell() {
  const { isOpen, job, startPositionTicks, closePlayer } = usePlayer()
  const { user } = useAuth()
  const navigate = useNavigate()
  const mainRef = useRef<HTMLDivElement>(null)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<UnifiedMedia | null>(null)

  useTvRemote({ enabled: !isOpen && !searchOpen && !detailItem })

  useEffect(() => {
    if (typeof window.electronAPI?.window?.setFullScreen === 'function') window.electronAPI.window.setFullScreen(true)
    return () => { if (typeof window.electronAPI?.window?.setFullScreen === 'function') window.electronAPI.window.setFullScreen(false) }
  }, [])

  useEffect(() => {
    platform.updates.onAvailable((info) => setUpdateAvailable(info.version))
    platform.updates.onDownloaded(() => setUpdateReady(true))
    platform.updates.check().catch(() => {})
  }, [])

  const handleSearchSelect = useCallback((item: UnifiedMedia) => { setSearchOpen(false); setDetailItem(item) }, [])

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] overflow-hidden">
      <TopBar onSearch={() => setSearchOpen(true)} />
      {updateAvailable && (
        <div className="flex-shrink-0 flex items-center justify-center gap-4 px-6 py-2 bg-red-600/20 border-b border-red-600/30">
          <span className="text-sm text-white/80">{updateReady ? `v${updateAvailable} ready` : `v${updateAvailable} available`}</span>
          <button data-focusable onClick={() => updateReady ? platform.updates.install() : platform.updates.download()} className="tv-btn-primary text-xs py-1 px-3">{updateReady ? 'Restart' : 'Download'}</button>
        </div>
      )}
      <main ref={mainRef} className="flex-1 overflow-y-auto tv-no-scrollbar"><Outlet key={user?.id} /></main>
      <AnimatePresence>{searchOpen && <TvSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={handleSearchSelect} />}</AnimatePresence>
      <AnimatePresence>{detailItem && <TvDetailPage item={detailItem} onClose={() => setDetailItem(null)} />}</AnimatePresence>
      <AnimatePresence>{isOpen && job && <TvVideoPlayer job={job} startPositionTicks={startPositionTicks} onClose={closePlayer} />}</AnimatePresence>
    </div>
  )
}
