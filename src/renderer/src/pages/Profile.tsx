import { useState, useRef, useEffect } from 'react'
import { Camera, Save, Loader2, Crown, Clock, AlertTriangle } from 'lucide-react'
import * as api from '@/services/api'
import { useAuth } from '@/contexts/AuthContext'
import type { User } from '@/types/media'

function TierBadge({ user }: { user: User }) {
  const tier = user.tier ?? 'free'
  const isAdmin = user.role === 'admin'

  if (isAdmin || tier === 'lifetime') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                      bg-gradient-to-r from-amber-500/20 to-yellow-500/15 border border-amber-500/30">
        <Crown size={12} className="text-amber-400" />
        <span className="text-xs font-semibold text-amber-300">Lifetime Premium</span>
      </div>
    )
  }

  if (tier === 'subscription') {
    const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null
    const isExpired = expiresAt ? expiresAt < new Date() : false
    if (isExpired) {
      return (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                        bg-red-500/10 border border-red-500/20">
          <AlertTriangle size={12} className="text-red-400" />
          <span className="text-xs font-semibold text-red-300">Subscription expired</span>
        </div>
      )
    }
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                      bg-gradient-to-r from-amber-500/20 to-yellow-500/15 border border-amber-500/30">
        <Crown size={12} className="text-amber-400" />
        <span className="text-xs font-semibold text-amber-300">
          Premium{expiresAt ? ` — expires ${expiresAt.toLocaleDateString()}` : ''}
        </span>
      </div>
    )
  }

  if (tier === 'trial') {
    const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null
    const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)) : null
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                      bg-blue-500/10 border border-blue-500/20">
        <Clock size={12} className="text-blue-400" />
        <span className="text-xs font-semibold text-blue-300">
          Trial{daysLeft !== null ? ` — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining` : ''}
        </span>
      </div>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                    bg-white/5 border border-white/10">
      <span className="text-xs font-semibold text-white/40">Free plan</span>
    </div>
  )
}

export default function Profile() {
  const { user } = useAuth()
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
      setMessage('Avatar updated.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setUploadingAvatar(false)
    }
  }

  const displayAvatar = avatarUrl || null

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-xl font-bold text-white mb-8">Profile</h1>

      {/* Avatar */}
      <div className="flex items-center gap-5 mb-8">
        <div className="relative">
          {displayAvatar ? (
            <img
              src={displayAvatar}
              alt="avatar"
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-red-700 flex items-center justify-center text-2xl font-black text-white">
              {user?.username?.[0]?.toUpperCase()}
            </div>
          )}
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
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
        </div>
        <div>
          <p className="font-semibold text-white">{user?.username}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs uppercase tracking-wide px-2 py-0.5 rounded bg-white/10 text-white/50">
              {user?.role}
            </span>
            {user && <TierBadge user={user} />}
          </div>
        </div>
      </div>

      {/* Fields */}
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

      {message && (
        <p className="mb-4 text-sm text-white/60">{message}</p>
      )}

      <button
        onClick={saveProfile}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500
                   text-white font-semibold text-sm transition disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Save Changes
      </button>
    </div>
  )
}
