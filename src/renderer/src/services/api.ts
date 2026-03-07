import type {
  UnifiedMedia,
  PlayJob,
  Season,
  Episode,
  User,
  ProgressItem,
  TrendingResponse,
  P2PStatus
} from '@/types/media'

export const API_BASE = 'https://apiv.dawn-star.co.uk'

// ─── Avatar URL helper ────────────────────────────────────────────────────────
// The backend stores avatar paths as "/api/avatars/file.jpg" (Next.js proxy path).
// On the desktop client we call the backend directly, so we rewrite to
// "https://apiv.dawn-star.co.uk/avatars/file.jpg" (backend serves /avatars/ statically).
export function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url          // already absolute
  const path = url.replace(/^\/api\//, '/')           // /api/avatars/… → /avatars/…
  return `${API_BASE}${path}`
}

// ─── Normalize backend user → client User ─────────────────────────────────────
// Backend uses `isAdmin: boolean`; client User type uses `role: 'admin' | 'user'`.
function normalizeUser(raw: Record<string, unknown>): User {
  return {
    id: String(raw.id ?? ''),
    username: String(raw.username ?? ''),
    email: String(raw.email ?? ''),
    role: raw.isAdmin ? 'admin' : 'user',
    avatarUrl: resolveAvatarUrl(raw.avatarUrl as string) ?? undefined,
    tier: (raw.tier as User['tier']) ?? undefined,
    subscriptionExpiresAt: (raw.subscriptionExpiresAt as string | null | undefined) ?? undefined,
    trialStartedAt: (raw.trialStartedAt as string | null | undefined) ?? undefined,
    jellyfinUserId: (raw.jellyfinUserId as string | null | undefined) ?? undefined,
    isPremium: (raw.isPremium as boolean) ?? false,
  }
}

// ─── Token helpers ────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  try {
    return await window.electronAPI.auth.getToken()
  } catch {
    return null
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

/** Fetch a text response with auth headers (e.g. VTT subtitles). */
export async function fetchText(path: string): Promise<string> {
  const token = await getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken()
  const headers: Record<string, string> = {}

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Don't force Content-Type on FormData — browser sets it with the boundary
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const merged: RequestInit = {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) }
  }

  const res = await fetch(`${API_BASE}${path}`, merged)

  if (res.status === 401) {
    await window.electronAPI.auth.clearToken()
    window.location.hash = '/login'
    throw new Error('Session expired')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(text || `HTTP ${res.status}`)
  }

  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json() as Promise<T>
  return res.text() as unknown as T
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  const res = await request<{ token: string; user: Record<string, unknown> }>('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
  return { token: res.token, user: normalizeUser(res.user) }
}

export async function getMe(): Promise<User> {
  // Backend returns { success: true, user: { id, username, email, isAdmin, avatarUrl, … } }
  const res = await request<{ success: boolean; user: Record<string, unknown> }>('/me')
  return normalizeUser(res.user)
}

// ─── Trending / search ────────────────────────────────────────────────────────

export async function getTrending(): Promise<TrendingResponse> {
  return request('/home/trending')
}

export async function searchItems(q: string): Promise<UnifiedMedia[]> {
  const res = await request<{ success: boolean; results: UnifiedMedia[] }>(`/search?q=${encodeURIComponent(q)}`)
  return res.results ?? []
}

export async function getJellyfinLatest(limit = 40): Promise<UnifiedMedia[]> {
  const res = await request<{ success: boolean; items: UnifiedMedia[] }>(`/jellyfin/latest?limit=${limit}`)
  return res.items ?? []
}

// ─── Playback ─────────────────────────────────────────────────────────────────

export interface PlayJobRequest {
  itemId: string
  audioStreamIndex?: number
  subtitleStreamIndex?: number
  maxBitrate?: number
  /** When true, backend uses original-quality HLS (video stream-copy where possible) */
  directPlay?: boolean
  /** Start FFmpeg from this position (ticks = seconds × 10_000_000). Prevents infinite
   *  buffering when switching streams mid-playback — without it FFmpeg starts at 0 and
   *  HLS.js has to wait for it to encode up to the current playback position. */
  startTimeTicks?: number
}

export async function startPlayJob(body: PlayJobRequest): Promise<PlayJob> {
  return request('/jellyfin/play-job', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export async function reportProgress(body: {
  itemId: string
  positionTicks: number
  durationTicks: number
  isPaused: boolean
  playSessionId: string
  isStopped?: boolean
}): Promise<void> {
  return request('/jellyfin/progress', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export async function getItemProgress(
  itemId: string
): Promise<{ positionTicks: number; durationTicks: number; percent: number } | null> {
  return request(`/jellyfin/item-progress/${itemId}`)
}

// ─── Jellyfin item lookup ─────────────────────────────────────────────────────

/** Resolve a Jellyfin item to its series-level info.
 *  For episodes, returns the parent series ID + tmdbId. */
export async function lookupJellyfinItem(itemId: string): Promise<{
  tmdbId: number | null
  seriesId: string | null
  type: 'tv' | 'movie'
  overview: string | null
  posterUrl: string | null
}> {
  return request(`/jellyfin/item-tmdb/${encodeURIComponent(itemId)}`)
}

// ─── TV / seasons ─────────────────────────────────────────────────────────────

export async function getSeasons(itemId: string): Promise<Season[]> {
  // Backend returns { success, seasons: [{ key, seasonNumber, title, episodeCount }] }
  const res = await request<{
    success: boolean
    seasons: Array<{ key: string; seasonNumber: number; title: string; episodeCount: number }>
  }>(`/jellyfin/shows/${itemId}/seasons`)
  return (res.seasons ?? []).map(s => ({
    id: s.key,
    name: s.title,
    seasonNumber: s.seasonNumber,
    episodeCount: s.episodeCount,
  }))
}

export async function getEpisodes(seriesId: string, seasonId: string): Promise<Episode[]> {
  // Backend: GET /jellyfin/seasons/:seasonId/episodes?seriesId=...
  // Returns { success, episodes: [{ id, title, episodeNumber, seasonNumber, playedPercentage }] }
  const res = await request<{
    success: boolean
    episodes: Array<{ id: string; title: string; episodeNumber: number; seasonNumber: number; playedPercentage?: number }>
  }>(`/jellyfin/seasons/${encodeURIComponent(seasonId)}/episodes?seriesId=${encodeURIComponent(seriesId)}`)
  return (res.episodes ?? []).map(ep => ({
    id: ep.id,
    name: ep.title,
    episodeNumber: ep.episodeNumber,
    seasonNumber: ep.seasonNumber,
    overview: '',
    stillUrl: null,
    airDate: null,
    onDemand: true,
    jellyfinId: ep.id,
    playedPercentage: ep.playedPercentage,
  }))
}

export async function checkDigitalRelease(
  tmdbId: number,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<{ isReleased: boolean; releaseDate?: string }> {
  if (type === 'movie') {
    const res = await request<{ success: boolean; isDigitallyReleased: boolean; digitalReleaseDate: string | null }>(
      `/tmdb/movie/${tmdbId}/digital-release`
    )
    return { isReleased: res.isDigitallyReleased, releaseDate: res.digitalReleaseDate ?? undefined }
  }
  const res = await request<{ success: boolean; isDigitallyReleased: boolean; digitalReleaseDate: string | null }>(
    `/tmdb/tv/${tmdbId}/episode-release?season=${season}&episode=${episode}`
  )
  return { isReleased: res.isDigitallyReleased, releaseDate: res.digitalReleaseDate ?? undefined }
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

export async function getWatchlist(): Promise<UnifiedMedia[]> {
  // Backend returns { success: true, items: [...] } — not a bare array
  const res = await request<{ success: boolean; items: UnifiedMedia[] }>('/watchlist')
  return res.items ?? []
}

export async function addToWatchlist(item: UnifiedMedia): Promise<void> {
  await request('/watchlist', {
    method: 'POST',
    body: JSON.stringify(item)
  })
}

export async function removeFromWatchlist(id: string | number): Promise<void> {
  await request(`/watchlist/${id}`, { method: 'DELETE' })
}

// ─── Continue watching ────────────────────────────────────────────────────────

export async function getContinueWatching(): Promise<ProgressItem[]> {
  const res = await request<{ success: boolean; items: ProgressItem[] }>('/user-progress')
  return res.items ?? []
}

/** Save enriched playback progress to the VALOR per-user progress store.
 *  This is what populates "Continue Watching" on both the website and client. */
export async function reportUserProgress(body: {
  mediaId: string
  positionTicks: number
  durationTicks?: number
  title?: string
  posterUrl?: string | null
  type?: string
  year?: number | null
  tmdbId?: number
  overview?: string
  seriesId?: string
  isStopped?: boolean
}): Promise<void> {
  return request('/user-progress', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

/** Jellyfin-native resume items — fallback when the VALOR progress store is empty. */
export async function getJellyfinResume(): Promise<UnifiedMedia[]> {
  const res = await request<{ success: boolean; items: UnifiedMedia[] }>('/jellyfin/resume')
  return (res.items ?? []).map((item) => ({
    ...item,
    source: 'jellyfin' as const,
    onDemand: true,
    seriesId: (item as Record<string, unknown>).seriesId as string | undefined,
  }))
}

// ─── Profile ──────────────────────────────────────────────────────────────────
// Backend has no GET /profile endpoint — /me returns the same user data.

export async function getProfile(): Promise<User> {
  return getMe()
}

export async function updateProfile(data: { email?: string }): Promise<User> {
  const res = await request<{ success: boolean; user: Record<string, unknown> }>('/profile', {
    method: 'PATCH',
    body: JSON.stringify(data)
  })
  return normalizeUser(res.user)
}

export async function uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
  const form = new FormData()
  form.append('avatar', file)
  const res = await request<{ success: boolean; user: Record<string, unknown> }>(
    '/profile/avatar',
    { method: 'POST', body: form }
  )
  return { avatarUrl: resolveAvatarUrl(res.user.avatarUrl as string) ?? '' }
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<User[]> {
  const res = await request<{ success: boolean; users: Array<Record<string, unknown>> }>('/admin/users')
  return (res.users ?? []).map(normalizeUser)
}

export async function createUser(data: {
  username: string
  password: string
  role: string
  email?: string
}): Promise<User> {
  return request('/admin/users', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateUser(id: string, data: Partial<User & { password: string }>): Promise<User> {
  return request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteUser(id: string): Promise<void> {
  return request(`/admin/users/${id}`, { method: 'DELETE' })
}

export async function getDiagnostics(): Promise<Record<string, unknown>> {
  return request('/admin/diagnostics')
}

// ─── Subtitles ────────────────────────────────────────────────────────────────

export interface OsSubtitleResult {
  id: string
  fileId: number | null
  language: string
  name: string
  downloadCount: number
  hearingImpaired: boolean
}

export async function searchSubtitles(params: {
  query?: string
  tmdbId?: number
  language?: string
  type?: 'movie' | 'tv'
}): Promise<OsSubtitleResult[]> {
  const p = new URLSearchParams()
  if (params.query) p.set('query', params.query)
  if (params.tmdbId != null) p.set('tmdbId', String(params.tmdbId))
  if (params.language) p.set('language', params.language)
  if (params.type) p.set('type', params.type)
  const res = await request<{ success: boolean; subtitles: OsSubtitleResult[] }>(
    `/subtitle/opensubtitles/search?${p}`
  )
  return res.subtitles ?? []
}

/** Downloads a subtitle by file_id and returns the raw WebVTT text. */
export async function downloadSubtitle(fileId: number | string, language = 'en'): Promise<string> {
  return request<string>('/subtitle/opensubtitles/download', {
    method: 'POST',
    body: JSON.stringify({ fileId: Number(fileId), language })
  })
}

// ─── Playback state ───────────────────────────────────────────────────────────

export async function markItemPlayed(itemId: string): Promise<void> {
  return request(`/jellyfin/item-played/${encodeURIComponent(itemId)}`, { method: 'POST' })
}

export async function markItemUnplayed(itemId: string): Promise<void> {
  return request(`/jellyfin/item-played/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
}

// ─── P2P ─────────────────────────────────────────────────────────────────────

export async function startP2P(body: {
  query?: string
  title?: string
  year?: number
  type?: string
  magnetUri?: string
}): Promise<{ infoHash: string }> {
  return request('/p2p/start', { method: 'POST', body: JSON.stringify(body) })
}

export async function getP2PStatus(infoHash: string): Promise<P2PStatus> {
  return request(`/p2p/status/${infoHash}`)
}

export async function cancelP2P(infoHash: string): Promise<void> {
  return request(`/p2p/cancel/${infoHash}`, { method: 'POST' })
}

// ─── TMDB seasons / episodes ─────────────────────────────────────────────────

export interface TmdbSeason {
  seasonNumber: number
  title: string
  key: string
  episodeCount: number
}

export interface TmdbEpisode {
  id: string
  title: string
  episodeNumber: number
  seasonNumber: number
}

export async function getTmdbSeasons(tmdbId: number): Promise<TmdbSeason[]> {
  const res = await request<{ success: boolean; seasons: TmdbSeason[] }>(`/tmdb/tv/${tmdbId}/episodes`)
  return res.seasons ?? []
}

export async function getTmdbEpisodes(tmdbId: number, seasonNumber: number): Promise<TmdbEpisode[]> {
  const res = await request<{ success: boolean; episodes: TmdbEpisode[] }>(
    `/tmdb/tv/${tmdbId}/season/${seasonNumber}/episodes`
  )
  return res.episodes ?? []
}

// ─── Home categories ──────────────────────────────────────────────────────────

export interface HomeCategories {
  topRatedMovies: UnifiedMedia[]
  actionMovies: UnifiedMedia[]
  comedyMovies: UnifiedMedia[]
  topRatedTv: UnifiedMedia[]
  sciFiTv: UnifiedMedia[]
}

export async function getHomeCategories(): Promise<HomeCategories> {
  const res = await request<{ success: boolean } & HomeCategories>('/home/categories')
  return {
    topRatedMovies: res.topRatedMovies ?? [],
    actionMovies: res.actionMovies ?? [],
    comedyMovies: res.comedyMovies ?? [],
    topRatedTv: res.topRatedTv ?? [],
    sciFiTv: res.sciFiTv ?? [],
  }
}

// ─── Pruna (content acquisition) ──────────────────────────────────────────────

export interface PrunaStatus {
  /** True only when state === 'Completed' (item fully installed in library) */
  installed: boolean
  /** Pipeline state label, or null if item not in Pruna at all */
  state: string | null
  prunaId?: string | null
  title?: string
  progress?: number
  error?: string | null
  episodes?: number
}

export async function getPrunaStatus(tmdbId: number, type: 'movie' | 'tv'): Promise<PrunaStatus> {
  return request(`/pruna/status?tmdbId=${tmdbId}&type=${type}`)
}

export async function prunaInstall(body: {
  tmdbId: number; type: 'movie' | 'tv'; title: string; year?: number | null; isAnime?: boolean
}): Promise<{ success: boolean; prunaId: string; state: string }> {
  return request('/pruna/install', { method: 'POST', body: JSON.stringify(body) })
}

export async function prunaRetryByImdb(imdbId: string): Promise<void> {
  return request('/pruna/retry', { method: 'POST', body: JSON.stringify({ imdbId }) })
}

export async function prunaRetryById(prunaId: string): Promise<void> {
  return request('/pruna/retry', { method: 'POST', body: JSON.stringify({ prunaId }) })
}

// ─── Admin: tier management + library scan ────────────────────────────────────

export type UserTier = 'trial' | 'subscription' | 'lifetime' | 'free'

export async function patchUserTier(id: string, tier: UserTier, subscriptionExpiresAt?: string | null): Promise<void> {
  const body: Record<string, unknown> = { tier }
  if (tier === 'subscription' && subscriptionExpiresAt) {
    body.subscriptionExpiresAt = subscriptionExpiresAt
  }
  return request(`/admin/users/${id}/tier`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export async function syncUserAccess(id: string): Promise<void> {
  return request(`/admin/users/${id}/sync-access`, { method: 'POST' })
}

export async function scanLibrary(): Promise<void> {
  return request('/jellyfin/scan-library', { method: 'POST' })
}

// ─── Ombi requests ────────────────────────────────────────────────────────────

export async function requestMedia(item: {
  title: string
  tmdbId?: number
  type: 'movie' | 'tv'
}): Promise<void> {
  return request('/request', { method: 'POST', body: JSON.stringify(item) })
}

// ─── Pruna ────────────────────────────────────────────────────────────────────

export async function getPrunaDashboard(): Promise<Record<string, unknown>> {
  return request('/pruna/dashboard')
}

export async function prunaRetry(prunaId: string): Promise<void> {
  return request('/pruna/dashboard/retry', { method: 'POST', body: JSON.stringify({ prunaId }) })
}

export async function prunaRemove(prunaId: string): Promise<void> {
  return request(`/pruna/dashboard/item/${encodeURIComponent(prunaId)}`, { method: 'DELETE' })
}

export async function getPrunaQueue(): Promise<Record<string, unknown>> {
  return request('/pruna/queue')
}

export async function prunaPromote(prunaId: string): Promise<void> {
  return request('/pruna/queue/promote', { method: 'POST', body: JSON.stringify({ prunaId }) })
}

export async function prunaQueueConfig(maxActive: number): Promise<void> {
  return request('/pruna/queue/config', { method: 'POST', body: JSON.stringify({ maxActive }) })
}

export async function getPrunaLibrary(): Promise<Record<string, unknown>> {
  return request('/pruna/library')
}

export async function prunaDeleteLibraryItem(itemId: string): Promise<void> {
  return request(`/pruna/library/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
}

export async function getPrunaLibraryEpisodes(itemId: string, tmdbId?: number): Promise<Record<string, unknown>> {
  const qs = tmdbId ? `?tmdbId=${tmdbId}` : ''
  return request(`/pruna/library/${encodeURIComponent(itemId)}/episodes${qs}`)
}

export async function prunaSearchEpisodes(itemId: string, body: Record<string, unknown>): Promise<void> {
  return request(`/pruna/library/${encodeURIComponent(itemId)}/episodes`, {
    method: 'POST', body: JSON.stringify(body)
  })
}

export async function prunaSearchTorrents(itemId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request(`/pruna/library/${encodeURIComponent(itemId)}/episodes/torrents`, {
    method: 'POST', body: JSON.stringify(body)
  })
}

export async function prunaInstallMagnet(itemId: string, body: Record<string, unknown>): Promise<void> {
  return request(`/pruna/library/${encodeURIComponent(itemId)}/episodes/install-magnet`, {
    method: 'POST', body: JSON.stringify(body)
  })
}

export async function prunaDeleteEpisode(itemId: string, epKey: string): Promise<void> {
  return request(`/pruna/library/${encodeURIComponent(itemId)}/episode/${encodeURIComponent(epKey)}`, { method: 'DELETE' })
}

export async function prunaRefetchEpisode(itemId: string, epKey: string, mode: string): Promise<void> {
  return request(`/pruna/library/${encodeURIComponent(itemId)}/episode/${encodeURIComponent(epKey)}`, {
    method: 'POST', body: JSON.stringify({ mode })
  })
}

export async function getPrunaOngoing(): Promise<Record<string, unknown>> {
  return request('/pruna/ongoing')
}

export async function prunaTrackOngoing(body: Record<string, unknown>): Promise<void> {
  return request('/pruna/ongoing', { method: 'POST', body: JSON.stringify(body) })
}

export async function prunaRemoveOngoing(imdbId: string): Promise<void> {
  return request(`/pruna/ongoing/${encodeURIComponent(imdbId)}`, { method: 'DELETE' })
}

export async function prunaToggleOngoing(imdbId: string, enabled: boolean): Promise<void> {
  return request(`/pruna/ongoing/${encodeURIComponent(imdbId)}`, {
    method: 'PATCH', body: JSON.stringify({ enabled })
  })
}

export async function prunaCheckOngoing(): Promise<void> {
  return request('/pruna/ongoing/check', { method: 'POST' })
}

export async function prunaClearFailed(): Promise<void> {
  return request('/pruna/dashboard/clear-failed', { method: 'POST' })
}
