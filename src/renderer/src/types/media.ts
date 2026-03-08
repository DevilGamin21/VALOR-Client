export interface UnifiedMedia {
  id: string | number
  title: string
  type: 'movie' | 'tv'
  posterUrl: string | null
  backdropUrl: string | null
  overview: string
  year: number | null
  tmdbId?: number
  onDemand: boolean
  source: 'jellyfin' | 'tmdb'
  playedPercentage?: number
  positionTicks?: number
  /** True for items from premium Jellyfin libraries (z-prefixed). */
  premiumOnly?: boolean
  /** True when the item is from an anime library. */
  isAnime?: boolean
  /** Jellyfin series ID — set on TV episodes from Continue Watching / Resume. */
  seriesId?: string
  /** Actual episode ID to resume — set when the store key is a seriesId. */
  resumeMediaId?: string | null
  /** Episode name from progress store (TV only). */
  episodeName?: string | null
  /** Season number from progress store (TV only). */
  seasonNumber?: number | null
  /** Episode number from progress store (TV only). */
  episodeNumber?: number | null
}

export interface AudioTrack {
  index: number
  label: string
  language: string
  codec: string
  channels: number
  isDefault: boolean
  /** mpv's 1-based audio track ID — set only for direct play jobs */
  mpvAid?: number
}

export interface SubtitleTrack {
  index: number
  label: string
  language: string
  codec: string
  isImageBased: boolean
  /** VTT URL path — backend sends this as `url`, aliased here for compat. */
  vttUrl: string | null
  url?: string | null
  /** mpv's 1-based subtitle track ID — set only for direct play jobs */
  mpvSid?: number
}

export interface PlayJob {
  itemId: string
  hlsUrl: string
  /** Set for direct play (no server transcoding). When present, mpv plays this URL
   *  and track switching is done via native mpv aid/sid commands. */
  directStreamUrl?: string
  playSessionId: string | null
  deviceId?: string
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
  title: string
  /** Series name for TV episodes (e.g. "The Pitt"). Empty string for movies. */
  seriesName?: string
  type: string
  /** Media duration from Jellyfin (ticks). Used as fallback when video.duration is Infinity. */
  durationTicks?: number
  /** Poster image URL — used for Discord Rich Presence large image. */
  posterUrl?: string | null
  /** Jellyfin series ID for TV episodes — used for progress reporting. */
  seriesId?: string
  /** TMDB ID — used for progress reporting. */
  tmdbId?: number
}

export interface Season {
  id: string
  name: string
  seasonNumber: number
  episodeCount: number
}

export interface Episode {
  id: string
  name: string
  episodeNumber: number
  seasonNumber: number
  overview: string
  stillUrl: string | null
  airDate: string | null
  onDemand: boolean
  jellyfinId?: string
  playedPercentage?: number
}

export interface User {
  id: string
  username: string
  email: string
  role: 'admin' | 'user'
  avatarUrl?: string
  tier?: 'trial' | 'subscription' | 'lifetime' | 'free'
  subscriptionExpiresAt?: string | null
  trialStartedAt?: string | null
  jellyfinUserId?: string | null
  isPremium?: boolean
}

export interface ProgressItem {
  mediaId: string
  resumeMediaId?: string | null
  positionTicks: number
  durationTicks: number
  percent: number
  title: string
  posterUrl: string | null
  type: string
  year: number | null
  tmdbId?: number
  seriesId?: string
  episodeName?: string | null
  seasonNumber?: number | null
  episodeNumber?: number | null
  updatedAt: string
}

export interface TrendingResponse {
  movies: UnifiedMedia[]
  tv: UnifiedMedia[]
  hero: UnifiedMedia | null
}

export interface EpisodeInfo {
  jellyfinId: string
  title: string
  episodeNumber: number
  seasonNumber: number
}

export interface P2PStatus {
  infoHash: string
  title: string
  progress: number
  downloadSpeed: number
  bufferPercent: number
  eta: number
  ready: boolean
  jellyfinItemId?: string
  channelId?: number
}
