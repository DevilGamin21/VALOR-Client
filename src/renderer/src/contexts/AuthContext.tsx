import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import * as api from '@/services/api'
import type { User } from '@/types/media'
import type { AccountEntry } from '@/types/electron'

interface AuthState {
  user: User | null
  token: string | null
  accounts: AccountEntry[]
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  switchAccount: (accountId: string) => Promise<void>
  removeAccount: (accountId: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Reload accounts list from platform storage
  const reloadAccounts = useCallback(async () => {
    const stored = await window.electronAPI.auth.getAccounts()
    setAccounts(stored)
  }, [])

  // On mount, restore session from platform storage
  useEffect(() => {
    async function restore() {
      try {
        const storedAccounts = await window.electronAPI.auth.getAccounts()
        const storedToken = await window.electronAPI.auth.getToken()

        if (storedAccounts.length > 0 && storedToken) {
          // Multi-account path
          setToken(storedToken)
          setAccounts(storedAccounts)
          const me = await api.getMe()
          setUser(me)
        } else if (storedToken) {
          // Legacy single-token migration
          setToken(storedToken)
          const me = await api.getMe()
          setUser(me)
          // Migrate to multi-account store
          await window.electronAPI.auth.addAccount({
            id: me.id,
            username: me.username,
            token: storedToken,
            avatarUrl: me.avatarUrl ?? null,
          })
          const migrated = await window.electronAPI.auth.getAccounts()
          setAccounts(migrated)
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
    // Store as multi-account entry
    await window.electronAPI.auth.addAccount({
      id: res.user.id,
      username: res.user.username,
      token: res.token,
      avatarUrl: res.user.avatarUrl ?? null,
    })
    setToken(res.token)
    setUser(res.user)
    await reloadAccounts()
  }, [reloadAccounts])

  const logout = useCallback(async () => {
    const activeId = user?.id
    if (activeId) {
      await window.electronAPI.auth.removeAccount(activeId)
    } else {
      await window.electronAPI.auth.clearToken()
    }
    // Check if other accounts remain
    const remaining = await window.electronAPI.auth.getAccounts()
    setAccounts(remaining)
    if (remaining.length > 0) {
      // Switch to first remaining account
      await window.electronAPI.auth.switchAccount(remaining[0].id)
      setToken(remaining[0].token)
      const me = await api.getMe()
      setUser(me)
    } else {
      setToken(null)
      setUser(null)
    }
  }, [user])

  const switchAccount = useCallback(async (accountId: string) => {
    await window.electronAPI.auth.switchAccount(accountId)
    const acct = accounts.find(a => a.id === accountId)
    if (acct) {
      setToken(acct.token)
      try {
        const me = await api.getMe()
        setUser(me)
      } catch {
        // Token expired — remove this account
        await window.electronAPI.auth.removeAccount(accountId)
        await reloadAccounts()
        setToken(null)
        setUser(null)
      }
    }
  }, [accounts, reloadAccounts])

  const removeAccount = useCallback(async (accountId: string) => {
    await window.electronAPI.auth.removeAccount(accountId)
    const remaining = await window.electronAPI.auth.getAccounts()
    setAccounts(remaining)
    // If we removed the active account, switch or clear
    if (user?.id === accountId) {
      if (remaining.length > 0) {
        await window.electronAPI.auth.switchAccount(remaining[0].id)
        setToken(remaining[0].token)
        const me = await api.getMe()
        setUser(me)
      } else {
        setToken(null)
        setUser(null)
      }
    }
  }, [user])

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.getMe()
      setUser(me)
      // Update stored account entry with fresh avatar
      if (me.id && token) {
        await window.electronAPI.auth.addAccount({
          id: me.id,
          username: me.username,
          token,
          avatarUrl: me.avatarUrl ?? null,
        })
        await reloadAccounts()
      }
    } catch { /* ignore */ }
  }, [token, reloadAccounts])

  return (
    <AuthContext.Provider value={{ user, token, accounts, loading, login, logout, refreshUser, switchAccount, removeAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
