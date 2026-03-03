import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode
} from 'react'
import * as api from '@/services/api'
import { useAuth } from './AuthContext'
import type { UnifiedMedia } from '@/types/media'

interface WatchlistState {
  ids: Set<string | number>
  items: UnifiedMedia[]
  toggle: (item: UnifiedMedia) => Promise<void>
  refresh: () => Promise<void>
}

const WatchlistContext = createContext<WatchlistState | null>(null)

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [items, setItems] = useState<UnifiedMedia[]>([])
  const [ids, setIds] = useState<Set<string | number>>(new Set())

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const data = await api.getWatchlist()
      setItems(data)
      setIds(new Set(data.map((i) => i.id)))
    } catch {
      // silently ignore — user may not be authed yet
    }
  }, [token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = useCallback(
    async (item: UnifiedMedia) => {
      if (ids.has(item.id)) {
        await api.removeFromWatchlist(item.id)
        setItems((prev) => prev.filter((i) => i.id !== item.id))
        setIds((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      } else {
        await api.addToWatchlist(item)
        setItems((prev) => [...prev, item])
        setIds((prev) => new Set([...prev, item.id]))
      }
    },
    [ids]
  )

  return (
    <WatchlistContext.Provider value={{ ids, items, toggle, refresh }}>
      {children}
    </WatchlistContext.Provider>
  )
}

export function useWatchlist(): WatchlistState {
  const ctx = useContext(WatchlistContext)
  if (!ctx) throw new Error('useWatchlist must be used within WatchlistProvider')
  return ctx
}
