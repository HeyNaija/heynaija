import { type SQL, sql } from 'drizzle-orm'
import { videoPath } from './video-keys.js'

/** A ready video as readers get it in a post (ADR 0019 section 7). */
export type PostVideo = {
  id: string
  /** Path without the file name: `/poster.webp` and `/<height>.mp4` go on the end. */
  src: string
  durationMs: number
  width: number
  height: number
  /** The author's description, for screen readers and shown under the player. */
  description: string
  /** Smallest first. `height` is the rendition's short edge (240, 360, 480). */
  renditions: { height: number; width: number; bytes: number }[]
}

type VideoRow = {
  id: string
  alt: string
  durationMs: number
  width: number
  height: number
  renditions: { height: number; width: number; bytes: number }[]
}

/** A post's ready video, as JSON, for any query with `posts` in scope; null when there is none. */
export const videoOf = (postId: SQL) =>
  sql<VideoRow | null>`(select json_build_object('id', m.id, 'alt', m.alt, 'durationMs', d.duration_ms, 'width', d.width, 'height', d.height,
      'renditions', coalesce((select json_agg(json_build_object('height', r.height, 'width', r.width, 'bytes', r.bytes) order by r.height)
        from video_renditions r where r.media_id = m.id), '[]'::json))
    from media m join video_details d on d.media_id = m.id
    where m.post_id = ${postId} and m.kind = 'post_video' and m.status = 'ready' limit 1)`

export const toPostVideo = (row: VideoRow | null): PostVideo | null =>
  row ? { id: row.id, src: videoPath(row.id), durationMs: row.durationMs, width: row.width, height: row.height, description: row.alt, renditions: row.renditions } : null
