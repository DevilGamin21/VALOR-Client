# Architecture

## Process model

Electron 33, three roles:

- **Main** (`src/main/index.ts`) — window management, IPC handlers, electron-store, autoUpdater, Discord RPC, mpv subprocess management, CORS bypass.
- **Preload** (`src/preload/index.ts`) — exposes `window.electronAPI` to the renderer via `contextBridge`. Sole permitted surface for renderer→main communication.
- **Renderer** — React 18 + Vite 5 + Tailwind 3 + Framer Motion + HLS.js + lucide-react. Two BrowserWindows share the same renderer bundle, dispatched by route hash:
  - **Main window**: HashRouter at `/`, renders `RootShell` with sidebar + page outlet.
  - **Overlay window**: HashRouter at `/player-overlay`, renders only `PlayerOverlay` — sits on top of the mpv-embedded `playerWindow`.

Both windows mount the entire provider tree (Auth/Settings/Player/GamepadNav/Connect/Watchlist) — keep this in mind when changing providers; the overlay creates its own state and its own WebSocket connection.

## Build system

- `electron-vite` orchestrates three Vite builds (main, preload, renderer).
- `electron.vite.config.ts` injects `__APP_VERSION__` from `package.json`, sets the `@/*` alias to `src/renderer/src/*`, registers `@vitejs/plugin-react`, and uses `externalizeDepsPlugin()` for main/preload (so node modules aren't bundled).
- `npm run dev` runs all three with HMR for renderer and rebuild-on-change for main/preload.
- `npm run build` produces `out/main/index.js`, `out/preload/index.js`, `out/renderer/...`.
- `npm run package:win` adds an NSIS installer step via electron-builder.

Full build/release pipeline: see [build-and-release.md](build-and-release.md).

## Renderer: providers and routing

```
HashRouter
└─ AuthProvider                  electron-store JWT, multi-account
   └─ SettingsProvider           localStorage 'valor-settings'
      └─ PlayerProvider          openPlayer/closePlayer, mpv lifecycle, Connect bridge
         └─ GamepadNavProvider   zone-based focus (sidebar/content/modal/player)
            └─ ConnectProvider   WebSocket /ws/connect, device list, command relay
               └─ WatchlistProvider
                  Routes
                  ├─ /login                 — Login (no shell)
                  ├─ /player-overlay        — PlayerOverlay (overlay window)
                  └─ /                      — AppShell (RootShell + Outlet)
                     ├─ /home, /movies, /tv, /watchlist, /discover, /connect
                     ├─ /profile, /admin, /settings
```

`AppShell` was once a TV/desktop switch (`uiMode === 'tv' ? TvRootShell : RootShell`) but TV mode was reverted; it now always returns `RootShell`. The TV product flavor lives in the separate VALOR-Android repo.

## Main-process responsibilities

| Concern | Location | Notes |
|---------|----------|-------|
| Main window | `createWindow()` | Frameless (`frame: false`), 1280×800 default, `webSecurity: true`, contextIsolation |
| CORS bypass | `session.defaultSession.webRequest.{onBeforeSendHeaders,onHeadersReceived}` | Injects Origin and rewrites response CORS headers so `apiv.dawn-star.co.uk` is fetchable |
| Auto-update | `setupAutoUpdater()` (production only) | electron-updater with GitHub provider, `autoDownload=true`, `autoInstallOnAppQuit=true`, `allowElevation=false` |
| Discord RPC | `initDiscordRPC()` | Lazy-required module, retries every 30s on disconnect |
| mpv subprocess | `MpvPlayer` in `src/main/mpvPlayer.ts` | Spawned per-launch, JSON-RPC over named pipe `\\.\pipe\valor-mpv-ipc` |
| Player + overlay windows | `createPlayerWindow()` | Two BrowserWindows; overlay is `parent: playerWindow` so they move together |
| Multi-account auth | electron-store schema `{ accounts, activeAccountId }` | `auth:*` IPC handlers manage the list |

## Renderer entry points by feature

| Feature | Files |
|---------|-------|
| Login | `pages/Login.tsx`, `contexts/AuthContext.tsx` |
| Home / Discover | `pages/Home.tsx`, `pages/Discover.tsx`, `components/MediaRow.tsx`, `components/MovieCard.tsx` |
| PlayModal (start playback) | `components/PlayModal.tsx` |
| Built-in player | `components/VideoPlayer.tsx` (HLS.js + native `<video>`) |
| mpv overlay | `pages/PlayerOverlay.tsx` (separate window) |
| Player state bridge | `contexts/PlayerContext.tsx` (decides built-in vs mpv, openPlayer/closePlayer) |
| Settings | `pages/Settings.tsx`, `contexts/SettingsContext.tsx` |
| Connect | `pages/Connect.tsx`, `contexts/ConnectContext.tsx`, `components/ConnectBar.tsx` |
| Gamepad | `contexts/GamepadNavContext.tsx`, `hooks/useGamepad.ts` |
| Update banner | `components/UpdateBanner.tsx`, `components/RootShell.tsx` |
