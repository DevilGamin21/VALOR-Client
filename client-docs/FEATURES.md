# VALOR Desktop Client – Implemented Features

---

## Auth & session

- **Login page** (`/login`): Premium dark glassmorphism design — gradient-border card, three animated blob orbs (red/indigo), floating CSS particle field, scan-line shimmer.
- **4-stage animated auth flow:**
  - Stage 1 — Submitting: Card scales down (0.97×) with Gaussian blur.
  - Stage 2 — Dot: Card shrinks to zero; a glowing red dot appears with spinning + pulsing rings.
  - Stage 3 — Success: Dot expands to full viewport (expo-out easing), black overlay fades in, router navigates to `/home`.
  - Stage 4 — Failure: Dot shakes horizontally, card restores, error banner appears.
- **JWT persistence:** Token stored in `electron-store` (encrypted, OS keychain-backed) via IPC. Session is restored automatically on app launch without re-login.
- **Protected routes:** `ProtectedRoute` component wraps all pages; unauthenticated users are redirected to `/login`. On launch, the app validates the stored token with `GET /me` before allowing access.
- **Auth header:** `Authorization: Bearer <token>` on all API requests (not cookies — desktop clients don't use HTTP-only cookies).

---

## Window chrome

- **Frameless window:** No OS title bar. Custom `TitleBar` component provides minimize, maximize/restore, and close buttons styled to match the app theme.
- **Title bar drag:** The title bar area has `-webkit-app-region: drag` so the window can be dragged by the top strip.
- **Maximize state sync:** The maximize button icon updates correctly when the window is maximised/restored via the taskbar or keyboard shortcuts.
- **Dark background:** `#0a0a0a` background colour on the `BrowserWindow` prevents white flash on launch.

---

## Layout & shell

- **RootShell** (`components/RootShell.tsx`): Title bar → header (logo, search bar, avatar) → collapsible left sidebar → main content area.
- **Sidebar:** Glass-style, `w-52`. Nav links (Home, Movies, TV, Watchlist) with active state glow. Profile, Admin (admin only), Update banner, Sign out at the bottom.
- **Sidebar toggle:** Menu/X button in the header collapses/expands the sidebar.
- **Search:** Header search calls `/search?q=...` (TMDB-first unified search), navigates to `/movies?q=...` and `/tv?q=...` depending on result types.

---

## Home

- **Hero banner:** Large backdrop image for the featured trending item with title, overview, and "View Details" button.
- **Continue Watching row:** Shows partially-watched Jellyfin items from `GET /user-progress`. Each card displays a thin white progress bar at the top of the poster (5–90% watched).
- **Trending Movies row:** TMDB trending, cross-referenced with Jellyfin library. Items in the library get an "On Demand" badge and `onDemand: true`.
- **Trending TV row:** Same as movies.

---

## Movies & TV pages

- **No query:** Shows TMDB trending content (movies or TV respectively) with Jellyfin library overlay.
- **With `?q=` query:** Shows Jellyfin library search results filtered to `type: 'movie'` or `type: 'tv'`.
- **MediaRow** (`components/MediaRow.tsx`): Horizontal scroll with left/right chevron buttons (hidden until row is hovered, sit above poster z-index).
- **MovieCard** (`components/MovieCard.tsx`): 144×208 poster, Framer Motion scale-up on hover, play overlay, watchlist toggle (+/✓), "On Demand" badge, progress bar.

---

## Watchlist

- **Per-user watchlist** synced with backend `GET/POST/DELETE /watchlist`.
- **`WatchlistContext`:** Keeps the set of watchlisted IDs in memory; toggle is optimistic (UI updates immediately, then syncs).
- **Empty state:** Icon + message when the watchlist is empty.
- **Grid layout:** Items displayed as a wrapped grid of MovieCards, same as movie rows.

---

## PlayModal

`components/PlayModal.tsx` — centralized popup for all media interactions:

- **Backdrop / poster / title / overview / year / type badge.**
- **Jellyfin items (movie):** Play button → `POST /jellyfin/play-job` → opens VideoPlayer.
- **Resume prompt:** If `GET /jellyfin/item-progress/:itemId` returns 5–90% progress, shows "Continue from XX:XX" and "Start from Beginning" buttons before playing.
- **Non-library movies:** P2P "Stream (P2P)" button (if digitally released) or disabled "Awaiting Release" (if not). Request button (Ombi).
- **Digital release gating:** `GET /tmdb/movie/:id/digital-release` checked before showing the P2P button. Fail-open.
- **P2P status panel:** Live progress bar, download speed, buffer %, channel ID during P2P buffering.
- **TV shows:** Season selector buttons → episode list (lazy-loaded per season). Episodes with `onDemand: true` get an "On Demand" badge and a Play button. Episodes not in the library get a purple "P2P" button.
- **Watchlist toggle** (+ icon) in the action row.
- **Error banner** for play-job failures.

---

## Video player

`components/VideoPlayer.tsx` — full-screen HLS.js player:

- **HLS.js** with `withCredentials: false` (auth embedded in URL via `api_key`).
- **Error recovery:** Fatal network errors → `hls.startLoad()` retry. Fatal media errors → `hls.recoverMediaError()` before showing the error UI.
- **Playback heartbeat:** `POST /jellyfin/progress` every 10 s with `positionTicks`, `durationTicks`, `isPaused`.
- **Stop reporting:** On close, immediately pauses the video then sends `{ isStopped: true }` to prevent ghost audio during the exit animation.
- **Resume position:** Seeks to `startPositionTicks` after the HLS manifest parses.
- **Custom subtitle renderer:** Fetches VTT text, parses cues, renders active cue as a positioned `<div>` overlay (more reliable than native `<track>`).
- **Image-based subtitles (PGS):** Triggers a stream restart via `POST /jellyfin/play-job` with `subtitleStreamIndex` for server-side burn-in.
- **Audio track switching:** Calls play-job with new `audioStreamIndex`, destroys old HLS instance, loads new URL.
- **Quality switching:** Four presets (Original, 1080p, 720p, 480p) mapped to `maxBitrate`. Triggers full stream restart.
- **Speed control:** 0.5× to 2× via `video.playbackRate`.
- **Controls auto-hide:** 3 s inactivity timer, reset on `mousemove`. Close (X) button always visible (ghost-dim at 10% opacity when hidden, 100% on hover).
- **Settings panel:** Tabbed (Audio / Subs / Quality / Speed), slides in above the controls bar.
- **Keyboard shortcuts:** `Space`/`k` play/pause, `←`/`→` ±10 s, `↑`/`↓` volume, `f` fullscreen, `Esc` close.
- **Framer Motion enter/exit animation** on the player container.

---

## Profile

- **Email update:** `PATCH /profile` with new email.
- **Avatar upload:** File picker → `POST /profile/avatar` (multipart) → updates displayed avatar.
- **Role badge:** Displays the user's role (user / admin).

---

## Admin

- **User list** from `GET /admin/users` with inline edit (email, role, password reset) and delete.
- **Create user** form (username, password, email, role).
- **System diagnostics** panel from `GET /admin/diagnostics` — Jellyfin ping, system info.
- **Admin guard:** Redirects non-admin users to `/home` on mount.

---

## Auto-update

- **Background check:** 5 s after launch, `autoUpdater.checkForUpdates()` runs silently.
- **UpdateBanner** (`components/UpdateBanner.tsx`): Appears at the bottom of the sidebar when:
  - An update is available — shows version and **Download Update** button.
  - Downloading — animated red progress bar + KB/s speed.
  - Ready to install — pulsing green **Restart to Install** button.
  - Error — message + **Retry** button.
- **Dismissable:** Users can close the banner with the × button (except during download).
- **Install on quit:** `autoInstallOnAppQuit = true` — update installs silently when the app is closed after a download, even if the user didn't click "Restart".

---

## Not yet implemented / planned

| Feature | Notes |
|---------|-------|
| **System tray + mini-player** | Show now-playing in tray; play/pause from tray menu |
| **Native media keys** | `globalShortcut` for play/pause, prev/next |
| **Discord Rich Presence** | Show "Watching [title]" in Discord status |
| **Native notifications** | "P2P ready", "Download complete", "New episodes" |
| **Local file playback** | Open a local video file via `dialog.showOpenDialog` |
| **Background P2P** | Keep downloading after window is closed (tray mode) |
| **mpv / native player** | Unlock HEVC, DTS, Dolby Atmos without server transcoding |
| **Auto-launch on startup** | `auto-launch` npm package |
| **Protocol handler** | `valor://play/movie/123` deep links |
| **Picture-in-Picture window** | Floating always-on-top mini-player |
| **App icon** | `build/icon.ico` / `build/icon.png` need to be supplied |
| **Code signing** | EV certificate for SmartScreen bypass |
