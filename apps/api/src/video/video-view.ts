import { type SQL, sql } from 'drizzle-orm'
import type { MediaUrls } from '../media/media-urls.js'
import { master480Key, masterKey, playlistKey, posterKey } from './video-keys.js'

/**
 * A ready video as readers get it in a post (ADR 0021 section 9). Every URL is absolute on
 * the media domain (`filesBase` in the video config), where Cloudflare's terms allow video;
 * a marked post's are signed, on the site, and short-lived (ADR 0025).
 */
export type PostVideo = {
  id: string
  durationMs: number
  width: number
  height: number
  posterUrl: string
  /** Master playlists: every quality, and 240p to 480p for the `auto` data setting (ADR 0021 section 7). */
  playlists: { all: string; upTo480: string }
  /** The author's description, for screen readers and shown under the player. */
  description: string
  /** Smallest first. `height` is the quality's short edge (240, 360, 480, 720); `bytes` counts its pieces. */
  renditions: { height: number; width: number; bytes: number; playlistUrl: string }[]
}

export type VideoRow = {
  id: string
  alt: string
  /** Its files are in the private place (ADR 0025). */
  servedPrivately: boolean
  durationMs: number
  width: number
  height: number
  renditions: { height: number; width: number; bytes: number }[]
}

/** A post's ready video, as JSON, for any query with `posts` in scope; null when there is none. */
export const videoOf = (postId: SQL) =>
  sql<VideoRow | null>`(select json_build_object('id', m.id, 'alt', m.alt, 'servedPrivately', m.served_privately, 'durationMs', d.duration_ms, 'width', d.width, 'height', d.height,
      'renditions', coalesce((select json_agg(json_build_object('height', r.height, 'width', r.width, 'bytes', r.bytes) order by r.height)
        from video_renditions r where r.media_id = m.id), '[]'::json))
    from media m join video_details d on d.media_id = m.id
    where m.post_id = ${postId} and m.kind = 'post_video' and m.status = 'ready' limit 1)`

/** Only ever for a viewer who may see the post: a marked one's URLs are signed for them. */
export const toPostVideo = (row: VideoRow | null, urls: MediaUrls): PostVideo | null => {
  if (!row) return null
  const base = urls.videoBase(row.id, row.servedPrivately)
  const url = (key: string) => `${base}/${key}`
  return {
    id: row.id,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    posterUrl: url(posterKey(row.id)),
    playlists: { all: url(masterKey(row.id)), upTo480: url(master480Key(row.id)) },
    description: row.alt,
    renditions: row.renditions.map((r) => ({ ...r, playlistUrl: url(playlistKey(row.id, r.height)) })),
  }
}
