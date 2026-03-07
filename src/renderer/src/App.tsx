import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { PlayerProvider } from '@/contexts/PlayerContext'
import { GamepadNavProvider } from '@/contexts/GamepadNavContext'
import { WatchlistProvider } from '@/contexts/WatchlistContext'
import { SettingsProvider } from '@/contexts/SettingsContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import RootShell from '@/components/RootShell'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import Movies from '@/pages/Movies'
import TV from '@/pages/TV'
import Watchlist from '@/pages/Watchlist'
import Profile from '@/pages/Profile'
import Admin from '@/pages/Admin'
import Pruna from '@/pages/Pruna'
import Settings from '@/pages/Settings'
export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <SettingsProvider>
          <PlayerProvider>
            <GamepadNavProvider>
            <WatchlistProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <RootShell />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="/home" replace />} />
                  <Route path="home" element={<Home />} />
                  <Route path="movies" element={<Movies />} />
                  <Route path="tv" element={<TV />} />
                  <Route path="watchlist" element={<Watchlist />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="admin" element={<Admin />} />
                  <Route path="pruna" element={<Pruna />} />
                  <Route path="settings" element={<Settings />} />
                </Route>
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </WatchlistProvider>
            </GamepadNavProvider>
          </PlayerProvider>
        </SettingsProvider>
      </AuthProvider>
    </HashRouter>
  )
}
