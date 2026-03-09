# VALOR — Feature Comparison & Roadmap

## Platform Comparison

| Feature | Desktop Client | Website |
|---------|:-:|:-:|
| **Browsing & Discovery** | | |
| Home (Trending, Continue Watching, Categories) | Yes | Yes |
| Movies / TV pages with search | Yes | Yes |
| Dynamic hero carousel | Yes | Yes |
| Anime toggle filter | Yes | Yes |
| On Demand toggle filter | Yes | Yes |
| Watchlist (server-synced) | Yes | Yes |
| **Playback** | | |
| HLS.js video player | Yes | Yes |
| mpv external player (HEVC, AV1, native hw decode) | Yes | No |
| Direct Play (no transcode, GPU decode) | Yes | No |
| Quality presets (4K/1440p/1080p/720p/480p) | Yes | Yes |
| Quality switching mid-playback | Yes | Yes |
| Audio track switching (language, codec info) | Yes | Yes |
| Subtitle selector (embedded Jellyfin subs) | Yes | Yes |
| OpenSubtitles search & download | Yes | Yes |
| Subtitle styling (size, opacity) | Yes | Yes |
| Playback speed (0.5x - 2x) | Yes | Yes |
| Resume / Continue Watching | Yes | Yes |
| Progress tracking (10s heartbeat) | Yes | Yes |
| Watched indicators & badges | Yes | Yes |
| **TV Episodes** | | |
| Season selector | Yes | Yes |
| Episode list with progress bars | Yes | Yes |
| Episode switching during playback | Yes | Yes |
| Up Next auto-play (2 min before end) | Yes | Yes |
| **P2P Streaming** | | |
| WebTorrent P2P stream | Yes | Yes |
| Digital release gating | Yes | Yes |
| Buffer progress display | Yes | Yes |
| **Content Requests** | | |
| Request via Ombi | Yes | Yes |
| **Admin** | | |
| User management (CRUD, tiers, Jellyfin sync) | Yes | Yes |
| System diagnostics | Yes | Yes |
| Library scan trigger | Yes | Yes |
| Symlink health check | No | Yes |
| Jellyfin restart trigger | No | Yes |
| **Pruna Pipeline** | | |
| Dashboard (active/completed/failed) | Yes | Yes |
| Queue config (max concurrent) | Yes | Yes |
| Library management (delete, refetch) | Yes | Yes |
| Episode-level management | Yes | Yes |
| Ongoing show auto-follow | Yes | Yes |
| Batch torrent search & magnet install | Yes | Yes |
| **User Account** | | |
| Login (JWT) | Yes | Yes |
| Profile editing & avatar upload | Yes | Yes |
| User tier display (Free/Trial/Sub/Lifetime) | Yes | Yes |

---

## Desktop Client — Exclusive Features

### Gamepad / Controller Navigation
- Zone-based spatial navigation (sidebar / content / modal zones)
- DPad + left stick for directional movement
- A button = activate, B button = back / close modal
- Red heartbeat glow focus ring (box-shadow follows border-radius)
- Gamepad hover mirrors mouse hover (poster scale-up, play overlay, watchlist button, episode number highlight)
- Auto-repeat on hold: 400ms delay, 150ms interval
- Focus memory across modal open/close (pre-modal position restored)
- Disabled when VideoPlayer is open (player has its own gamepad controls)
- React re-render fix: `requestAnimationFrame` re-applies `gp-focused` after `click()`

### mpv Player Engine
- Optional external player using mpv (bundled with the app in `resources/mpv/`)
- Setting in Settings > Playback > Player Engine (only visible when mpv.exe detected)
- Benefits: native HEVC/AV1 decoding, GPU hardware acceleration, lower CPU usage
- mpv opens in its own borderless maximized window with native OSD controls
- All VALOR features work via IPC: heartbeat, progress tracking, episode auto-advance, Discord RPC, sleep timer
- Episode switching sends `loadfile` command to mpv — no restart needed
- Track switching (audio/subtitles) handled natively by mpv via `aid`/`sid` properties
- Falls back to built-in player if mpv not available

### Direct Play Mode
- Hardware GPU detection on first launch (MediaCapabilities API for H.264 1080p/30fps/10Mbps)
- Plays original file directly via `<video src=url>` — no FFmpeg, no transcoding
- Lower latency, original quality, less server load
- User can manually override auto-detection in Settings
- Fallback to canPlayType() if MediaCapabilities unavailable

### Sleep Timer
- Options: Off, 5/10/15/30/60/90 minutes, End of Episode
- Triggers system sleep on expiry:
  - Windows: PowerShell `SetSuspendState`
  - Linux: `systemctl suspend`
  - macOS: `pmset sleepnow`
- Countdown display in settings panel
- Sleep timer overrides Up Next auto-advance

### Auto-Updater
- electron-updater with GitHub Releases as provider
- Background download starts 5s after launch
- Update banner: version, download progress (% + KB/s), ready state
- Restart-to-update prompt with green button
- Delta updates via blockmap (smaller downloads for minor updates)
- No UAC prompts: `allowElevation: false`, `requestedExecutionLevel: asInvoker`

### Discord Rich Presence
- Shows "Browsing for content" while navigating
- Shows "Playing [title]" with poster image during playback
- Toggle in Settings > Integrations
- Auto-reconnects every 30s on disconnect
- Graceful fallback if Discord not running

### Frameless Window & Platform Features
- Custom title bar (minimize/maximize/close)
- Draggable title region (`-webkit-app-region: drag`)
- JWT stored in electron-store (encrypted, persists across sessions)
- DevTools toggle: Ctrl+Shift+I in any build

---

## Website — Exclusive Features

### Admin: Symlink Health Check
- Validate NTFS symlinks, path resolution, file counts
- Repair suggestions for broken links
- Admin-only access

### Admin: Jellyfin Restart
- Trigger Jellyfin server restart from the web UI

### Platform Downloads Page
- `/downloads` with platform auto-detection (Windows/Linux/macOS/Android/iOS)
- Windows .exe download link
- Coming Soon placeholders for other platforms

### Mobile / Responsive
- Mobile bottom navigation bar
- Retractable sidebar on small screens
- Touch-friendly button sizing
- Responsive poster/card sizing

---

## Backend (Server) — Shared Services

Both platforms connect to the same backend API (`https://apiv.dawn-star.co.uk`).

### Core Services
| Service | What it does |
|---------|-------------|
| **Jellyfin** | Media library, metadata, HLS transcoding, play-job generation |
| **TMDB** | Trending content (5-min cache), metadata, release dates, episode data |
| **Ombi** | User media requests; auto-queues approved requests to Pruna (5-min poll) |
| **OpenSubtitles** | External subtitle search & SRT-to-VTT conversion |
| **Prowlarr** | Torrent search (primary source for P2P and Pruna) |
| **Torrentio** | Torrent search (secondary, rate-limited) |
| **Real-Debrid** | Instant download links, cache verification, progress tracking |
| **Plex** | Legacy library integration (optional) |
| **Radarr/Sonarr** | File path resolution |

### Pruna Pipeline
State machine: `requested → scraping → downloading → waiting_zurg → symlinking → completed`

- Quality scoring: 2160p (100) → 1080p (70) → 720p (40) → 480p (10)
- Source scoring: remux (25) → blu-ray (20) → web-dl (15) → webrip (12) → hdtv (5)
- Real-Debrid for instant downloads
- NTFS symlinks from Zurg (`Y:/__all__/`) to Jellyfin libraries (`C:/ZurgMetadata/`)
- Max concurrent configurable (default 5, range 1–20)
- Ongoing show auto-follow: 30-min TMDB polling for new episodes

### P2P Streaming
- 10 concurrent WebTorrent channels via `.strm` virtual files
- 5 MB buffer threshold before marking ready
- HTTP Range-request delivery for Jellyfin compatibility
- Prowlarr auto-search for magnet links

---

## What's Next

### Testing / Verification Needed
1. **Gamepad focus ring rounding** — Verify box-shadow ring follows border-radius correctly on all element types (rounded-full pills, rounded-lg posters, rounded-xl sidebar icons, episode cards)
2. **Gamepad hover effects** — Confirm poster scale + play overlay + watchlist button show on DPad focus
3. **UAC-free updates** — Verify no admin prompts for users who installed to default `%LocalAppData%\Programs\VALOR`
4. **Episode card highlight** — Verify `.ep-num-box` dark-red background activates on gamepad hover
5. **Toggle focus preservation** — Test that On Demand / Anime toggle click via controller doesn't reset DPad position

### Planned / Upcoming
| Feature | Platform | Notes |
|---------|----------|-------|
| Mobile apps (Android/iOS) | Mobile | Currently "Coming Soon" on downloads page |
| Linux auto-updates | Desktop | AppImage update feed not configured |
| Code signing (EV cert) | Desktop | Eliminates SmartScreen warning (~£300-500/yr) |
| Native media keys | Desktop | `globalShortcut` for play/pause/prev/next |
| System tray + mini-player | Desktop | Now-playing in tray, play/pause from tray menu |
| Picture-in-Picture | Desktop | Floating always-on-top mini-player window |
| Protocol handler | Desktop | `valor://play/movie/123` deep links |
| PGS subtitle improvements | Both | Currently requires server-side burn-in + stream restart |
| Background P2P | Desktop | Keep downloading after window closed (tray mode) |
| mpv/native player option | Desktop | **Implemented** — Settings > Playback > Player Engine |
