import type {
  UnifiedMedia,
  PlayJob,
  Season,
  Episode,
  User,
  ProgressItem,
  TrendingResponse,
  AudioTrack,
  SubtitleTrack,
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
  /** Previous session IDs — sent when switching audio/quality/subs mid-playback so the
   *  backend can explicitly kill the old FFmpeg before starting a new transcode. */
  previousPlaySessionId?: string
  previousDeviceId?: string
  /** Client-known TMDB ID — overrides Jellyfin's ProviderIds.Tmdb which can be wrong
   *  after auto-identify. Used for subtitle search + progress reporting. */
  tmdbId?: number
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
  playSessionId: string | null
  isStopped?: boolean
  seriesId?: string
  // TMDB metadata — when present, backend saves to progress store in the same call
  title?: string
  posterUrl?: string | null
  type?: string
  year?: number | null
  tmdbId?: number
  seasonNumber?: number | null
  episodeNumber?: number | null
  episodeName?: string | null
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

// ─── Playback context (skip-segments + Up Next) ───────────────────────────────

export interface PlaybackContext {
  success: boolean
  introStartSec: number | null
  introEndSec: number | null
  creditsStartSec: number | null
  source: 'aniskip' | 'tidb' | 'default' | null
  isDefault: boolean
  nextEpisode: {
    seasonNumber: number
    episodeNumber: number
    title: string
  } | null
}

export interface PlaybackContextRequest {
  tmdbId: number
  type: 'tv' | 'movie'
  /** Required for TV. Omit for movies. */
  season?: number
  /** Required for TV. Omit for movies. */
  episode?: number
  /** Enables Aniskip lookup for the intro/credits markers. */
  isAnime?: boolean
  /** Total media length in seconds — lets the server fall back to a smart
   *  default for creditsStartSec when the API misses. */
  duration?: number
}

/** Fetch intro/credits markers + next episode in one call. Cache per-episode in memory. */
export async function getPlaybackContext(req: PlaybackContextRequest): Promise<PlaybackContext> {
  const params = new URLSearchParams()
  params.set('tmdbId', String(req.tmdbId))
  params.set('type', req.type)
  if (req.season != null) params.set('season', String(req.season))
  if (req.episode != null) params.set('episode', String(req.episode))
  if (req.isAnime) params.set('isAnime', '1')
  if (req.duration != null && req.duration > 0) params.set('duration', String(Math.floor(req.duration)))
  return request(`/playback-context?${params.toString()}`)
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
  // Backend returns { success, seasons: [{ key, seasonNumber, canonicalSeasonNumber?, title, episodeCount }] }
  const res = await request<{
    success: boolean
    seasons: Array<{
      key: string
      seasonNumber: number
      canonicalSeasonNumber?: number
      title: string
      episodeCount: number
    }>
  }>(`/jellyfin/shows/${itemId}/seasons`)
  return (res.seasons ?? []).map(s => ({
    id: s.key,
    name: s.title,
    seasonNumber: s.seasonNumber,
    canonicalSeasonNumber: s.canonicalSeasonNumber,
    episodeCount: s.episodeCount,
  }))
}

export async function getEpisodes(seriesId: string, seasonId: string): Promise<Episode[]> {
  // Backend: GET /jellyfin/seasons/:seasonId/episodes?seriesId=...
  // Returns { success, episodes: [{ id, title, episodeNumber, seasonNumber,
  //   canonicalSeasonNumber?, canonicalEpisodeNumber?, playedPercentage }] }
  const res = await request<{
    success: boolean
    episodes: Array<{
      id: string
      title: string
      episodeNumber: number
      seasonNumber: number
      canonicalSeasonNumber?: number
      canonicalEpisodeNumber?: number
      playedPercentage?: number
    }>
  }>(`/jellyfin/seasons/${encodeURIComponent(seasonId)}/episodes?seriesId=${encodeURIComponent(seriesId)}`)
  return (res.episodes ?? []).map(ep => ({
    id: ep.id,
    name: ep.title,
    episodeNumber: ep.episodeNumber,
    seasonNumber: ep.seasonNumber,
    canonicalSeasonNumber: ep.canonicalSeasonNumber,
    canonicalEpisodeNumber: ep.canonicalEpisodeNumber,
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

export interface TmdbDetail {
  overview: string | null
  backdropUrl: string | null
  posterUrl: string | null
  year: number | null
  title: string | null
  rating: number | null
  genres: { id: number; name: string }[]
}

export async function getTmdbDetail(tmdbId: number, type: 'movie' | 'tv'): Promise<TmdbDetail> {
  return request<TmdbDetail>(`/tmdb/detail/${type}/${tmdbId}`)
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



/** Remove an item from Continue Watching. Works with mediaId, seriesId, or resumeMediaId. */
export async function deleteUserProgress(mediaId: string): Promise<void> {
  return request(`/user-progress/${encodeURIComponent(mediaId)}`, { method: 'DELETE' })
}

/** Check if a specific item has saved progress (for resume prompt). */
export async function getUserProgress(
  mediaId: string
): Promise<{ positionTicks: number; durationTicks: number; percent: number } | null> {
  const res = await request<{ success: boolean; progress: { positionTicks: number; durationTicks: number; percent: number } | null }>(
    `/user-progress/${encodeURIComponent(mediaId)}`
  )
  return res.progress ?? null
}

/** Jellyfin-native resume items — fallback when the VALOR progress store is empty. */
export async function getJellyfinResume(): Promise<UnifiedMedia[]> {
  const res = await request<{ success: boolean; items: UnifiedMedia[] }>('/jellyfin/resume')
  return (res.items ?? []).map((item) => ({
    ...item,
    source: 'jellyfin' as const,
    onDemand: true,
    seriesId: (item as unknown as Record<string, unknown>).seriesId as string | undefined,
  }))
}

/** Get list of watched episode keys for a series (e.g. ["S1E1", "S1E3"]) */
export async function getWatchedEpisodes(tmdbId: number): Promise<string[]> {
  const res = await request<{ success: boolean; episodes: string[] }>(
    `/user-progress/watched-episodes/${tmdbId}`
  )
  return res.episodes ?? []
}

/** Mark episodes as watched */
export async function addWatchedEpisodes(tmdbId: number, episodes: string[]): Promise<void> {
  await request(`/user-progress/watched-episodes/${tmdbId}`, {
    method: 'POST',
    body: JSON.stringify({ episodes }),
  })
}

/** Remove episodes from watched */
export async function removeWatchedEpisodes(tmdbId: number, episodes: string[]): Promise<void> {
  await request(`/user-progress/watched-episodes/${tmdbId}`, {
    method: 'DELETE',
    body: JSON.stringify({ episodes }),
  })
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

// ─── Collections & Discover ──────────────────────────────────────────────

export interface CollectionSummary {
  id: string
  name: string
  tmdbCollectionId: number | null
  itemCount: number
  posterUrl: string | null
}

export interface CollectionDetail {
  name: string
  overview: string
  posterUrl: string | null
  backdropUrl: string | null
  items: UnifiedMedia[]
}

export async function getCollections(): Promise<CollectionSummary[]> {
  const res = await request<{ success: boolean; collections: CollectionSummary[] }>('/jellyfin/collections')
  return res.collections ?? []
}

export async function getCollection(tmdbId: number): Promise<CollectionDetail> {
  return request(`/tmdb/collection/${tmdbId}`)
}

export async function discoverByProvider(
  type: 'movie' | 'tv',
  providerId: number,
  page = 1
): Promise<{ results: UnifiedMedia[]; totalPages: number }> {
  const res = await request<{ success: boolean; items: UnifiedMedia[]; totalPages: number }>(
    `/tmdb/discover/${type}?provider=${providerId}&page=${page}&region=GB`
  )
  return { results: res.items ?? [], totalPages: res.totalPages ?? 1 }
}

// ─── Admin: playback stats & symlink health ─────────────────────────────

export interface PlaybackStatsUser {
  username: string
  totalPlays: number
  activeDays: number
  avgPlaysPerDay: number
}

export interface PlaybackStats {
  users: PlaybackStatsUser[]
  hourlyDistribution: number[]
  totalPlays: number
  uniqueUsers: number
}

export async function getPlaybackStats(days = 30): Promise<PlaybackStats> {
  return request(`/admin/playback-stats?days=${days}`)
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
  season?: number
  episode?: number
}): Promise<OsSubtitleResult[]> {
  const p = new URLSearchParams()
  if (params.query) p.set('query', params.query)
  if (params.tmdbId != null) p.set('tmdbId', String(params.tmdbId))
  if (params.language) p.set('language', params.language)
  if (params.type) p.set('type', params.type)
  if (params.season != null) p.set('season', String(params.season))
  if (params.episode != null) p.set('episode', String(params.episode))
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


// ─── TMDB seasons / episodes ─────────────────────────────────────────────────

export interface TmdbSeason {
  seasonNumber: number
  /** TMDB-canonical season number — backend uses anime episode groups etc. to
   *  remap displayed season numbers onto canonical ones. May equal seasonNumber. */
  canonicalSeasonNumber?: number
  title: string
  key: string
  episodeCount: number
}

export interface TmdbEpisode {
  id: string
  title: string
  episodeNumber: number
  seasonNumber: number
  /** TMDB-canonical season/episode (anime-group remapped). Sent verbatim to
   *  POST /stream/play as canonicalSeason/canonicalEpisode so the backend can
   *  resolve the correct upstream source. */
  canonicalSeasonNumber?: number
  canonicalEpisodeNumber?: number
  airDate: string | null
  /** Exact UTC timestamp when episode becomes available (from TVDB air time resolution) */
  availableAt?: string | null
  overview?: string | null
  stillUrl?: string | null
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

// ─── Browse / filter ──────────────────────────────────────────────────────────

export interface BrowseParams {
  type: 'movie' | 'tv'
  genres?: string
  rating?: number
  anime?: boolean
  year?: string
  language?: string
  sort?: 'popularity' | 'rating' | 'newest' | 'title'
  page?: number
}

export interface BrowseResponse {
  items: UnifiedMedia[]
  page: number
  totalPages: number
  totalResults: number
}

export async function browse(params: BrowseParams): Promise<BrowseResponse> {
  const p = new URLSearchParams()
  if (params.genres) p.set('genres', params.genres)
  if (params.rating) p.set('rating', String(params.rating))
  if (params.anime) p.set('anime', '1')
  if (params.year) p.set('year', params.year)
  if (params.language) p.set('language', params.language)
  if (params.sort) p.set('sort', params.sort)
  if (params.page && params.page > 1) p.set('page', String(params.page))
  const qs = p.toString()
  const res = await request<{ success: boolean } & BrowseResponse>(`/browse/${params.type}${qs ? '?' + qs : ''}`)
  return { items: res.items ?? [], page: res.page ?? 1, totalPages: res.totalPages ?? 1, totalResults: res.totalResults ?? 0 }
}

// ─── Home categories ──────────────────────────────────────────────────────────

export interface HomeCategories {
  // Movies
  topRatedMovies: UnifiedMedia[]
  actionMovies: UnifiedMedia[]
  comedyMovies: UnifiedMedia[]
  horrorMovies: UnifiedMedia[]
  thrillerMovies: UnifiedMedia[]
  dramaMovies: UnifiedMedia[]
  romanceMovies: UnifiedMedia[]
  animationMovies: UnifiedMedia[]
  nowPlayingMovies: UnifiedMedia[]
  upcomingMovies: UnifiedMedia[]
  documentaryMovies: UnifiedMedia[]
  familyMovies: UnifiedMedia[]
  warMovies: UnifiedMedia[]
  // TV
  topRatedTv: UnifiedMedia[]
  sciFiTv: UnifiedMedia[]
  dramaTv: UnifiedMedia[]
  crimeTv: UnifiedMedia[]
  comedyTv: UnifiedMedia[]
  actionAdventureTv: UnifiedMedia[]
  mysteryTv: UnifiedMedia[]
  animationTv: UnifiedMedia[]
  documentaryTv: UnifiedMedia[]
  realityTv: UnifiedMedia[]
}

export async function getHomeCategories(): Promise<HomeCategories> {
  const res = await request<{ success: boolean } & Partial<HomeCategories>>('/home/categories')
  return {
    topRatedMovies: res.topRatedMovies ?? [],
    actionMovies: res.actionMovies ?? [],
    comedyMovies: res.comedyMovies ?? [],
    horrorMovies: res.horrorMovies ?? [],
    thrillerMovies: res.thrillerMovies ?? [],
    dramaMovies: res.dramaMovies ?? [],
    romanceMovies: res.romanceMovies ?? [],
    animationMovies: res.animationMovies ?? [],
    nowPlayingMovies: res.nowPlayingMovies ?? [],
    upcomingMovies: res.upcomingMovies ?? [],
    documentaryMovies: res.documentaryMovies ?? [],
    familyMovies: res.familyMovies ?? [],
    warMovies: res.warMovies ?? [],
    topRatedTv: res.topRatedTv ?? [],
    sciFiTv: res.sciFiTv ?? [],
    dramaTv: res.dramaTv ?? [],
    crimeTv: res.crimeTv ?? [],
    comedyTv: res.comedyTv ?? [],
    actionAdventureTv: res.actionAdventureTv ?? [],
    mysteryTv: res.mysteryTv ?? [],
    animationTv: res.animationTv ?? [],
    documentaryTv: res.documentaryTv ?? [],
    realityTv: res.realityTv ?? [],
  }
}

// ─── On-demand streaming ──────────────────────────────────────────────────────

export interface StreamPlayRequest {
  tmdbId: number
  type: 'movie' | 'tv'
  title: string
  year?: number
  season?: number
  episode?: number
  /** TMDB-canonical season number — sent when the user-facing season number
   *  differs from TMDB canonical (e.g. anime absolute numbering). Backend uses
   *  it to resolve the correct upstream source. */
  canonicalSeason?: number
  /** TMDB-canonical episode number, paired with canonicalSeason. */
  canonicalEpisode?: number
  imdbId?: string
  isAnime?: boolean
}

export interface StreamStatus {
  success: boolean
  streamId: string
  phase: string
  message: string
  // PlayJob fields present when phase === 'ready'
  jellyfinItemId?: string
  itemId?: string
  hlsUrl?: string
  playSessionId?: string
  deviceId?: string
  audioTracks?: AudioTrack[]
  subtitleTracks?: SubtitleTrack[]
  sourceVideoWidth?: number
  sourceVideoHeight?: number
  title?: string
  seriesName?: string
  type?: string
  durationTicks?: number
  creditsStartSec?: number | null
  introStartSec?: number | null
  introEndSec?: number | null
  directStreamUrl?: string
  mpvOptions?: Record<string, string>
  seasonNumber?: number | null
  episodeNumber?: number | null
  episodeName?: string | null
  error?: string
}

export async function startStream(body: StreamPlayRequest): Promise<{ streamId: string }> {
  return request('/stream/play', { method: 'POST', body: JSON.stringify(body) })
}

export async function getStreamStatus(streamId: string): Promise<StreamStatus> {
  return request(`/stream/play/${encodeURIComponent(streamId)}`)
}

// ─── Admin: tier management ───────────────────────────────────────────────────

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
