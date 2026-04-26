# Playback

The single most complex subsystem. Three modes, two players, one shared `PlayJob` shape.

## The three modes

Mode is decided by `SettingsContext.playerEngine` (`'builtin' | 'mpv'`) and whether the play-job returned a `directStreamUrl`.

| Mode | Engine | URL used | Used when |
|------|--------|----------|-----------|
| Built-in direct play | `<video src=…>` (no HLS.js) | `job.directStreamUrl` | Engine=built-in AND backend returned a direct URL. Currently rare — Chromium can't decode DTS/AC3/TrueHD/HEVC10. |
| Built-in transcoded | `<video>` + HLS.js | `job.hlsUrl` | Engine=built-in. Default for built-in. |
| mpv | external mpv process embedded into a `BrowserWindow` via `--wid` | `job.directStreamUrl ?? job.hlsUrl` | Engine=mpv AND mpv.exe is bundled. Falls back to built-in when mpv isn't available (`PlayerContext.openPlayer` checks `mpv.isAvailable()`). |

`SettingsContext.directPlay` only takes effect for the **mpv** engine — see [`Home.tsx:279`](../src/renderer/src/pages/Home.tsx#L279). The built-in player can't use direct play with non-Chromium codecs, so the play-job request is sent with `directPlay:false` for the built-in path.

## PlayJob

Defined in [`src/renderer/src/types/media.ts`](../src/renderer/src/types/media.ts). Key fields:

| Field | Source | Purpose |
|-------|--------|---------|
| `hlsUrl` | `/jellyfin/play-job` or stream-status | HLS playlist URL (always present) |
| `directStreamUrl` | same | Direct file or VALOR proxy (`/stream-proxy/<id>?token=…` for `.strm`) |
| `playSessionId` / `deviceId` | same | Used as `previousPlaySessionId/Id` when restarting transcode (audio/quality switch, seek) |
| `audioTracks[]`, `subtitleTracks[]` | `/jellyfin/play-job` | Backfilled from the play-job after on-demand stream is ready (the on-demand status response often omits these) |
| `durationTicks` | Jellyfin | Authoritative — the player UI prefers this over `video.duration` (Infinity/buffered for transcoded HLS) and over mpv's live `duration` event |
| `introStartSec/introEndSec/creditsStartSec` | `/playback-context` (preferred) or play-job (fallback) | Skip-intro / Up Next markers |
| `tmdbId`, `seasonNumber`, `episodeNumber`, `isAnime` | client | Used for `/playback-context`, subtitle search, progress reporting |
| `mpvOptions` | on-demand status | Per-item mpv CLI overrides (e.g. cache-secs) |

## Play sequence (PlayModal)

User clicks Play in `PlayModal`:

1. `api.startStream({ tmdbId, type, title, season, episode, isAnime })` → returns `{ streamId }`.
2. Poll `api.getStreamStatus(streamId)` every 1.5s. Phases shown via `PHASE_LABELS`.
3. When `phase === 'ready'`, call `api.startPlayJob({ itemId: status.itemId, … })` to backfill audio/subtitle tracks (the on-demand status response often returns those empty/single-track because the upstream pipeline doesn't probe Jellyfin's full media-source). This mirrors the Android client.
4. Build `PlayJob` from the play-job response (preferred) plus the on-demand status (fallback for fields the play-job lacks).
5. `openPlayer(job, startTicks, episodes, currentEpisodeId)`.
6. `PlayerProvider.openPlayer` checks `mpv.isAvailable()` if engine is mpv, falls back to built-in otherwise. Then either `launchMpv(...)` or `setIsOpen(true)` (which mounts `<VideoPlayer>` in `RootShell`).

`Home.tsx` resume flow: a fast path calls `startPlayJob` directly (item still in Jellyfin); slow path is the same poll loop as PlayModal.

## mpv embedding

`MpvPlayer` (`src/main/mpvPlayer.ts`) spawns shinchiro mpv from `process.resourcesPath/mpv/mpv.exe` (prod) or `<cwd>/resources/mpv/mpv.exe` (dev). Communicates over the named pipe `\\.\pipe\valor-mpv-ipc` using mpv's JSON-IPC protocol.

Launch args:

```
<url>
--no-terminal --keepaspect=yes
--hwdec=d3d11va                      # hardware decode on Windows
--video-sync=display-resample
--interpolation
--no-osc                             # we render our own controls
--osd-font-size=32
--input-ipc-server=\\.\pipe\valor-mpv-ipc
--wid=<HWND>                         # embed into playerWindow
--vo=direct3d                        # D3D9 — see Known Issues
--no-input-default-bindings --input-vo-keyboard=no
[--start=<secs>] [--title=<title>] [extraArgs from job.mpvOptions]
```

Two BrowserWindows are created in `createPlayerWindow()`:
- **`playerWindow`** — black, transparent, frameless. mpv embeds into its native HWND. Closes ⇒ mpv quits ⇒ both windows close ⇒ main window re-shows.
- **`overlayWindow`** — transparent child of `playerWindow`, loads `index.html#/player-overlay`. Hosts the controls UI. Mouse events are forwarded to the underlying mpv window via `setIgnoreMouseEvents(true, { forward: true })`; the overlay flips this to `false` while the controls bar is hovered.

Multi-monitor: both windows are kept in lockstep on `move`/`resize` events (handles Win+Shift+arrow re-snapping).

mpv events from the IPC pipe are broadcast to **both** windows via `mainWindow?.webContents.send(channel, …)` and `overlayWindow?.webContents.send(channel, …)`. The renderer's preload uses `removeAllListeners` before `on(...)` for each `mpv:*` channel, so `onTime/onDuration/onReady/etc.` always replace previous listeners (no leaks if a component re-registers).

## Built-in HLS player

`components/VideoPlayer.tsx` mounts in `RootShell` via `AnimatePresence` when `isOpen && job` are set. Uses HLS.js with:

- `enableWorker: true`, `lowLatencyMode: false`
- Manifest events logged for diagnostics
- Fatal MEDIA_ERROR → `hls.recoverMediaError()`. Other fatal errors → user-visible error message
- Direct-play branch: bypass HLS.js entirely, `video.src = job.directStreamUrl`
- Audio/subtitle preferences saved per series (`localStorage av-prefs-<seriesId|itemId>`)

## Audio / subtitle / quality switching

Jellyfin HLS only emits one audio track per transcode; switching requires a full restart. The pattern is the same in `VideoPlayer` and `PlayerOverlay`:

1. `api.startPlayJob({ itemId, audioStreamIndex|maxBitrate|subtitleStreamIndex, startTimeTicks: <currentTime>, previousPlaySessionId: job.playSessionId, previousDeviceId: job.deviceId, tmdbId })`
2. Backend kills the old FFmpeg (sees `previousPlaySessionId`) before starting the new one — race condition fix.
3. `loadSrc(newJob.hlsUrl, savedTime)` (built-in) or `mpv.loadFile(newJob.hlsUrl)` (overlay) and `updateJob(newJob)`.

mpv direct play is the exception: native `mpv.setAid(aid)` / `mpv.setSid(sid)` switch tracks without restarting.

## Seeking

- Built-in HLS: `video.currentTime = frac * effectiveDuration` where `effectiveDuration` prefers `job.durationTicks` over `video.duration` (which is Infinity / buffered-only for transcoded HLS).
- mpv direct play: `mpv.seekAbsolute(secs)`.
- mpv HLS transcoded: **must restart the transcode**. `seekToAbsolute(secs)` calls `startPlayJob({ startTimeTicks: …, previousPlaySessionId: …, previousDeviceId: … })` then `mpv.loadFile(newJob.hlsUrl)`. Seeking past what's been transcoded with raw `mpv.seekAbsolute` makes mpv exit silently.
- ±10s skip buttons stay inside the buffer, so `mpv.seek(±10)` is fine without a restart.

## Skip Intro / Up Next

Both players fetch `/playback-context` once per episode at mount and cache in component state:

```ts
api.getPlaybackContext({
  tmdbId: job.tmdbId,
  type: job.seriesId ? 'tv' : (job.type as 'movie' | 'tv'),
  season: job.seasonNumber,
  episode: job.episodeNumber,
  isAnime: job.isAnime,
  duration: job.durationTicks ? job.durationTicks / 10_000_000 : undefined,
})
// → { introStartSec, introEndSec, creditsStartSec, source, isDefault, nextEpisode }
```

Markers: `introStart/introEnd/creditsStart` come from the cached context; fall back to `job.introStartSec` etc. if the API call fails.

Up Next:
- Trigger fires when `currentTime ≥ creditsStart` (fallback: last 120s) and a usable next episode exists.
- "Next episode" prefers `pbCtx.nextEpisode` matched by S/E into `episodeList` (so we have a `jellyfinId` for the existing fast-switch path). Falls back to `episodeList[idx + 1]`.
- Cross-season jumps where `pbCtx.nextEpisode` exists but `episodeList` doesn't have the match are **suppressed** — switching would need an on-demand `startStream` flow (per-spec) which isn't wired in yet.

## Heartbeat / progress

Both players post to `/jellyfin/progress` every 10s with the current position, duration, paused state, session id, and TMDB metadata (so the backend can save into the progress store in the same call).

`isStopped: true` is sent on close. mpv's overlay handles its own heartbeat; the main-window `PlayerContext` only tracks time/duration for stop-reporting if mpv exits unexpectedly.
