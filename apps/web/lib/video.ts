// Video posts, the browser's side (docs/adr/0019, 0021). Pure helpers: the checks
// here are courtesy checks so a member is told before uploading 1 GB; the API
// probes the file and decides for real.

/** The API's own limits, from its settings: /v1/me sends them as `videoLimits`. */
export type VideoLimits = { maxBytes: number; maxSeconds: number; minSeconds: number; maxEdge: number }
/** The ADR's defaults (ADR 0021 section 2), the API's when nothing is set; for tests and anything without /v1/me. */
export const DEFAULT_VIDEO_LIMITS: VideoLimits = { maxBytes: 1024 * 1024 * 1024, maxSeconds: 180, minSeconds: 3, maxEdge: 3840 }
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const

/** A size limit as the API words it: whole MiB, called MB. */
export const limitSize = (bytes: number) => `${Math.floor(bytes / (1024 * 1024))} MB`

/** One quality of a ready video: its short edge, its size, and the bytes of all its pieces. */
export type VideoRendition = { height: number; width: number; bytes: number; playlistUrl: string }

const mmss = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
export const formatDuration = mmss

/** One decimal place, and never "0 MB". */
export const formatSize = (bytes: number) => `${Math.max(0.1, Math.round(bytes / 100_000) / 10).toFixed(1)} MB`

/** Over this, as `formatSize` counts, the composer shows the size and asks before sending (ADR 0021 section 2). */
export const ASK_ABOVE_BYTES = 200_000_000

/**
 * What the composer asks before sending a video, or null to send it at once: a file over
 * 200 MB, and every file for a member saving data.
 */
export function sendingQuestion(bytes: number, saver: boolean): string | null {
  if (saver) return `You are saving data, and this video is ${formatSize(bytes)}. Send it?`
  if (bytes > ASK_ABOVE_BYTES) return `This video is ${formatSize(bytes)}, so sending it uses that much data. Send it?`
  return null
}

/** The rendition for a quality: that one, or the nearest below it, or the smallest there is. */
export function pickRendition(renditions: VideoRendition[], quality: number): VideoRendition | null {
  if (renditions.length === 0) return null
  const sorted = [...renditions].sort((a, b) => a.height - b.height)
  return [...sorted].reverse().find((r) => r.height <= quality) ?? sorted[0]!
}

export type VideoFiles = {
  posterUrl: string
  playlists: { all: string; upTo480: string }
  renditions: VideoRendition[]
}

/**
 * What a reader's player loads, by their data setting (ADR 0021 section 7): saving data, the
 * 240p playlist alone, and its bytes for "Tap to load video, about 1.4 MB"; `auto`, the master
 * playlist up to 480p; `full`, every quality. The URLs are the API's, on the media domain.
 */
export function videoFiles(video: VideoFiles, mode: 'saver' | 'auto' | 'full') {
  const smallest = pickRendition(video.renditions, 240)
  if (!smallest) return { poster: video.posterUrl, playlist: null, bytes: 0 }
  const playlist = mode === 'saver' ? smallest.playlistUrl : mode === 'auto' ? video.playlists.upTo480 : video.playlists.all
  return { poster: video.posterUrl, playlist, bytes: smallest.bytes }
}

const EXTENSIONS = /\.(mp4|m4v|mov|webm)$/i

/**
 * What can be said about a chosen file without sending it. `durationMs` comes from
 * the element's metadata when the browser can read it (it cannot for HEVC on some
 * browsers); unknown is left to the server.
 */
export function checkVideoFile(
  file: { type: string; size: number; name?: string },
  durationMs?: number,
  limits: VideoLimits = DEFAULT_VIDEO_LIMITS,
): string | null {
  const known = (VIDEO_TYPES as readonly string[]).includes(file.type) || (!file.type && EXTENSIONS.test(file.name ?? ''))
  if (!known) return 'Choose an MP4, MOV or WebM video.'
  if (file.size <= 0) return 'That file is empty.'
  if (file.size > limits.maxBytes) return `That video is ${formatSize(file.size)}. The limit is ${limitSize(limits.maxBytes)}.`
  if (durationMs !== undefined && durationMs > limits.maxSeconds * 1000) return `That video is ${mmss(durationMs)} long. The limit is ${limits.maxSeconds} seconds.`
  if (durationMs !== undefined && durationMs < limits.minSeconds * 1000) return `That video is too short. The least is ${limits.minSeconds} seconds.`
  return null
}

/** The usual names of the longest edges a limit is likely to be. */
const PICTURES: Record<number, string> = { 1920: '1080p', 3840: '4K' }

/** What to tell the member when the worker refused their video, by the reason class the API gives. */
export function rejectionText(reason: string | null, limits: VideoLimits = DEFAULT_VIDEO_LIMITS): string {
  switch (reason) {
    case 'too_long':
      return `That video is too long. The limit is ${limits.maxSeconds} seconds.`
    case 'too_short':
      return `That video is too short. The least is ${limits.minSeconds} seconds.`
    case 'too_large':
      return `That video is too large. The limit is ${limitSize(limits.maxBytes)}.`
    case 'too_big_picture':
      return `That video is bigger than ${PICTURES[limits.maxEdge] ?? `${limits.maxEdge} pixels on its longer side`}. Record it at a lower quality.`
    case 'not_a_video':
      return 'That file could not be read as a video.'
    default:
      return 'That video could not be used.'
  }
}
