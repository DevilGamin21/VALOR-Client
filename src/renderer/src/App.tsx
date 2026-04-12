import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { PlayerProvider } from '@/contexts/PlayerContext'
import { GamepadNavProvider } from '@/contexts/GamepadNavContext'
import { WatchlistProvider } from '@/contexts/WatchlistContext'
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext'
import { ConnectProvider } from '@/contexts/ConnectContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import RootShell from '@/components/RootShell'
import TvRootShell from '@/components/tv/TvRootShell'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import Movies from '@/pages/Movies'
import TV from '@/pages/TV'
import Watchlist from '@/pages/Watchlist'
import Profile from '@/pages/Profile'
import Admin from '@/pages/Admin'
import Settings from '@/pages/Settings'
import Discover from '@/pages/Discover'
import Connect from '@/pages/Connect'
import PlayerOverlay from '@/pages/PlayerOverlay'

/** Switches between desktop and TV root shell based on uiMode setting */
function AppShell() {
  const { uiMode } = useSettings()
  const Shell = uiMode === 'tv' ? TvRootShell : RootShell
  return (
    <ProtectedRoute>
      <Shell />
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <SettingsProvider>
          <PlayerProvider>
            <GamepadNavProvider>
            <ConnectProvider>
            <WatchlistProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                {/* mpv overlay — rendered in a separate transparent BrowserWindow */}
                <Route path="/player-overlay" element={<PlayerOverlay />} />
                <Route path="/" element={<AppShell />}>
                  <Route index element={<Navigate to="/home" replace />} />
                  <Route path="home" element={<Home />} />
                  <Route path="movies" element={<Movies />} />
                  <Route path="tv" element={<TV />} />
                  <Route path="watchlist" element={<Watchlist />} />
                  <Route path="discover" element={<Discover />} />
                  <Route path="connect" element={<Connect />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="admin" element={<Admin />} />
                  <Route path="settings" element={<Settings />} />
                </Route>
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </WatchlistProvider>
            </ConnectProvider>
            </GamepadNavProvider>
          </PlayerProvider>
        </SettingsProvider>
      </AuthProvider>
    </HashRouter>
  )
}
