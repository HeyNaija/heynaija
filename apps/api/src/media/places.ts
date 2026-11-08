import type { Bucket } from './object-store.js'

/**
 * The three places a published file can be, by its key (such as
 * `posts/<id>/640.webp` or `videos/<id>/hls/240/piece-000.m4s`):
 *
 * - `public`: the media bucket, read by anyone, cached by Cloudflare for a year;
 * - `private`: the uploads bucket under `sensitive/`, for a post marked sensitive
 *   (ADR 0025), read only through a signed URL the API gives viewers allowed to
 *   see the post;
 * - `quarantine`: the uploads bucket under `quarantine/`, what moderators took
 *   down, kept as evidence and never served.
 *
 * No lifecycle rule may touch `sensitive/` or `quarantine/`
 * (docs/deployment/cloudflare-r2.md).
 */
export type Place = 'public' | 'private' | 'quarantine'

export const SENSITIVE_PREFIX = 'sensitive/'

/** The bucket and key a published file has in `place`. */
export const placed = (place: Place, key: string): readonly [Bucket, string] =>
  place === 'public' ? ['media', key] : place === 'private' ? ['uploads', `${SENSITIVE_PREFIX}${key}`] : ['uploads', `quarantine/${key}`]

/** Where a ready post's files belong: in private while it is marked sensitive. */
export const placeFor = (marked: boolean): Place => (marked ? 'private' : 'public')
