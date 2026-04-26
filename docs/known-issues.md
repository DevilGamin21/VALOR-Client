# Known issues / sharp edges

Things the codebase encodes as workarounds. Read before editing playback or builds.

## Playback

### `video.duration` is `Infinity` for Jellyfin transcoded HLS
HLS.js exposes `Infinity` (or a slowly-growing buffered value) as `video.duration` for transcoded streams whose manifest is generated on-the-fly. The fix in code: prefer `job.durationTicks / 10_000_000`. The progress bar, time readout, and `seekTo` all use the derived `effectiveDuration`. Touching this code? Don't go back to raw `video.duration`.

### mpv reports a growing `duration` for HLS, too
Same root cause from a different angle. The mpv overlay also prefers `job.durationTicks` for the progress bar / time / seek. The mpv `duration` event is only authoritative for direct play.

### Seeking past the buffered region in mpv-HLS kills mpv
mpv silently exits if you `seekAbsolute` to a time that's beyond what Jellyfin has transcoded. Fix: `seekToAbsolute(secs)` in `PlayerOverlay.tsx` calls `startPlayJob({ startTimeTicks })` + `mpv.loadFile(newJob.hlsUrl)` for HLS; only direct play uses `mpv.seekAbsolute` directly. ±10s buttons stay inside the buffer so they don't need this dance.

### mpv `--vo=gpu --gpu-context=d3d11` conflicts with Chromium's compositor
When mpv is embedded into a transparent BrowserWindow via `--wid`, using D3D11 gpu output makes mpv exit silently right after IPC connects (overlay vanishes, looks like an instant-close crash). Use `--vo=direct3d` (D3D9). We lose mpv's HDR tone-mapping, but it actually works. Documented in [`src/main/mpvPlayer.ts`](../src/main/mpvPlayer.ts).

### Jellyfin HLS only emits one audio track per transcode
Switching audio requires a full transcode restart with the new `audioStreamIndex`. The client sends `previousPlaySessionId` + `previousDeviceId` so the backend kills the old FFmpeg before starting the new one (race-condition fix). `AllowAudioStreamCopy` must be `false` when an explicit `audioStreamIndex` is provided — otherwise Jellyfin reuses the prior session. Backend uses fixed `DeviceId=VALOR-PLAYER-01`.

### On-demand stream status returns empty `audioTracks`
The on-demand pipeline doesn't probe Jellyfin's full media-source. `audioTracks`/`subtitleTracks` come back empty for many sources. The client (PlayModal + Home) calls `startPlayJob` after `phase === 'ready'` to backfill — same pattern as the Android client.

### `progress reporting` sends `itemId` (episode), not seriesId
Mark-watched uses TMDB `S{n}E{m}` keys. Progress reporting uses the Jellyfin episode `itemId` as `mediaId`. Don't conflate.

## Build / package

### `extraResources` filter must be recursive
Single-level globs (`*.exe`/`*.dll`) silently fail to match nested files. Use `**/*.exe`/`**/*.dll`. We hit this — the bundled installer was missing `mpv.exe` for several releases until the filter was fixed.

### The bundled mpv runs standalone but can fail when embedded
If you suspect a corrupt install (electron-updater delta patching can produce unexpected results when files were missing in the previous version), test the installed binary directly:
```
"C:\Users\<you>\AppData\Local\Programs\VALOR\resources\mpv\mpv.exe" --version
```
If that works but the player crashes, the issue is embedding-related (see the `--vo` note above).

### `winCodeSign` symlink-extraction needs Developer Mode
electron-builder downloads winCodeSign and tries to extract it with `7za -snl`, which creates real Windows symlinks for the macOS .dylib files — privileged operation. `scripts/build.mjs` pre-extracts without `-snl`, silently dropping the .dylib symlinks (they're irrelevant on Windows builds). Don't undo this.

### `latest.yml` is mandatory for auto-update
Without `latest.yml` on the GitHub Release, `electron-updater` cannot detect updates and the UpdateBanner never fires. Always upload all three of `VALOR-Setup.exe`, `VALOR-Setup.exe.blockmap`, `latest.yml`.

### `package.json` and `package-lock.json` must agree on version
`scripts/build.mjs` bumps both via `npm version --no-git-tag-version`. If you bump manually, do both. Mismatched versions cause weird electron-builder behaviour.

## Renderer / state

### Both windows mount the entire provider tree
Main window and overlay window are the same renderer bundle. ConnectProvider opens a fresh WebSocket in the overlay window — the server replaces the main one (`code=1000 reason=replaced`). Harmless but easy to misdiagnose.

### `__APP_VERSION__` must be in `declare global`
Defined by Vite (`define` in `electron.vite.config.ts`). For TS to see it, the declaration in `src/renderer/src/types/electron.d.ts` lives inside the `declare global { … }` block — module-scoped `declare const` doesn't make it global if the file has any top-level `export`.

### CSP needs `blob:` in `media-src`
HLS.js feeds segments to MSE via blob URLs. Without `blob:` in `media-src`, playback silently fails. See `src/renderer/index.html`.

### DevTools shortcut works in production
Ctrl+Shift+I toggles DevTools in any build (intentional — for diagnosing user-reported issues). Wired in `mainWindow.webContents.on('before-input-event', …)` and same for the overlay window.

### Gamepad focus rings use `box-shadow`, not `outline`
`outline` doesn't follow `border-radius` reliably across all elements. `gp-focused` applies `box-shadow: 0 0 0 4px` with the heartbeat-glow keyframes. Don't switch to outline.

### React re-renders strip manually-applied classes
After click, `GamepadNavContext.activate()` re-applies `gp-focused` via `requestAnimationFrame` because React's className update would clobber it.

## Backend

### Backend deploys at `f:/VALOR/backend/` take effect immediately
No rebuild needed — backend is hot-reloading. If a `/playback-context` change is needed for the client, ask for a backend deploy and the client picks it up on next call.

### `tmdbId` overrides Jellyfin's `ProviderIds.Tmdb`
Jellyfin's auto-identify can return a wrong tmdbId. The client sends its own `tmdbId` on `startPlayJob` and `reportProgress` so subtitle search and progress reporting use the right one.
