import { useState, useRef, useEffect } from 'react'
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
  Boxes,
} from 'lucide-react'
import TitleBar from './TitleBar'
import VideoPlayer from './VideoPlayer'
import UpdateBanner from './UpdateBanner'
import { useAuth } from '@/contexts/AuthContext'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'

const NAV = [
  { to: '/home',      label: 'Home',      icon: Home     },
  { to: '/movies',    label: 'Movies',    icon: Film     },
  { to: '/tv',        label: 'TV Shows',  icon: Tv       },
  { to: '/watchlist', label: 'Watchlist', icon: Bookmark },
]

// Shared nav icon classes — matches the website's icon sidebar style exactly
const iconBase =
  'flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-150'
const iconActive =
  'text-white bg-white/15 shadow-[0_0_14px_rgba(255,255,255,0.35)] ring-1 ring-white/25'
const iconInactive =
  'text-white/50 hover:text-white/90 hover:bg-white/10'

export default function RootShell() {
  const { user, logout } = useAuth()
  const { isOpen, job, startPositionTicks, closePlayer } = usePlayer()
  const { discordRPC } = useSettings()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [hasUpdate, setHasUpdate] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)

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
    navigate('/login')
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] overflow-hidden">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Narrow icon sidebar ──────────────────────────────────────────── */}
        <aside className="flex-shrink-0 w-14 flex flex-col bg-black/70 border-r border-white/10">

          {/* Avatar → Profile (top of sidebar) */}
          <div className="pt-3 flex flex-col items-center gap-1 px-2">
            <NavLink
              data-focusable
              to="/profile"
              title="Profile"
              className={({ isActive }) =>
                `${iconBase} ${isActive ? iconActive : iconInactive}`
              }
            >
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt="avatar"
                  className="w-7 h-7 rounded-full object-cover"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-white/80 text-black flex items-center justify-center text-[10px] font-bold">
                  {user?.username?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
            </NavLink>

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
                  `${iconBase} ${isActive ? iconActive : iconInactive}`
                }
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
              </NavLink>
            ))}

            {/* Admin (admin users only) */}
            {user?.role === 'admin' && (
              <>
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
                <NavLink
                  data-focusable
                  to="/pruna"
                  title="Pruna"
                  className={({ isActive }) =>
                    `${iconBase} ${isActive ? iconActive : iconInactive}`
                  }
                >
                  <Boxes className="w-5 h-5 flex-shrink-0" />
                </NavLink>
              </>
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

          {/* Page content */}
          <main ref={mainRef} className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>

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
    </div>
  )
}
