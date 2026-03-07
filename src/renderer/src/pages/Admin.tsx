import { useEffect, useState, Fragment } from 'react'
import { Loader2, Plus, Trash2, Check, X, Shield, Database, RefreshCw } from 'lucide-react'
import * as api from '@/services/api'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import type { User } from '@/types/media'

// ─── Tier helpers ────────────────────────────────────────────────────────────

function tierDaysRemaining(user: User): number {
  if (user.tier !== 'trial' || !user.trialStartedAt) return 0
  const end = new Date(user.trialStartedAt)
  end.setDate(end.getDate() + 30)
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000))
}

function TierBadge({ user }: { user: User }) {
  if (user.role === 'admin' || user.tier === 'lifetime') {
    return <span className="text-xs font-semibold text-purple-400">Lifetime</span>
  }
  if (user.tier === 'subscription') {
    if (!user.subscriptionExpiresAt) {
      return <span className="text-xs font-semibold text-emerald-400">Premium</span>
    }
    const exp = new Date(user.subscriptionExpiresAt)
    const active = exp > new Date()
    return active ? (
      <span className="text-xs font-semibold text-emerald-400">
        Premium &middot; {exp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
      </span>
    ) : (
      <span className="text-xs font-semibold text-red-400">Subscription expired</span>
    )
  }
  if (user.tier === 'trial') {
    const days = tierDaysRemaining(user)
    return days > 0 ? (
      <span className="text-xs font-semibold text-blue-400">Trial &middot; {days}d left</span>
    ) : (
      <span className="text-xs font-semibold text-red-400">Trial expired</span>
    )
  }
  return <span className="text-xs text-white/30">Free</span>
}

// ─── Tier Editor ─────────────────────────────────────────────────────────────

function TierEditor({
  user,
  onSaved,
  onCancel,
}: {
  user: User
  onSaved: () => void
  onCancel: () => void
}) {
  const [tier, setTier] = useState<api.UserTier>(user.tier ?? 'free')
  const [expiry, setExpiry] = useState(
    user.subscriptionExpiresAt ? user.subscriptionExpiresAt.slice(0, 10) : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const expiryIso = tier === 'subscription' && expiry
        ? new Date(expiry).toISOString()
        : null
      await api.patchUserTier(user.id, tier, expiryIso)
      onSaved()
    } catch (e) {
      setError((e as Error).message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <select
        value={tier}
        onChange={(e) => setTier(e.target.value as api.UserTier)}
        className="text-xs bg-white/5 border border-dark-border rounded px-2 py-1 text-white focus:outline-none focus:border-white/30"
      >
        <option value="trial">Trial (30 days)</option>
        <option value="subscription">Subscription</option>
        <option value="lifetime">Lifetime</option>
        <option value="free">Free</option>
      </select>
      {tier === 'subscription' && (
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="text-xs bg-white/5 border border-dark-border rounded px-2 py-1 text-white focus:outline-none focus:border-white/30"
        />
      )}
      <button
        onClick={handleSave}
        disabled={saving}
        className="text-xs px-2.5 py-1 rounded bg-red-600 text-white font-medium hover:bg-red-500 disabled:opacity-50 transition"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button
        onClick={onCancel}
        className="text-xs px-2.5 py-1 rounded bg-white/8 text-white/60 hover:bg-white/12 transition"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

// ─── Admin Page ──────────────────────────────────────────────────────────────

export default function Admin() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', email: '', role: 'user' })
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [editingTierId, setEditingTierId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncFeedback, setSyncFeedback] = useState<Record<string, string>>({})

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/home', { replace: true })
      return
    }
    Promise.all([api.getUsers(), api.getDiagnostics()])
      .then(([u, d]) => { setUsers(u); setDiagnostics(d) })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [user, navigate])

  async function refreshUsers() {
    try {
      const u = await api.getUsers()
      setUsers(u)
    } catch {
      setError('Failed to refresh users')
    }
  }

  async function handleCreate() {
    setError('')
    try {
      const u = await api.createUser(newUser)
      setUsers((prev) => [...prev, u])
      setCreating(false)
      setNewUser({ username: '', password: '', email: '', role: 'user' })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleScanLibrary() {
    setScanLoading(true)
    try { await api.scanLibrary() } catch { /* ignore */ }
    finally { setScanLoading(false) }
  }

  async function handleDelete(u: User) {
    if (!confirm(`Delete user "${u.username}"?`)) return
    try {
      await api.deleteUser(u.id)
      setUsers((prev) => prev.filter((x) => x.id !== u.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleSync(u: User) {
    setSyncingId(u.id)
    try {
      await api.syncUserAccess(u.id)
      setSyncFeedback((f) => ({ ...f, [u.id]: 'Synced' }))
      setTimeout(() => setSyncFeedback((f) => { const n = { ...f }; delete n[u.id]; return n }), 2000)
    } catch {
      setSyncFeedback((f) => ({ ...f, [u.id]: 'Failed' }))
      setTimeout(() => setSyncFeedback((f) => { const n = { ...f }; delete n[u.id]; return n }), 2000)
    } finally {
      setSyncingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-white/30" />
      </div>
    )
  }

  return (
    <div className="p-6 pb-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-8">
        <Shield size={20} className="text-red-500" />
        <h1 className="text-xl font-bold text-white">Admin</h1>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-900/20 border border-red-700/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Diagnostics */}
      {diagnostics && (
        <div className="mb-6 p-4 rounded-lg bg-dark-card border border-dark-border">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-white">System Diagnostics</h2>
            <button
              onClick={handleScanLibrary}
              disabled={scanLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12
                         text-white/60 text-xs transition disabled:opacity-50"
            >
              {scanLoading ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
              Scan Library
            </button>
          </div>
          <pre className="text-xs text-white/40 overflow-x-auto">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        </div>
      )}

      {/* Create user toggle */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Users</h2>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500
                     text-white text-xs font-medium transition"
        >
          <Plus size={12} />
          New User
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="mb-4 p-4 rounded-lg bg-dark-card border border-dark-border flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Username"
              value={newUser.username}
              onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
              className="bg-white/5 border border-dark-border rounded-lg px-3 py-2 text-sm text-white
                         focus:outline-none focus:border-white/20"
            />
            <input
              type="password"
              placeholder="Password"
              value={newUser.password}
              onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
              className="bg-white/5 border border-dark-border rounded-lg px-3 py-2 text-sm text-white
                         focus:outline-none focus:border-white/20"
            />
            <input
              placeholder="Email (optional)"
              value={newUser.email}
              onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
              className="bg-white/5 border border-dark-border rounded-lg px-3 py-2 text-sm text-white
                         focus:outline-none focus:border-white/20"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value }))}
              className="bg-white/5 border border-dark-border rounded-lg px-3 py-2 text-sm text-white
                         focus:outline-none focus:border-white/20"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-500 transition">
              Create
            </button>
            <button onClick={() => setCreating(false)} className="px-4 py-1.5 rounded-lg bg-white/8 text-white/60 text-sm hover:bg-white/12 transition">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-card">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-white/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">User</th>
              <th className="text-left px-3 py-2 font-medium">Email</th>
              <th className="text-left px-3 py-2 font-medium">Role</th>
              <th className="text-left px-3 py-2 font-medium">Jellyfin</th>
              <th className="text-left px-3 py-2 font-medium">Access</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr className="border-t border-dark-border hover:bg-white/[0.03] transition-colors">
                  <td className="px-3 py-2 text-white font-medium">{u.username}</td>
                  <td className="px-3 py-2 text-white/40">{u.email || <span className="text-white/20">&mdash;</span>}</td>
                  <td className="px-3 py-2">
                    {u.role === 'admin' ? (
                      <span className="text-xs font-semibold text-red-400">Admin</span>
                    ) : (
                      <span className="text-xs text-white/40">User</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.jellyfinUserId ? (
                      <span className="text-xs font-semibold text-emerald-400">Linked</span>
                    ) : (
                      <span className="text-xs text-yellow-400">Not linked</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <TierBadge user={u} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => setEditingTierId(editingTierId === u.id ? null : u.id)}
                        className="px-2 py-1 rounded border border-dark-border text-xs text-white/60
                                   hover:bg-white/8 transition"
                      >
                        Edit tier
                      </button>
                      <button
                        onClick={() => handleSync(u)}
                        disabled={syncingId === u.id}
                        title="Sync Jellyfin library access"
                        className="px-2 py-1 rounded border border-dark-border text-xs text-white/60
                                   hover:bg-white/8 disabled:opacity-50 transition"
                      >
                        {syncFeedback[u.id] ? (
                          <span className={syncFeedback[u.id] === 'Synced' ? 'text-emerald-400' : 'text-red-400'}>
                            {syncFeedback[u.id]}
                          </span>
                        ) : syncingId === u.id ? (
                          <Loader2 size={12} className="animate-spin inline" />
                        ) : (
                          <><RefreshCw size={12} className="inline mr-1" />Sync</>
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1 rounded border border-dark-border text-white/30
                                   hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                {editingTierId === u.id && (
                  <tr className="border-t border-dark-border bg-white/[0.02]">
                    <td colSpan={6} className="px-3 py-2">
                      <TierEditor
                        user={u}
                        onSaved={async () => { setEditingTierId(null); await refreshUsers() }}
                        onCancel={() => setEditingTierId(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
