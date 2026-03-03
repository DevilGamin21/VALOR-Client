import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Edit2, Check, X, Shield, Database } from 'lucide-react'
import * as api from '@/services/api'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import type { User } from '@/types/media'

interface EditState {
  id: string
  username: string
  email: string
  role: string
  password: string
  tier: string
}

export default function Admin() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', email: '', role: 'user' })
  const [error, setError] = useState('')
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null)
  const [scanLoading, setScanLoading] = useState(false)

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

  async function handleSave() {
    if (!editing) return
    setError('')
    try {
      await Promise.all([
        api.updateUser(editing.id, {
          email: editing.email,
          role: editing.role as 'admin' | 'user',
          ...(editing.password ? { password: editing.password } : {})
        }),
        api.patchUserTier(editing.id, editing.tier as api.UserTier)
      ])
      setUsers((prev) => prev.map((u) =>
        u.id === editing.id
          ? { ...u, email: editing.email, role: editing.role as 'admin' | 'user', tier: editing.tier as api.UserTier }
          : u
      ))
      setEditing(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleScanLibrary() {
    setScanLoading(true)
    try {
      await api.scanLibrary()
    } catch {
      // ignore
    } finally {
      setScanLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this user?')) return
    try {
      await api.deleteUser(id)
      setUsers((prev) => prev.filter((u) => u.id !== id))
    } catch (e) {
      setError((e as Error).message)
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
    <div className="p-6 pb-8 max-w-3xl">
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

      {/* Users table */}
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

      <div className="flex flex-col gap-2">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex items-center gap-3 p-3 rounded-lg bg-dark-card border border-dark-border"
          >
            <div className="w-8 h-8 rounded-full bg-red-700/40 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
              {u.username[0].toUpperCase()}
            </div>

            {editing?.id === u.id ? (
              <div className="flex-1 flex flex-wrap items-center gap-2">
                <input
                  value={editing.email}
                  onChange={(e) => setEditing((p) => p && ({ ...p, email: e.target.value }))}
                  placeholder="Email"
                  className="flex-1 min-w-24 bg-white/5 border border-dark-border rounded px-2 py-1 text-sm text-white focus:outline-none"
                />
                <input
                  type="password"
                  value={editing.password}
                  onChange={(e) => setEditing((p) => p && ({ ...p, password: e.target.value }))}
                  placeholder="New password"
                  className="flex-1 min-w-24 bg-white/5 border border-dark-border rounded px-2 py-1 text-sm text-white focus:outline-none"
                />
                <select
                  value={editing.role}
                  onChange={(e) => setEditing((p) => p && ({ ...p, role: e.target.value }))}
                  className="bg-white/5 border border-dark-border rounded px-2 py-1 text-sm text-white focus:outline-none"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <select
                  value={editing.tier}
                  onChange={(e) => setEditing((p) => p && ({ ...p, tier: e.target.value }))}
                  className="bg-white/5 border border-dark-border rounded px-2 py-1 text-sm text-white focus:outline-none"
                >
                  <option value="free">Free</option>
                  <option value="trial">Trial</option>
                  <option value="subscription">Subscription</option>
                  <option value="lifetime">Lifetime</option>
                </select>
                <button onClick={handleSave} className="text-green-400 hover:text-green-300">
                  <Check size={16} />
                </button>
                <button onClick={() => setEditing(null)} className="text-white/40 hover:text-white">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{u.username}</p>
                  <p className="text-xs text-white/40">{u.email || 'No email'}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wide ${
                  u.role === 'admin' ? 'bg-red-600/20 text-red-400' : 'bg-white/8 text-white/40'
                }`}>
                  {u.role}
                </span>
                {u.tier && (
                  <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wide ${
                    u.tier === 'lifetime' ? 'bg-yellow-600/20 text-yellow-400' :
                    u.tier === 'subscription' ? 'bg-green-600/20 text-green-400' :
                    u.tier === 'trial' ? 'bg-blue-600/20 text-blue-400' :
                    'bg-white/5 text-white/30'
                  }`}>
                    {u.tier}
                  </span>
                )}
                <button
                  onClick={() => setEditing({ id: u.id, username: u.username, email: u.email ?? '', role: u.role, password: '', tier: u.tier ?? 'free' })}
                  className="text-white/30 hover:text-white transition"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleDelete(u.id)}
                  className="text-white/20 hover:text-red-400 transition"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
