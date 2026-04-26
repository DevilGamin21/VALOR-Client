# Backend API

All HTTP requests live in [`src/renderer/src/services/api.ts`](../src/renderer/src/services/api.ts). Base URL `https://apiv.dawn-star.co.uk`. JWT (`Bearer`) on every request via `getToken()` → preload → `auth:getToken` → electron-store.

`request<T>(path, init?)` is the shared wrapper — adds the auth header, parses JSON, throws on non-2xx with the response body's `error`/`message` if available.

## Auth

| Endpoint | Used for |
|----------|----------|
| `POST /auth/login` | Login form |
| `POST /auth/register` | Registration |
| `GET  /auth/me` | Bootstrapping the session in `AuthContext` |
| `POST /auth/avatar` (multipart) | Avatar upload from Profile |

## Catalog & search

| Endpoint | Notes |
|----------|-------|
| `GET /trending` | Home hero + rows. Returns `{ movies, tv, hero }`. |
| `GET /movies?…`, `GET /tv?…` | Browse pages. Filtered by query string. |
| `GET /search?q=…` | Search bar in TitleBar. |
| `GET /tmdb-detail/<tmdbId>?type=…` | PlayModal genre/rating/backdrop enrichment. |
| `GET /jellyfin/shows/<id>/seasons` | TV detail seasons list. |
| `GET /jellyfin/shows/<id>/episodes?season=…` | Episodes for a season. |
| `GET /jellyfin/item-tmdb/<itemId>` | Resolve a Jellyfin episode to series + tmdbId. |
| `GET /jellyfin/resume` | Fallback continue-watching when the VALOR progress store is empty. |

## Playback

### `POST /jellyfin/play-job`
Body: `{ itemId, audioStreamIndex?, subtitleStreamIndex?, maxBitrate?, directPlay?, startTimeTicks?, previousPlaySessionId?, previousDeviceId?, tmdbId? }`.
Response is the `PlayJob` shape (see [playback.md](playback.md)). `previousPlaySessionId/previousDeviceId` lets the backend kill the prior FFmpeg before starting a new transcode — sent on every audio/quality/subtitle switch and on seek for HLS-mpv.

### `POST /stream/play` and `GET /stream/play/:streamId`
On-demand pipeline used by PlayModal Play button and Home resume slow-path.

`POST` body: `{ tmdbId, type, title, year?, season?, episode?, imdbId?, isAnime? }`.
Response: `{ streamId }`.

`GET /stream/play/:streamId` poll response includes `phase` (one of `starting | resolving | checking_cache | scraping | adding_to_rd | downloading | unrestricting | preparing | building | ready | error`) and, when `ready`, the same fields as a `PlayJob` (hlsUrl, directStreamUrl, playSessionId, deviceId, audioTracks, subtitleTracks, durationTicks, intro/credits markers, …).

**The on-demand status often returns empty/single-track `audioTracks` and `subtitleTracks`.** The client now always calls `startPlayJob` after `phase === 'ready'` to backfill the full track list — see PlayModal/Home.

### `POST /jellyfin/progress`
Heartbeat + progress store save in one call. Body: `{ itemId, positionTicks, durationTicks, isPaused, playSessionId, isStopped?, seriesId?, title?, posterUrl?, type?, year?, tmdbId?, seasonNumber?, episodeNumber?, episodeName? }`. Sent every 10s and on stop.

### `GET /jellyfin/item-progress/:itemId`
Single-item progress lookup — used by PlayModal to surface a "Resume from Xm" button.

## `/playback-context` (skip-segments + Up Next)

`GET /playback-context?tmdbId=…&type=tv|movie&season=…&episode=…&isAnime=1&duration=…`

Response:
```json
{
  "success": true,
  "introStartSec": 42,
  "introEndSec": 132,
  "creditsStartSec": 1320,
  "source": "aniskip" | "tidb" | "default" | null,
  "isDefault": false,
  "nextEpisode": { "seasonNumber": 1, "episodeNumber": 5, "title": "…" } | null
}
```

Called once per episode at player mount in both `VideoPlayer` and `PlayerOverlay`. Result cached in component state. The server falls back to a smart default for `creditsStartSec` (90s before end for short content, 150s for hour-long) when the upstream APIs miss — pass `duration` so it can.

The client's Up Next overlay fires when `currentTime ≥ creditsStartSec`. If the API returns nothing, it falls back to `duration - 120s`.

## Watchlist

`GET /watchlist`, `POST /watchlist`, `DELETE /watchlist/:tmdbId`.

## User progress (TMDB-keyed)

| Endpoint | Notes |
|----------|-------|
| `GET /user-progress/continue-watching` | Drives the Home rail. Returns `ProgressItem[]`. |
| `GET /user-progress/watched-episodes/:tmdbId` | List of `["S1E1","S1E3",…]`. |
| `POST /user-progress/watched-episodes/:tmdbId` | Body: `{ episodes: ["S1E5"] }`. |
| `DELETE /user-progress/watched-episodes/:tmdbId` | Body: `{ episodes: ["S1E5"] }`. |
| `POST /user-progress/mark-watched`, `DELETE /user-progress/mark-watched` | Movie watched toggle. |

## Subtitles

| Endpoint | Notes |
|----------|-------|
| `GET /jellyfin/subtitle-vtt/:itemId/:trackIndex` | VTT for a Jellyfin embedded subtitle. |
| `GET /opensubtitles/search?…` | OpenSubtitles search (see VideoPlayer/PlayerOverlay subtitle panel). |
| `GET /opensubtitles/download/:fileId` | Returns VTT for chosen result. |

## Connect (remote control)

WebSocket: `wss://apiv.dawn-star.co.uk/ws/connect?deviceId=…&deviceName=…&token=…`. See [connect.md](connect.md).
