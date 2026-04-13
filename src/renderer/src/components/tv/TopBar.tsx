import { NavLink, useNavigate } from 'react-router-dom'
import { Search, Compass, Settings, User as UserIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const TABS = [
  { to: '/home', label: 'Home' },
  { to: '/movies', label: 'Movies' },
  { to: '/tv', label: 'Shows' },
  { to: '/watchlist', label: 'Watchlist' },
]

interface TopBarProps { onSearch?: () => void }

export default function TopBar({ onSearch }: TopBarProps) {
  const { user } = useAuth()
  const navigate = useNavigate()

  return (
    <nav className="flex-shrink-0 flex items-center gap-4 px-6 py-3 bg-[#0a0a0a]/90 backdrop-blur-sm z-50">
      <span className="text-2xl font-bold text-red-600 tracking-[6px] mr-2 select-none">VALOR</span>
      <button data-focusable onClick={() => navigate('/discover')} className="tv-icon-btn" title="Discover">
        <Compass size={20} className="text-red-500" />
      </button>
      <div className="flex items-center gap-1 ml-2">
        {TABS.map(({ to, label }) => (
          <NavLink key={to} to={to} data-focusable
            className={({ isActive }) => `tv-tab ${isActive ? 'tv-tab-active' : 'tv-tab-inactive'}`}>
            {label}
          </NavLink>
        ))}
      </div>
      <div className="flex-1" />
      <button data-focusable onClick={() => onSearch ? onSearch() : navigate('/home?q=')} className="tv-icon-btn" title="Search">
        <Search size={20} className="text-red-500" />
      </button>
      <button data-focusable onClick={() => navigate('/settings')} className="tv-icon-btn" title="Settings">
        <Settings size={20} className="text-white/60" />
      </button>
      <button data-focusable onClick={() => navigate('/profile')} className="tv-icon-btn overflow-hidden" title="Profile">
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-white/80 text-black flex items-center justify-center text-sm font-bold">
            {user?.username?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </button>
    </nav>
  )
}
