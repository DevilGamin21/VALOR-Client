# IPC

Single source of truth: [`src/preload/index.ts`](../src/preload/index.ts) — defines `window.electronAPI`. Main-process handlers live in [`src/main/index.ts`](../src/main/index.ts) (search for `ipcMain.handle(...)`).

The renderer never imports `electron` directly; it goes through `window.electronAPI`.

## `window.electronAPI` surface

```ts
window.electronAPI = {
  overlay: { setIgnoreMouse(ignore) },

  auth: {
    getToken, setToken, clearToken,
    getAccounts, addAccount(account), removeAccount(id), switchAccount(id),
  },

  window: {
    minimize, maximize, close, isMaximized,
    onMaximizedChange(cb),
    setFullScreen(full),
  },

  updates: {
    download, install, check,
    onAvailable(cb), onProgress(cb), onDownloaded(cb), onError(cb),
  },

  system: { sleep, hostname, platform },

  discord: { setActivity(activity), clearActivity },

  mpv: {
    isAvailable,
    getPayload, launch(payload),
    togglePause, pause, resume,
    seek(secs), seekAbsolute(secs),
    setVolume(pct), loadFile(url),
    setAid(aid), setSid(sid),
    setSpeed(speed), setSubDelay(secs), subAdd(path),
    quit, fullscreen,

    onReady(cb), onTime(cb), onDuration(cb),
    onPaused(cb), onEnded(cb), onError(cb),
    removeAllListeners(),
  },
}
```

Each `mpv.on*` call first does `ipcRenderer.removeAllListeners(channel)` then `ipcRenderer.on(channel, …)` — so re-registering replaces the previous handler. Components don't have to clean up themselves, though `PlayerContext` and `PlayerOverlay` both call `removeAllListeners()` on unmount as belt-and-braces.

## Main-process handlers (selected)

### Auth (multi-account)

`electron-store` schema `{ token (legacy), accounts: AccountEntry[], activeAccountId }`. Migration: `auth:getToken` falls back to legacy `token` if no `activeAccountId` is set, so accounts created before multi-account still authenticate.

| Channel | Behaviour |
|---------|-----------|
| `auth:getToken` | Returns active account's token, or legacy `token`. |
| `auth:setToken` | Legacy single-token write — kept for the login flow during migration. |
| `auth:clearToken` | Removes the active account from the list, advances `activeAccountId` to the next account or `null`. |
| `auth:addAccount`, `auth:removeAccount`, `auth:switchAccount` | Manage `accounts[]`. |

### Window

`win:minimize`, `win:maximize`, `win:close`, `win:isMaximized`, `win:setFullScreen(full)`. The renderer also subscribes to `win:maximized` events (forwarded by `mainWindow.on('maximize'/'unmaximize')`).

### Update

| Channel | Behaviour |
|---------|-----------|
| `update:check` | `autoUpdater.checkForUpdates()` |
| `update:download` | `autoUpdater.downloadUpdate()` |
| `update:install` | `autoUpdater.quitAndInstall()` |
| `update:available`, `update:not-available`, `update:progress`, `update:downloaded`, `update:error` | Sent renderer-bound by `setupAutoUpdater()`. Both main-window and overlay-window receive them — UpdateBanner subscribes via `updates.on*`. |

`setupAutoUpdater()` only runs in production (`!ELECTRON_RENDERER_URL`). In dev there is no autoUpdater, so the banner won't appear regardless of GitHub state.

### Discord RPC

| Channel | Behaviour |
|---------|-----------|
| `discord:setActivity` | Maps the renderer's activity object onto `discord-rpc`'s `setActivity()`. No-op when `discordRpc` is null (still connecting / disabled). |
| `discord:clearActivity` | `discord-rpc.clearActivity()`. |

`initDiscordRPC()` runs on `app.whenReady` and on disconnect retries every 30s.

### mpv

| Channel | Behaviour |
|---------|-----------|
| `mpv:available` | `isMpvAvailable()` checks `process.resourcesPath/mpv/mpv.exe` (prod) or `<cwd>/resources/mpv/mpv.exe` (dev). `PlayerContext.openPlayer` uses this to fall back to built-in if mpv is missing. |
| `mpv:launch` | Spawns mpv via `MpvPlayer`, creates `playerWindow` + `overlayWindow`, hides `mainWindow`. |
| `mpv:get-payload` | Returns the payload that was passed to launch — overlay calls this on mount to reconstruct state. |
| `mpv:toggle-pause`, `mpv:pause`, `mpv:resume`, `mpv:seek`, `mpv:seek-absolute`, `mpv:volume`, `mpv:load-file`, `mpv:set-aid`, `mpv:set-sid`, `mpv:set-speed`, `mpv:set-sub-delay`, `mpv:sub-add`, `mpv:fullscreen`, `mpv:quit` | Forwarded to `MpvPlayer` methods, which serialize to mpv's JSON-IPC over the named pipe. |
| `mpv:ready/time/duration/paused/ended/error` (renderer-bound) | Property events from mpv's `observe_property`, broadcast to both windows. |

### Overlay

`overlay:set-ignore-mouse(ignore)` — toggles `overlayWindow.setIgnoreMouseEvents(...)` so mouse events fall through to mpv when the user isn't hovering the controls bar.

### System

`system:sleep` (suspends Windows via `rundll32 powrprof,SetSuspendState`), `system:hostname`, `system:platform`.

## CORS bypass (not strictly IPC)

`session.defaultSession.webRequest.onBeforeSendHeaders` injects `Origin: https://valor.dawn-star.co.uk` for every request — so the backend's CORS policy whitelists us.
`onHeadersReceived` rewrites response headers to add `Access-Control-Allow-Origin: *` and friends, so the renderer can read responses regardless of what the backend returns.

This is critical and must remain — without it, every API call fails CORS preflight.
