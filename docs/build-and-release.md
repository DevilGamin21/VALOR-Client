# Build & Release

Authoritative source: [`scripts/build.mjs`](../scripts/build.mjs), [`electron-builder.yml`](../electron-builder.yml), and the legacy [`RELEASING.md`](../RELEASING.md). This doc summarises the commands and the sharp edges.

## npm scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | `electron-vite dev` — hot-reload renderer, rebuild main/preload on change. |
| `npm run build` | `electron-vite build` — produces `out/main`, `out/preload`, `out/renderer`. |
| `npm run package:win` | `npm run build` + `electron-builder --win --publish never`. No version bump. |
| `npm run package:linux` | Same for AppImage + .deb. Cross-compiling from Windows needs symlink privileges. |
| `npm run build:win` | Patch bump + compile + package via `scripts/build.mjs`. Windows installer in `dist/`. |
| `npm run build:win:nobump` | Same, no bump. |
| `npm run build:win:minor` / `:major` | Minor / major bump. |
| `npm run release:win` | Patch bump + package + **upload to GitHub Releases**. Needs `GH_TOKEN`. |
| `npm run build:linux` / `release:linux` | Linux equivalents. |

## What `scripts/build.mjs` does

1. Parses args: `[patch|minor|major|none] [--platform win|linux|mac] [--release]`.
2. **Bump**: `npm version <patch|minor|major> --no-git-tag-version` — updates `package.json` + `package-lock.json` in lockstep. Skipped for `none`.
3. **Installer assets** (Windows only): runs `scripts/generate-assets.mjs` to regenerate the NSIS sidebar/header bitmaps.
4. **Compile**: `npm run build`.
5. **Package**:
   - Windows: pre-extracts `winCodeSign-2.6.0` into `%LOCALAPPDATA%/electron-builder/Cache` *without* `-snl` so the macOS .dylib symlinks are silently skipped (avoids the symlink-privilege error on non-Developer-Mode Windows).
   - Then `npx electron-builder --<platform> --publish always|never`.
6. **Release**: when `--release` is set, electron-builder auto-creates the GitHub Release (or updates an existing one) and uploads installer + blockmap + `latest.yml`.

The script does **not** create a git commit or tag for the bump. electron-builder creates the GitHub Release and tag itself when `--publish always`. If you ran `release:win` and it succeeded, push your bump commit afterwards (`git add package.json package-lock.json && git commit -m vX.Y.Z && git push`).

## `electron-builder.yml` highlights

| Field | Value | Notes |
|-------|-------|-------|
| `appId` | `uk.co.dawn-star.valor-client` | |
| `productName` | `VALOR` | Displayed name in installers and shortcuts. |
| `files` | `out/**/*` | Only the built renderer/main/preload, not source. |
| `win.extraResources` | `from: resources/mpv → to: mpv`, filter `**/*.exe`, `**/*.dll` | Bundles the shinchiro mpv build. **Use recursive globs** (`**/*`) — single-level `*.exe`/`*.dll` silently misses files. |
| `win.target` | `nsis` x64 | |
| `win.artifactName` | `VALOR-Setup.exe` | Stable filename so the GitHub "latest" download URL doesn't change. |
| `win.requestedExecutionLevel` | `asInvoker` | Per-user install, no UAC prompt. |
| `nsis.allowElevation` | `false` | |
| `nsis.deleteAppDataOnUninstall` | `false` | Preserves electron-store JWT across uninstall/reinstall. |
| `publish.github` | `DevilGamin21/VALOR-Client` | |

## GitHub Releases requirements (auto-update)

Each desktop release MUST contain on the same release tag:

| File | Required for |
|------|--------------|
| `VALOR-Setup.exe` | Manual download + auto-update |
| `VALOR-Setup.exe.blockmap` | Delta auto-update math |
| `latest.yml` | electron-updater discovery — **without it, no client updates** |
| `latest-linux.yml` | Linux equivalent (only when shipping Linux) |
| `VALOR-Setup.AppImage` (optional) | Linux installer |
| `VALOR-Setup.deb` (optional) | Debian/Ubuntu (no auto-update) |

### Android coupling

Android APKs (`VALOR-mobile.apk`, `VALOR-tv.apk`) **must be uploaded to the same GitHub Release as the Windows build**. The Android `UpdateManager` reads `https://api.github.com/repos/DevilGamin21/VALOR-Client/releases/latest` and matches by exact asset name. A separate Android-only release would shadow the Windows `latest.yml` and break desktop auto-update.

Asset names are **case-sensitive**: `VALOR-mobile.apk`, `VALOR-tv.apk`. Tag must be clean semver (`vX.Y.Z`) with no suffixes — the Android comparison splits on `.` and parses ints, so `v0.2.82-android` would silently mis-compare.

Build Android from `c:\VALOR-TV`:
```bash
./gradlew assembleMobileRelease assembleTvRelease
# APKs at app/build/outputs/apk/{mobile,tv}/release/app-*-release.apk
```
Bump `versionCode` and `versionName` in `app/build.gradle.kts` to match the desktop version.

## Auto-update flow (electron-updater)

Configured in `setupAutoUpdater()` (only runs in production, not in `npm run dev`):

```
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.allowElevation = false
setTimeout(() => autoUpdater.checkForUpdates(), 5_000)
```

Events forwarded to renderer:
- `update-available` → `update:available` → UpdateBanner shows "Update vX.Y.Z — downloading…"
- `download-progress` → `update:progress` → percent + KB/s in the banner
- `update-downloaded` → `update:downloaded` → "vX.Y.Z ready — restarting in 5s" with auto-restart countdown
- `error` → `update:error`

If the banner doesn't appear after a release: most common cause is `latest.yml` missing from the GitHub Release, or the version in `latest.yml` not actually being newer than the installed version.

## Token

`GH_TOKEN` env var must be set for `release:*` commands. Use a fine-grained PAT with **Contents: Read and write** on `DevilGamin21/VALOR-Client`. Two endpoints, two auth styles (electron-builder handles both internally; manual curl uploads need to know the difference):

| Endpoint | Auth header |
|----------|-------------|
| `api.github.com` | `Authorization: Bearer $TOKEN` |
| `uploads.github.com` | `-u "DevilGamin21:$TOKEN"` with `--post301 --location-trusted` |
