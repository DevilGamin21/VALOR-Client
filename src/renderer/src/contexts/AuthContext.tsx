import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import * as api from '@/services/api'
import type { User } from '@/types/media'

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount, restore session from electron-store
  useEffect(() => {
    async function restore() {
      try {
        const stored = await window.electronAPI.auth.getToken()
        if (stored) {
          setToken(stored)
          const me = await api.getMe()
          setUser(me)
        }
      } catch {
        await window.electronAPI.auth.clearToken()
      } finally {
        setLoading(false)
      }
    }
    restore()
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password)
    await window.electronAPI.auth.setToken(res.token)
    setToken(res.token)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    await window.electronAPI.auth.clearToken()
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
