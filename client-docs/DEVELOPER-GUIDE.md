# VALOR Desktop Client – Developer Guide

This guide helps you navigate the codebase and perform common tasks without reading every file.

---

## File map

### Electron layer

| File | What it does |
|------|-------------|
| `src/main/index.ts` | App entry point. Creates `BrowserWindow`, injects Origin header for CORS bypass, registers all `ipcMain` handlers, sets up `autoUpdater` events, handles app lifecycle. |
| `src/preload/index.ts` | Exposes `window.electronAPI` to the renderer via `contextBridge`. If you add a new IPC channel, add it here AND in `electron.d.ts`. |

### Types

| File | What it does |
|------|-------------|
| `src/renderer/src/types/media.ts` | All data shapes: `UnifiedMedia`, `PlayJob`, `AudioTrack`, `SubtitleTrack`, `Season`, `Episode`, `User`, `ProgressItem`, `TrendingResponse`, `P2PStatus`. |
| `src/renderer/src/types/electron.d.ts` | TypeScript declaration for `window.electronAPI`. Keep in sync with `src/preload/index.ts`. |

### API service

| File | What it does |
|------|-------------|
| `src/renderer/src/services/api.ts` | Single file for every HTTP call. Reads the JWT token via IPC, adds `Authorization: Bearer` header, handles 401 (clears token, redirects to login). All functions are `async` and return typed promises. |

### Contexts (global state)

| File | What it holds |
|------|--------------|
| `AuthContext.tsx` | `user`, `token`, `loading`, `login()`, `logout()`. Restores session from electron-store on mount. |
| `PlayerContext.tsx` | `job` (current `PlayJob`), `startPositionTicks`, `isOpen`, `openPlayer()`, `closePlayer()`, `updateJob()`. |
| `WatchlistContext.tsx` | `ids` (Set), `items`, `toggle()`, `refresh()`. Syncs with backend on mount and after every toggle. |

### Components

| File | What it does |
|------|-------------|
| `TitleBar.tsx` | Custom window chrome. Uses `app-drag` / `app-no-drag` CSS classes for drag regions. |
| `ProtectedRoute.tsx` | Wraps protected pages. Shows a spinner while `AuthContext.loading` is true, then redirects to `/login` if no user. |
| `RootShell.tsx` | Shell layout. Rendered by the `/` route as a nested `<Outlet>`. |
| `UpdateBanner.tsx` | Listens to `window.electronAPI.updates` events on mount. Slides in/out based on update state. |
| `MediaRow.tsx` | Horizontal scroll row. Accepts `title`, `items: UnifiedMedia[]`, `onPlay: (item) => void`. |
| `MovieCard.tsx` | Single card. Reads `WatchlistContext` for the ✓/+ icon. Calls `onPlay(item)` when clicked. |
| `PlayModal.tsx` | Full media detail popup. Fetches resume progress, seasons/episodes, digital release status, P2P polling. |
| `VideoPlayer.tsx` | HLS.js player. Manages its own `Hls` instance ref, heartbeat interval, hide timer. |

### Pages

| Route | File | Content |
|-------|------|---------|
| `/login` | `Login.tsx` | Standalone — no RootShell |
| `/home` | `Home.tsx` | Hero + Continue Watching + Trending rows |
| `/movies` | `Movies.tsx` | Trending or search results (`?q=`) — movies only |
| `/tv` | `TV.tsx` | Same as Movies for TV |
| `/watchlist` | `Watchlist.tsx` | Grid of watchlisted items |
| `/profile` | `Profile.tsx` | Email + avatar |
| `/admin` | `Admin.tsx` | User CRUD + diagnostics |

---

## Conventions

### API calls

All API calls live in `services/api.ts`. Never call `fetch()` directly from a component. If you need a new endpoint:
1. Add a typed function to `api.ts`.
2. The `request<T>()` helper handles auth header, Content-Type, and 401 redirect automatically.
3. Don't handle 401 in the component — `request()` already redirects to `/login`.

### IPC (main ↔ renderer)

To add a new IPC channel:
1. Register the handler in `src/main/index.ts`:
   ```typescript
   ipcMain.handle('my:channel', (_e, arg) => { /* Node.js logic */ })
   ```
2. Expose it in `src/preload/index.ts` inside `contextBridge.exposeInMainWorld`:
   ```typescript
   myFeature: {
     doThing: (arg: string): Promise<void> => ipcRenderer.invoke('my:channel', arg)
   }
   ```
3. Add the type to `src/renderer/src/types/electron.d.ts`.
4. Call it from React: `window.electronAPI.myFeature.doThing('hello')`.

For one-way events from main → renderer (like update notifications), use `webContents.send()` in main and `ipcRenderer.on()` in preload.

### Adding a new page

1. Create `src/renderer/src/pages/MyPage.tsx`.
2. Import and add a `<Route>` inside the `<Route path="/" element={<RootShell />}>` block in `App.tsx`.
3. Add a nav link in `RootShell.tsx` (either in the `NAV` array or the bottom section).
4. If the page is admin-only, add a redirect guard like `Admin.tsx` does.

### Routing

The router is a `HashRouter`. Navigation is `useNavigate()` and `<NavLink>`. Routes use hash segments (`#/home`, `#/movies`, etc.).

### State in components vs contexts

- **Global state** (auth, player, watchlist) → context.
- **Page-local state** (loading, selected item, error) → `useState` in the page component.
- **Don't** put API fetch results into contexts unless they genuinely need to be shared across pages.

### Styling

Tailwind CSS 3. The custom theme extends Tailwind's colours with:
- `eerie` → `#0a0a0a`
- `dark-bg` → `#141414`
- `dark-card` → `#1a1a1a`
- `dark-border` → `#2a2a2a`

Utility classes for Electron specifics (defined in `index.css`):
- `app-drag` — makes a region draggable (title bar)
- `app-no-drag` — removes drag from a child of a draggable region
- `glass` — frosted glass effect (backdrop-filter blur)

---

## Common tasks

### Play a Jellyfin item from any component

```typescript
import { usePlayer } from '@/contexts/PlayerContext'
import * as api from '@/services/api'

const { openPlayer } = usePlayer()

async function play(jellyfinItemId: string, startTicks = 0) {
  const job = await api.startPlayJob({ itemId: jellyfinItemId })
  openPlayer(job, startTicks)
}
```

### Toggle watchlist from any component

```typescript
import { useWatchlist } from '@/contexts/WatchlistContext'
import type { UnifiedMedia } from '@/types/media'

const { ids, toggle } = useWatchlist()
const inWatchlist = ids.has(item.id)
// toggle(item) adds if not present, removes if present
```

### Add a new backend API call

```typescript
// In src/renderer/src/services/api.ts
export async function getMyThing(id: string): Promise<MyType> {
  return request(`/my-endpoint/${id}`)
}

// POST with body:
export async function createMyThing(body: { name: string }): Promise<MyType> {
  return request('/my-endpoint', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}
```

### Expose a new desktop-only feature

Example: adding a system notification when P2P stream is ready.

1. **Main process** (`src/main/index.ts`):
   ```typescript
   ipcMain.handle('notify:show', (_e, title: string, body: string) => {
     new Notification({ title, body }).show()
   })
   ```
2. **Preload** (`src/preload/index.ts`):
   ```typescript
   notify: {
     show: (title: string, body: string): Promise<void> =>
       ipcRenderer.invoke('notify:show', title, body)
   }
   ```
3. **Type** (`types/electron.d.ts`):
   ```typescript
   notify: {
     show: (title: string, body: string) => Promise<void>
   }
   ```
4. **Use in React:**
   ```typescript
   window.electronAPI.notify.show('VALOR', 'P2P stream is ready to play')
   ```

### Rebuild the installer after a code change

```bash
npm run build:win           # bumps patch, rebuilds
# Output: dist/VALOR-Setup-<new-version>.exe
```

To publish without a version bump (e.g. re-packaging the same code):
```bash
npm run build:win:nobump
```

### Change the installer welcome / finish text

Edit `build/installer.nsh`. The `!define` lines at the top set the NSIS MUI2 page text. Rebuild after saving.

### Change the installer sidebar image

Edit `scripts/generate-assets.mjs` — specifically the `sidebarColor(x, y, w, h)` function. It returns `[r, g, b]` for each pixel. The image is 164×314. Re-run the asset generator:
```bash
node scripts/generate-assets.mjs
```
Or replace `build/installerSidebar.bmp` with a hand-crafted 24-bit uncompressed BMP of exactly 164×314 px.

---

## Catching up (reading order)

1. `client-docs/ARCHITECTURE.md` — process model, IPC, CORS, auth.
2. `client-docs/SETUP.md` — get it running.
3. `src/main/index.ts` + `src/preload/index.ts` — understand the Electron layer.
4. `src/renderer/src/services/api.ts` — all API calls in one place.
5. `src/renderer/src/App.tsx` — route tree.
6. `src/renderer/src/contexts/AuthContext.tsx` — auth flow.
7. `src/renderer/src/components/RootShell.tsx` — shell layout.
8. `src/renderer/src/components/VideoPlayer.tsx` — HLS.js player (most complex component).
9. `client-docs/FEATURES.md` — what exists and what's planned.
