# VALOR Desktop Client — Docs

Authoritative reference for the Electron + React desktop client at `c:\VALOR-Client`.
These docs are derived from the current source — when in doubt, the code wins; update these when behaviour changes.

## What this app is

A multi-platform (Windows-first, Linux secondary) desktop client for the VALOR
streaming backend at `apiv.dawn-star.co.uk`. Talks to a Jellyfin-backed
on-demand pipeline that stages content from Real-Debrid, returns HLS or
direct-play URLs, and exposes a few helper endpoints
(`/playback-context`, `/jellyfin/play-job`, etc.).

## Index

| Doc | What's in it |
|-----|--------------|
| [architecture.md](architecture.md) | Processes, build system, providers, routing, file layout |
| [playback.md](playback.md) | Three playback modes, mpv embed, HLS.js, switching, intro/credits, Up Next |
| [ipc.md](ipc.md) | Preload `window.electronAPI` surface and main-process IPC handlers |
| [backend-api.md](backend-api.md) | Backend endpoints the client uses, including `/playback-context` |
| [build-and-release.md](build-and-release.md) | npm scripts, electron-builder, GitHub Releases, auto-update, Android coupling |
| [connect.md](connect.md) | WebSocket-based remote control |
| [known-issues.md](known-issues.md) | Gotchas the codebase encodes — read before editing playback or builds |

## Quick start

```bash
npm install
npm run dev          # electron-vite dev — main, preload, renderer hot-reload
npm run package:win  # local installer to dist/VALOR-Setup.exe (no version bump)
npm run release:win  # patch bump + build + upload to GitHub Releases (needs GH_TOKEN)
```

Full release flow including Android APKs: see [build-and-release.md](build-and-release.md).

## Repo structure (top level)

```
src/
  main/        — Electron main process (window mgmt, mpv subprocess, IPC, autoupdater)
  preload/     — contextBridge surface (window.electronAPI)
  renderer/    — React app (HashRouter, all UI)
resources/mpv/ — bundled shinchiro mpv build (Windows only)
scripts/       — build pipeline (build.mjs orchestrates bump/compile/package/upload)
electron-builder.yml — packaging config (NSIS installer, GitHub publish target)
electron.vite.config.ts — Vite build for main + preload + renderer
```

## Backend coupling

- All HTTP at `https://apiv.dawn-star.co.uk` via `services/api.ts`
- Auth: JWT in electron-store, sent as `Authorization: Bearer <token>`
- WebSocket: `wss://.../ws/connect` for the Connect feature
- mpv plays either `directStreamUrl` (Jellyfin direct or VALOR proxy for `.strm`) or `hlsUrl` (Jellyfin HLS transcode)
