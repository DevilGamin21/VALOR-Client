# Connect — remote control

Lets devices on the same VALOR account see each other and shoot playback commands across (e.g. start a movie on the TV from the phone, or pause the desktop from the TV remote).

## Wire

- WebSocket: `wss://apiv.dawn-star.co.uk/ws/connect?deviceId=…&deviceName=…&token=…`
- Provider: [`src/renderer/src/contexts/ConnectContext.tsx`](../src/renderer/src/contexts/ConnectContext.tsx)
- Identity: `deviceId` is a UUID persisted in localStorage `valor-connect-device-id`. `deviceName` comes from `electronAPI.system.hostname()`.

Server-pushed messages and what we do:

| `msg.type` | Behaviour |
|-----------|-----------|
| `devices` | Replaces our `devices` list. Drives the device picker in the Connect page and the badge on the sidebar Connect icon. |
| `deviceState` | Patches the named device's `state` (playback meta, position, paused, …). Used by ConnectBar/Connect page when this client is *controlling* another. |
| `command` | If `controlRejectedRef` is false and a `commandHandlerRef.current` is registered, invoke it. Sets `controlledBy` for play/pause/seek/playMedia commands so the "Being controlled by X" strip shows. |
| `ping` | Replies `{ type: 'pong' }`. |
| `error` | Logged. |

Client→server messages:

| Sent via | Body |
|----------|------|
| `pushState({ playing, positionSeconds, durationSeconds, mediaMeta })` | `{ type: 'state', state }` — pushed every 5s while mpv is active, plus on transition. |
| `sendCommand(targetId, command, payload)` | `{ type: 'command', targetDeviceId, command, payload }` — forwarded by the server to the target. |

Reconnect: any close with code ≠ 1000 schedules a 3s reconnect. Code 1000 is intentional (unmount or "replaced" — see below).

## "Replaced" close — overlay window quirk

The overlay BrowserWindow mounts the full provider tree, including ConnectProvider. When mpv launches:

1. Main window already has its own `/ws/connect` WebSocket open with `deviceId=X`.
2. Overlay window opens, mounts `ConnectProvider`, opens **another** WebSocket with the same `deviceId=X`.
3. The server kicks the older connection (deduplication by deviceId) with `code=1000 reason=replaced`.
4. Main window's `onclose` runs, doesn't reconnect (code 1000).

Console line `[Connect] Closed code=1000 reason=replaced` is the smoking gun. Harmless — overlay's WS takes over until the player closes, then main reconnects on the next mount.

If you ever want a single shared connection across both windows, hoist `ConnectProvider` into the main process (or proxy through main-process IPC). Not worth the rework for now.

## How `playMedia` is handled when nothing is playing

`PlayerContext.tsx` registers an idle command handler whenever no player is active. On `playMedia` payload `{ tmdbId, type, title, year?, season?, episode?, startPositionTicks?, isAnime? }`:

1. `api.startStream(...)` to kick the on-demand pipeline.
2. Poll `getStreamStatus` until ready.
3. Build a `PlayJob` and call `openPlayer(...)`.

When mpv is running, the *mpv* command handler takes over and just relays `play / pause / seek / resume` directly to the mpv subprocess.

## ConnectBar

`components/ConnectBar.tsx` renders a persistent bottom strip when this device is *controlling* another. Shows the target's media meta + transport controls.

The "Being controlled by X" indicator is in `RootShell` and surfaces when `connectCtx.controlledBy` is non-null. The Stop button calls `connectCtx.rejectControl()`, which sets `controlRejectedRef` for 30 seconds so any in-flight commands from that controller are ignored.
