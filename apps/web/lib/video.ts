// Video posts, the browser's side (docs/adr/0019). Pure helpers: the checks here
// are courtesy checks so a member is told before uploading 100 MB; the API
// probes the file and decides for real.

/** The API's own limits, from its settings: /v1/me sends them as `videoLimits`. */
export type VideoLimits = { maxBytes: number; maxSeconds: number; minSeconds: number; maxEdge: number }
/** The ADR's defaults, the API's when nothing is set; for tests and anything without /v1/me. */
export const DEFAULT_VIDEO_LIMITS: VideoLimits = { maxBytes: 100 * 1024 * 1024, maxSeconds: 60, minSeconds: 3, maxEdge: 1920 }
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const

/** A size limit as the API words it: whole MiB, called MB. */
export const limitSize = (bytes: number) => `${Math.floor(bytes / (1024 * 1024))} MB`

export type VideoRendition = { height: number; width: number; bytes: number }

const mmss = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
export const formatDuration = mmss

/** One decimal place, and never "0 MB". */
export const formatSize = (bytes: number) => `${Math.max(0.1, Math.round(bytes / 100_000) / 10).toFixed(1)} MB`

/** The rendition for a quality: that one, or the nearest below it, or the smallest there is. */
export function pickRendition(renditions: VideoRendition[], quality: number): VideoRendition | null {
  if (renditions.length === 0) return null
  const sorted = [...renditions].sort((a, b) => a.height - b.height)
  return [...sorted].reverse().find((r) => r.height <= quality) ?? sorted[0]!
}

/**
 * The poster and the MP4 for a quality. `src` is the API's path (`/media/videos/<id>`);
 * with an `origin` (the media bucket's own domain, where video must be served from:
 * ADR 0019 section 3.3) the files are at `<origin>/videos/<id>/...`.
 */
export function videoFiles(src: string, renditions: VideoRendition[], quality: number, origin = '') {
  const base = origin ? `${origin}${src.replace(/^\/media/, '')}` : src
  const picked = pickRendition(renditions, quality)
  return { poster: `${base}/poster.webp`, file: picked ? `${base}/${picked.height}.mp4` : null, bytes: picked?.bytes ?? 0 }
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
      return `That video is bigger than ${limits.maxEdge === 1920 ? '1080p' : `${limits.maxEdge} pixels on its longer side`}. Record it at a lower quality.`
    case 'not_a_video':
      return 'That file could not be read as a video.'
    default:
      return 'That video could not be used.'
  }
}
