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

  // On mount, restore session from platform storage.
  //
  // Prior bug: a single getMe() failure (network blip at app launch, slow DNS,
  // backend cold-start, flaky Wi-Fi finishing connect, etc.) ran clearToken()
  // and wiped the user's saved login. Users with reliable networks never saw
  // it; users with slower startup networks got prompted to re-login on every
  // launch. Now we retry transient failures and only clear on actual 401
  // (which request() already handles by setting the message to 'Session
  // expired' and clearing the token itself).
  useEffect(() => {
    async function restore() {
      const storedAccounts = await window.electronAPI.auth.getAccounts().catch(() => [])
      const storedToken = await window.electronAPI.auth.getToken().catch(() => null)

      if (!storedToken) {
        setLoading(false)
        return
      }

      // Optimistically populate token + accounts so React doesn't flash an
      // unauthenticated state during the getMe round-trip.
      setToken(storedToken)
      setAccounts(storedAccounts)

      let me: User | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          me = await api.getMe()
          break
        } catch (err) {
          // 401 = real auth failure. request() already cleared the token —
          // stop retrying and fall through with me=null.
          if (err instanceof Error && err.message === 'Session expired') break
          // Transient — back off and retry. 800ms / 1.6s gives the network
          // ~2.4s total to come up.
          if (attempt < 2) await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
        }
      }

      if (me) {
        setUser(me)
        // Legacy migration: token in storage but no accounts list yet.
        if (storedAccounts.length === 0) {
          await window.electronAPI.auth.addAccount({
            id: me.id,
            username: me.username,
            token: storedToken,
            avatarUrl: me.avatarUrl ?? null,
          })
          const migrated = await window.electronAPI.auth.getAccounts()
          setAccounts(migrated)
        }
      }
      // If me is still null after retries and the token wasn't 401-cleared,
      // it stays in storage. User may see login screen this session if the
      // network never recovered, but their account isn't lost — the next
      // launch (or a manual reload) will restore them once the backend is
      // reachable.

      setLoading(false)
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
