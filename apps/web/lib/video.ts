// Video posts, the browser's side (docs/adr/0019). Pure helpers: the limits here
// are courtesy checks so a member is told before uploading 100 MB; the API
// probes the file and decides for real.

export const VIDEO_LIMITS = { maxBytes: 100 * 1024 * 1024, maxSeconds: 60, minSeconds: 3 } as const
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const

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
export function checkVideoFile(file: { type: string; size: number; name?: string }, durationMs?: number): string | null {
  const known = (VIDEO_TYPES as readonly string[]).includes(file.type) || (!file.type && EXTENSIONS.test(file.name ?? ''))
  if (!known) return 'Choose an MP4, MOV or WebM video.'
  if (file.size <= 0) return 'That file is empty.'
  if (file.size > VIDEO_LIMITS.maxBytes) return `That video is ${formatSize(file.size)}. The limit is 100 MB.`
  if (durationMs !== undefined && durationMs > VIDEO_LIMITS.maxSeconds * 1000) return `That video is ${mmss(durationMs)} long. The limit is ${VIDEO_LIMITS.maxSeconds} seconds.`
  if (durationMs !== undefined && durationMs < VIDEO_LIMITS.minSeconds * 1000) return `That video is too short. The least is ${VIDEO_LIMITS.minSeconds} seconds.`
  return null
}
