import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import type { PlayJob, EpisodeInfo } from '@/types/media'

interface PlayerState {
  job: PlayJob | null
  startPositionTicks: number
  isOpen: boolean
  episodeList: EpisodeInfo[]
  currentEpisodeId: string
  openPlayer: (job: PlayJob, startPositionTicks?: number, episodes?: EpisodeInfo[], currentEpisodeId?: string) => void
  closePlayer: () => void
  updateJob: (job: PlayJob) => void
  setEpisodeList: (eps: EpisodeInfo[]) => void
  setCurrentEpisodeId: (id: string) => void
}

const PlayerContext = createContext<PlayerState | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<PlayJob | null>(null)
  const [startPositionTicks, setStartPositionTicks] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [episodeList, setEpisodeList] = useState<EpisodeInfo[]>([])
  const [currentEpisodeId, setCurrentEpisodeId] = useState('')

  const openPlayer = useCallback((newJob: PlayJob, ticks = 0, episodes: EpisodeInfo[] = [], epId = '') => {
    setJob(newJob)
    setStartPositionTicks(ticks)
    setEpisodeList(episodes)
    setCurrentEpisodeId(epId)
    setIsOpen(true)
  }, [])

  const closePlayer = useCallback(() => {
    setIsOpen(false)
    // Delay clearing job so the exit animation can play
    setTimeout(() => setJob(null), 350)
  }, [])

  const updateJob = useCallback((newJob: PlayJob) => {
    setJob(newJob)
  }, [])

  return (
    <PlayerContext.Provider
      value={{ job, startPositionTicks, isOpen, episodeList, currentEpisodeId, openPlayer, closePlayer, updateJob, setEpisodeList, setCurrentEpisodeId }}
    >
      {children}
    </PlayerContext.Provider>
  )
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}
