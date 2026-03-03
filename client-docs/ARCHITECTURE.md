# VALOR Desktop Client – Architecture

## Overview

The desktop client is an **Electron** application. Electron runs two separate JavaScript environments — the **main process** (Node.js, full OS access) and the **renderer process** (Chromium, sandboxed web page). A **preload script** bridges them using Electron's contextBridge IPC.

```
┌─────────────────────────────────────────────────────────────────┐
│  Electron process                                               │
│                                                                 │
│  ┌──────────────┐   IPC (contextBridge)   ┌──────────────────┐ │
│  │ Main Process │ ◄──────────────────────► │ Renderer Process │ │
│  │  (Node.js)   │                         │  (React + Vite)  │ │
│  │              │   win:minimize/maximize  │                  │ │
│  │ electron-    │   auth:getToken/setToken │ pages, components│ │
│  │  store JWT   │   update:download/...   │ HLS.js video     │ │
│  │ autoUpdater  │                         │ Tailwind CSS     │ │
│  └──────────────┘                         └──────────────────┘ │
│         │                                          │            │
│         └────────────── CORS bypass ───────────────┘            │
│                    (inject Origin header)                       │
└─────────────────────────────────────────────────────────────────┘
         │                                          │
         │ electron-updater                         │ fetch()
         ▼                                          ▼
  https://valor.dawn-star.co.uk/updates/    https://apiv.dawn-star.co.uk
  (update server — static files)            (VALOR API backend)
```

---

## Tech stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Electron | 33 |
| Build system | electron-vite | 2 |
| UI framework | React | 18 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 3 |
| Animations | Framer Motion | 11 |
| Icons | lucide-react | latest |
| Video | HLS.js | 1.5 |
| Routing | react-router-dom | 6 (HashRouter) |
| Persistent store | electron-store | 8 |
| Auto-update | electron-updater | 6 |
| Installer | electron-builder + NSIS | 25 |

---

## Source layout

```
src/
├── main/
│   └── index.ts          Main process — window, CORS intercept, IPC handlers, autoUpdater
├── preload/
│   └── index.ts          IPC bridge — exposes electronAPI to renderer via contextBridge
└── renderer/
    ├── index.html
    └── src/
        ├── main.tsx              React entry point
        ├── App.tsx               HashRouter + route tree
        ├── index.css             Tailwind directives + global CSS animations
        ├── types/
        │   ├── media.ts          All shared data types (UnifiedMedia, PlayJob, etc.)
        │   └── electron.d.ts     window.electronAPI TypeScript declaration
        ├── services/
        │   └── api.ts            Every API call to apiv.dawn-star.co.uk
        ├── contexts/
        │   ├── AuthContext.tsx   User + JWT state, login/logout
        │   ├── PlayerContext.tsx Current PlayJob state, open/close player
        │   └── WatchlistContext.tsx Per-user watchlist synced with backend
        ├── components/
        │   ├── TitleBar.tsx      Custom frameless window chrome (minimize/maximize/close)
        │   ├── RootShell.tsx     Shell layout — header, sidebar, page outlet
        │   ├── ProtectedRoute.tsx Auth guard — redirects to /login if no session
        │   ├── UpdateBanner.tsx  In-app update notification (available → downloading → ready)
        │   ├── MediaRow.tsx      Horizontal scrolling row of MovieCards
        │   ├── MovieCard.tsx     Single poster card with hover, watchlist toggle, progress bar
        │   ├── PlayModal.tsx     Media details popup — play, resume, P2P, request, TV episodes
        │   └── VideoPlayer.tsx   Full-screen HLS.js player with all controls
        └── pages/
            ├── Login.tsx         Animated login form (glassmorphism, blob orbs, 4-stage animation)
            ├── Home.tsx          Continue Watching + Trending rows + hero banner
            ├── Movies.tsx        Trending movies or search results
            ├── TV.tsx            Trending TV or search results
            ├── Watchlist.tsx     User's saved titles
            ├── Profile.tsx       Email + avatar management
            └── Admin.tsx         User CRUD + system diagnostics (admin only)
```

---

## Process model

### Main process (`src/main/index.ts`)

Runs in Node.js. Has full OS access. Responsibilities:

- **Window management:** Creates the frameless `BrowserWindow`, handles minimize/maximize/close IPC.
- **CORS bypass:** Uses `session.webRequest.onBeforeSendHeaders` to inject `Origin: https://valor.dawn-star.co.uk` on every request to `apiv.dawn-star.co.uk`. This makes the backend's CORS check pass without any server-side changes.
- **JWT storage:** Uses `electron-store` to persist the auth token between sessions. Exposed to the renderer via IPC — the renderer never has direct filesystem access.
- **Auto-updater:** Sets up `electron-updater` events, forwards them to the renderer via `webContents.send()`.

### Preload script (`src/preload/index.ts`)

Runs in a special context with access to both Node.js APIs and the renderer's `window` object. Uses `contextBridge.exposeInMainWorld` to expose a safe, typed `window.electronAPI` object to the React app. **No Node.js APIs are exposed directly** — only the specific IPC calls needed.

```typescript
window.electronAPI = {
  auth:    { getToken, setToken, clearToken },
  window:  { minimize, maximize, close, isMaximized, onMaximizedChange },
  updates: { download, install, check, onAvailable, onProgress, onDownloaded, onError }
}
```

### Renderer (`src/renderer/src/`)

A standard React SPA. Has no Node.js access — communicates with the main process only through `window.electronAPI`. Makes HTTP calls directly to `apiv.dawn-star.co.uk` using `fetch()`.

---

## Auth flow

1. **Login:** User submits credentials → `api.login()` calls `POST /login` on the VALOR backend → receives `{ token, user }`.
2. **Store:** Token is saved to `electron-store` via `window.electronAPI.auth.setToken(token)` (IPC → main process → filesystem).
3. **Restore:** On every app launch, `AuthContext` calls `auth.getToken()` and then `GET /me` to validate it is still live. If the token is missing or expired, the user is sent to `/login`.
4. **API calls:** Every `fetch()` in `api.ts` reads the token via `auth.getToken()` and adds `Authorization: Bearer <token>` to the request headers.
5. **Logout:** Token deleted from electron-store, React state cleared, router redirects to `/login`.

Compare to the web app: the web app uses an HTTP-only cookie (`valor_session`) set by a Next.js server action. The desktop client uses a Bearer token in headers — the backend supports both paths (it reads from `Authorization: Bearer ...` OR `Cookie: valor_session=...`).

---

## CORS bypass — why and how

Electron's `BrowserWindow` renderer makes HTTP requests with **no `Origin` header** (or `null`). The VALOR backend's CORS middleware only allows `https://valor.dawn-star.co.uk`. Without intervention, every API request would return `403 Forbidden`.

**Solution:** In the main process, `session.defaultSession.webRequest.onBeforeSendHeaders` intercepts all outgoing requests to `https://apiv.dawn-star.co.uk/*` and injects:

```
Origin: https://valor.dawn-star.co.uk
Referer: https://valor.dawn-star.co.uk/
```

The backend never knows the request originated from an Electron app. **No backend changes required.**

---

## Video playback

The desktop client uses the same HLS.js player as the web app, running inside Electron's bundled Chromium. Key behaviour:

- `POST /jellyfin/play-job` returns an HLS URL with `api_key` embedded as a query parameter.
- HLS.js loads the stream with `withCredentials: false` — auth is in the URL, not headers.
- Jellyfin's `Access-Control-Allow-Origin: *` is compatible with this because `withCredentials` is false.
- All the codec constraints from the web app apply identically: H.264 only, `DirectPlayProfiles: []`, `BreakOnNonKeyFrames: false`, subtitle burn-in stripping.

**Why this matters for desktop:** Electron uses a bundled Chromium — it behaves exactly like Chrome. All the MSE codec quirks and HLS.js workarounds that were tuned for the web app work out of the box. Using a native player (mpv/VLC) could unlock HEVC/AV1/DTS but is a future enhancement, not the current architecture.

---

## Routing

`HashRouter` is used instead of `BrowserRouter`. In production the renderer is loaded from a `file://` URL, and `BrowserRouter`'s history API requires a real HTTP server. Hash-based routing (`#/home`, `#/movies`, etc.) works in both dev (served from `localhost:5173`) and production (`file://`).

---

## Auto-update flow

```
App launch
    │  (5s delay)
    ▼
autoUpdater.checkForUpdates()
    │
    ├── No update → silent, nothing happens
    │
    └── Update available (version X)
            │
            │  main sends  update:available  to renderer
            ▼
        UpdateBanner slides in → "Download Update" button
            │
            │  user clicks → update:download IPC
            ▼
        Download progress (update:progress events → progress bar)
            │
            ▼
        Download complete (update:downloaded)
            │
            │  main sends  update:downloaded  to renderer
            ▼
        UpdateBanner shows "Restart to Install" (pulsing green)
            │
            │  user clicks → update:install IPC
            ▼
        autoUpdater.quitAndInstall(false, true)
        App closes → NSIS silent installer runs → app reopens at new version
```

`autoInstallOnAppQuit = true` means even if the user ignores the banner and just closes the app, the update installs automatically on the next launch.

---

## Window chrome

The app uses `frame: false` (no OS title bar) with a custom `TitleBar` component. The title bar div has `-webkit-app-region: drag` so it acts as the drag handle. The three window control buttons have `-webkit-app-region: no-drag` so clicks register. Window state (maximized/restored) is tracked via IPC events from the main process.
