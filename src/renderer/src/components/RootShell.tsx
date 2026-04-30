import { useState, useRef, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import {
  Home,
  Film,
  Tv,
  Bookmark,
  Shield,
  Search,
  LogOut,
  ArrowDownToLine,
  Settings,
  Compass,
  Cast,
  Plus,
  User as UserIcon,
} from 'lucide-react'
import TitleBar from './TitleBar'
import VideoPlayer from './VideoPlayer'
import UpdateBanner from './UpdateBanner'
import ConnectBar from './ConnectBar'
import MpvRecommendationModal from './MpvRecommendationModal'
import { useConnect } from '@/contexts/ConnectContext'
import { useAuth } from '@/contexts/AuthContext'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'

const NAV = [
  { to: '/home',      label: 'Home',      icon: Home     },
  { to: '/discover',  label: 'Discover',  icon: Compass  },
  { to: '/movies',    label: 'Movies',    icon: Film     },
  { to: '/tv',        label: 'TV Shows',  icon: Tv       },
  { to: '/watchlist', label: 'Watchlist', icon: Bookmark },
  { to: '/connect',   label: 'Connect',   icon: Cast     },
]

// Shared nav icon classes — matches the website's icon sidebar style exactly
const iconBase =
  'flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-150'
const iconActive =
  'text-white bg-white/15 shadow-[0_0_14px_rgba(255,255,255,0.35)] ring-1 ring-white/25'
const iconInactive =
  'text-white/50 hover:text-white/90 hover:bg-white/10'

export default function RootShell() {
  const { user, logout, accounts, switchAccount } = useAuth()
  const { isOpen, job, startPositionTicks, closePlayer } = usePlayer()
  const { discordRPC } = useSettings()
  const connectCtx = useConnect()
  const otherDeviceCount = connectCtx ? connectCtx.devices.filter(d => d.deviceId !== connectCtx.thisDeviceId).length : 0
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [hasUpdate, setHasUpdate] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)

  // Reset avatar error when URL changes (e.g. after upload)
  useEffect(() => { setAvatarError(false) }, [user?.avatarUrl])

  // Listen for update-downloaded so the sidebar icon can trigger install directly
  useEffect(() => {
    window.electronAPI.updates.onDownloaded(() => setUpdateReady(true))
  }, [])

  // Clear Discord activity when the user disables RPC
  useEffect(() => {
    if (!discordRPC) window.electronAPI.discord.clearActivity().catch(() => {})
  }, [discordRPC])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (search.trim()) {
      navigate(`/home?q=${encodeURIComponent(search.trim())}`)
      setSearch('')
    }
  }

  async function handleLogout() {
    await logout()
    // AuthContext.logout switches to next account if available;
    // only navigate to login if no user remains
    const remaining = await window.electronAPI.auth.getAccounts()
    if (remaining.length === 0) navigate('/login')
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] overflow-hidden">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Narrow icon sidebar ──────────────────────────────────────────── */}
        <aside className="relative flex-shrink-0 w-14 flex flex-col bg-black/70 border-r border-white/10">

          {/* Avatar → Account switcher (top of sidebar) */}
          <div className="pt-3 flex flex-col items-center gap-1 px-2">
            <button
              data-focusable
              onClick={() => setShowAccountSwitcher(prev => !prev)}
              title="Account switcher"
              className={`${iconBase} ${showAccountSwitcher ? iconActive : iconInactive}`}
            >
              {user?.avatarUrl && !avatarError ? (
                <img
                  src={user.avatarUrl}
                  alt="avatar"
                  className="w-7 h-7 rounded-full object-cover"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-white/80 text-black flex items-center justify-center text-[10px] font-bold">
                  {user?.username?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
            </button>

            {/* Account switcher popover — fixed z-50 wrapper for gamepad modal detection */}
            {showAccountSwitcher && (
              <div className="fixed inset-0 z-50">
                {/* Backdrop — data-modal-close lets gamepad B button close it */}
                <div
                  className="absolute inset-0"
                  data-modal-close
                  onClick={() => setShowAccountSwitcher(false)}
                />
                <div className="absolute left-16 top-10 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl p-4 min-w-[200px]">
                  {/* Account circles */}
                  <div className="flex items-center gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                    {accounts.map(acct => (
                      <button
                        data-focusable
                        key={acct.id}
                        onClick={() => { switchAccount(acct.id); setShowAccountSwitcher(false) }}
                        className={`flex-shrink-0 flex flex-col items-center gap-1 transition ${
                          acct.id === user?.id ? 'opacity-100' : 'opacity-50 hover:opacity-80'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full overflow-hidden border-2 ${
                          acct.id === user?.id ? 'border-red-500' : 'border-transparent'
                        }`}>
                          {acct.avatarUrl ? (
                            <img src={acct.avatarUrl} className="w-full h-full object-cover" alt={acct.username} />
                          ) : (
                            <div className="w-full h-full bg-white/80 text-black flex items-center justify-center text-sm font-bold">
                              {acct.username[0]?.toUpperCase()}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-white/60 truncate max-w-[56px]">{acct.username}</span>
                      </button>
                    ))}

                    {/* Add account button */}
                    <button
                      data-focusable
                      onClick={() => { setShowAccountSwitcher(false); navigate('/login?addAccount=true') }}
                      className="flex-shrink-0 flex flex-col items-center gap-1 opacity-50 hover:opacity-80 transition"
                      title="Add account"
                    >
                      <div className="w-10 h-10 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center">
                        <Plus size={16} className="text-white/40" />
                      </div>
                      <span className="text-[10px] text-white/40">Add</span>
                    </button>
                  </div>

                  {/* Profile Settings link */}
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <button
                      data-focusable
                      onClick={() => { setShowAccountSwitcher(false); navigate('/profile') }}
                      className="w-full text-left text-sm text-white/60 hover:text-white py-1.5 px-1 rounded
                                 hover:bg-white/5 transition flex items-center gap-2"
                    >
                      <UserIcon size={14} />
                      Profile Settings
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="w-6 h-px bg-white/10 my-1" />

            {/* Main nav */}
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                data-focusable
                key={to}
                to={to}
                title={label}
                className={({ isActive }) =>
                  `${iconBase} ${isActive ? iconActive : iconInactive} relative`
                }
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {to === '/connect' && otherDeviceCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 text-[9px] font-bold text-white flex items-center justify-center">
                    {otherDeviceCount}
                  </span>
                )}
                {to === '/connect' && connectCtx?.targetDevice && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0a0a0a] animate-pulse" />
                )}
              </NavLink>
            ))}

            {/* Admin (admin users only) */}
            {user?.role === 'admin' && (
              <NavLink
                data-focusable
                to="/admin"
                title="Admin"
                className={({ isActive }) =>
                  `${iconBase} ${isActive ? iconActive : iconInactive}`
                }
              >
                <Shield className="w-5 h-5 flex-shrink-0" />
              </NavLink>
            )}
          </div>

          {/* Bottom: settings + update bell + sign out */}
          <div className="mt-auto flex flex-col items-center gap-1 px-2 pb-4">
            <NavLink
              data-focusable
              to="/settings"
              title="Settings"
              className={({ isActive }) =>
                `${iconBase} ${isActive ? iconActive : iconInactive}`
              }
            >
              <Settings className="w-5 h-5 flex-shrink-0" />
            </NavLink>
            {updateReady && (
              <button
                data-focusable
                onClick={() => window.electronAPI.updates.install()}
                title="Update ready — click to restart and update"
                className={`${iconBase} text-green-400 hover:text-green-300 hover:bg-green-500/15 animate-pulse`}
              >
                <ArrowDownToLine className="w-5 h-5 flex-shrink-0" />
              </button>
            )}
            {hasUpdate && !updateReady && (
              <button
                data-focusable
                onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                title="Update downloading…"
                className={`${iconBase} text-amber-400 hover:text-amber-300 hover:bg-amber-500/10`}
              >
                <ArrowDownToLine className="w-5 h-5 flex-shrink-0 animate-bounce" />
              </button>
            )}
            <button
              data-focusable
              onClick={handleLogout}
              title="Sign out"
              className={`${iconBase} text-red-400/70 hover:text-red-300 hover:bg-red-500/15`}
            >
              <LogOut className="w-5 h-5 flex-shrink-0" />
            </button>
          </div>
        </aside>

        {/* ── Main column: header + content ───────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Header */}
          <header className="flex-shrink-0 h-10 flex items-center gap-3 px-4
                             bg-black/70 border-b border-white/10 backdrop-blur-xl">
            <span className="font-semibold tracking-wide text-sm text-white/90 flex-shrink-0">
              VALOR
            </span>

            <form onSubmit={handleSearch} className="flex-1 max-w-md mx-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full bg-black/40 border border-white/20 rounded-full
                             pl-8 pr-4 py-1 text-sm text-white placeholder:text-white/40
                             focus:outline-none focus:border-white/50 focus:bg-black/60 transition-colors"
                />
              </div>
            </form>
          </header>

          {/* Update banner — slim strip below header, only shown when update available */}
          <UpdateBanner onVisibilityChange={setHasUpdate} />

          {/* Being controlled indicator */}
          {connectCtx?.controlledBy && (
            <div className="flex-shrink-0 flex items-center gap-3 px-4 py-1.5 bg-emerald-950/60 border-b border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="text-xs text-emerald-300/80 flex-1">
                Being controlled by <span className="font-medium text-emerald-300">{connectCtx.controlledBy}</span>
              </span>
              <button
                data-focusable
                onClick={connectCtx.rejectControl}
                className="text-[10px] text-white/40 hover:text-red-400 px-2 py-0.5 rounded hover:bg-red-500/10 transition"
              >
                Stop
              </button>
            </div>
          )}

          {/* Page content */}
          <main ref={mainRef} className="flex-1 overflow-y-auto">
            <Outlet key={user?.id} />
          </main>
        </div>
      </div>

      {/* Connect bar — persistent when controlling a remote device */}
      <ConnectBar />

      {/* Full-screen video player overlay */}
      <AnimatePresence>
        {isOpen && job && (
          <VideoPlayer
            job={job}
            startPositionTicks={startPositionTicks}
            onClose={closePlayer}
          />
        )}
      </AnimatePresence>

      {/* One-shot popups (each manages its own dismissal via localStorage) */}
      {/* MpvRecommendationModal disabled while mpv is shelved. Re-enable when mpv comes back. */}
      {/* <MpvRecommendationModal /> */}
    </div>
  )
}
