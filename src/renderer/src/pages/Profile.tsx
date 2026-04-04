import { useState, useRef, useEffect } from 'react'
import { Camera, Save, Loader2, Crown, Clock, AlertTriangle, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as api from '@/services/api'
import { useAuth } from '@/contexts/AuthContext'
import { isTv } from '@/hooks/usePlatform'
import { platform } from '@/platform'
import type { User } from '@/types/media'

function TierBadge({ user }: { user: User }) {
  const tier = user.tier ?? 'free'
  const isAdmin = user.role === 'admin'

  if (isAdmin || tier === 'lifetime') {
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-yellow-500/15 border border-amber-500/30 ${isTv ? 'px-4 py-2' : 'px-2.5 py-1'}`}>
        <Crown size={isTv ? 16 : 12} className="text-amber-400" />
        <span className={`font-semibold text-amber-300 ${isTv ? 'text-sm' : 'text-xs'}`}>Lifetime Premium</span>
      </div>
    )
  }

  if (tier === 'subscription') {
    const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null
    const isExpired = expiresAt ? expiresAt < new Date() : false
    if (isExpired) {
      return (
        <div className={`inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 ${isTv ? 'px-4 py-2' : 'px-2.5 py-1'}`}>
          <AlertTriangle size={isTv ? 16 : 12} className="text-red-400" />
          <span className={`font-semibold text-red-300 ${isTv ? 'text-sm' : 'text-xs'}`}>Subscription expired</span>
        </div>
      )
    }
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-yellow-500/15 border border-amber-500/30 ${isTv ? 'px-4 py-2' : 'px-2.5 py-1'}`}>
        <Crown size={isTv ? 16 : 12} className="text-amber-400" />
        <span className={`font-semibold text-amber-300 ${isTv ? 'text-sm' : 'text-xs'}`}>
          Premium{expiresAt ? ` — expires ${expiresAt.toLocaleDateString()}` : ''}
        </span>
      </div>
    )
  }

  if (tier === 'trial') {
    const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null
    const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)) : null
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 ${isTv ? 'px-4 py-2' : 'px-2.5 py-1'}`}>
        <Clock size={isTv ? 16 : 12} className="text-blue-400" />
        <span className={`font-semibold text-blue-300 ${isTv ? 'text-sm' : 'text-xs'}`}>
          Trial{daysLeft !== null ? ` — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining` : ''}
        </span>
      </div>
    )
  }

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 ${isTv ? 'px-4 py-2' : 'px-2.5 py-1'}`}>
      <span className={`font-semibold text-white/40 ${isTv ? 'text-sm' : 'text-xs'}`}>Free plan</span>
    </div>
  )
}

export default function Profile() {
  const { user, refreshUser, logout } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState(user?.email ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.getProfile().then((p) => {
      setEmail(p.email ?? '')
      setAvatarUrl(p.avatarUrl ?? '')
    }).catch(() => {})
  }, [])

  async function saveProfile() {
    setSaving(true)
    setMessage('')
    try {
      await api.updateProfile({ email })
      setMessage('Profile saved.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    try {
      const res = await api.uploadAvatar(file)
      setAvatarUrl(res.avatarUrl)
      await refreshUser()
      setMessage('Avatar updated.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleLogout() {
    await logout()
    const remaining = await platform.auth.getAccounts()
    if (remaining.length === 0) navigate('/login')
  }

  const displayAvatar = avatarUrl || null

  return (
    <div className={isTv ? 'flex flex-col items-center py-12 px-12' : 'p-6 max-w-md'}>
      <h1 className={`font-bold text-white ${isTv ? 'text-3xl mb-10' : 'text-xl mb-8'}`}>Profile</h1>

      {/* Avatar */}
      <div className={`flex items-center gap-5 ${isTv ? 'flex-col gap-4 mb-10' : 'mb-8'}`}>
        <div className="relative">
          {displayAvatar ? (
            <img
              src={displayAvatar}
              alt="avatar"
              className={`rounded-full object-cover ${isTv ? 'w-28 h-28' : 'w-20 h-20'}`}
            />
          ) : (
            <div className={`rounded-full bg-red-700 flex items-center justify-center font-black text-white ${isTv ? 'w-28 h-28 text-3xl' : 'w-20 h-20 text-2xl'}`}>
              {user?.username?.[0]?.toUpperCase()}
            </div>
          )}
          {!isTv && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-dark-card border border-dark-border
                         flex items-center justify-center hover:bg-white/10 transition"
            >
              {uploadingAvatar ? (
                <Loader2 size={12} className="animate-spin text-white/60" />
              ) : (
                <Camera size={12} className="text-white/60" />
              )}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
        </div>
        <div className={isTv ? 'text-center' : ''}>
          <p className={`font-semibold text-white ${isTv ? 'text-2xl' : ''}`}>{user?.username}</p>
          <div className={`flex items-center gap-2 mt-1 ${isTv ? 'justify-center mt-2' : ''}`}>
            <span className={`uppercase tracking-wide rounded bg-white/10 text-white/50 ${isTv ? 'text-sm px-3 py-1' : 'text-xs px-2 py-0.5'}`}>
              {user?.role}
            </span>
            {user && <TierBadge user={user} />}
          </div>
        </div>
      </div>

      {/* Fields */}
      {!isTv && (
        <div className="flex flex-col gap-4 mb-6">
          <div>
            <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-dark-border rounded-lg px-4 py-2.5
                         text-white text-sm focus:outline-none focus:border-white/20 transition"
              placeholder="email@example.com"
            />
          </div>
        </div>
      )}

      {message && (
        <p className={`mb-4 text-white/60 ${isTv ? 'text-base' : 'text-sm'}`}>{message}</p>
      )}

      {!isTv && (
        <button
          onClick={saveProfile}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500
                     text-white font-semibold text-sm transition disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      )}

      {/* TV: Settings + Logout buttons */}
      {isTv && (
        <div className="flex flex-col gap-3 mt-6 w-full max-w-sm">
          <button
            data-focusable
            onClick={() => navigate('/settings')}
            className="tv-btn-outline flex items-center justify-center gap-2 py-3"
          >
            Settings
          </button>
          <button
            data-focusable
            onClick={handleLogout}
            className="tv-btn-outline flex items-center justify-center gap-2 py-3 text-red-500 border-red-500/30"
          >
            <LogOut size={16} />
            Log Out
          </button>
        </div>
      )}
    </div>
  )
}
