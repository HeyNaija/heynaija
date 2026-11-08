import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { postImagePath } from './media.service.js'

export const MEDIA_URLS = Symbol('MEDIA_URLS')

/**
 * Signed URLs for the files of posts marked sensitive (ADR 0025). Those files are
 * in the private bucket (`private` in places.ts), so the only way to them is a URL
 * the API makes for a viewer who has just passed the post's own check
 * (`adultContentAllowed`): every read path that hands out a marked post's
 * pictures or video builds them here, and nothing else does.
 *
 * A URL names one media item's folder, when it stops working, and an HMAC of
 * both: `/api/v1/media/private/<expiry>/<signature>/posts/<id>/640.webp`. The
 * signature covers the folder, not the file, so the size suffixes the apps add
 * and the relative paths inside an HLS playlist all work under it. The API checks
 * it without the database (`PrivateMediaController`).
 */

const HOUR_MS = 3_600_000

/** The folders a signed URL can open: the first part of their files' keys. */
export const PRIVATE_FOLDERS = ['posts', 'videos'] as const
export type PrivateFolder = (typeof PRIVATE_FOLDERS)[number]

/** Where the API serves private files, on the site's own address (the web app proxies /api/v1 to the API). */
export const PRIVATE_PATH = '/api/v1/media/private'

export type UrlWindow = { signedAt: Date; expiresAt: Date }

/**
 * How long a URL made at `now` works: from the start of this hour to the end of
 * the next, so one to two hours. Everyone is given the same URL for a file
 * within an hour, so a browser's copy serves every page that shows it.
 */
export const urlWindow = (now: number): UrlWindow => {
  const start = Math.floor(now / HOUR_MS) * HOUR_MS
  return { signedAt: new Date(start), expiresAt: new Date(start + 2 * HOUR_MS) }
}

export class MediaUrls {
  private readonly key: Buffer

  constructor(
    /** A secret only the API holds (S3_SECRET_ACCESS_KEY); the signing key is derived from it. */
    secret: string,
    /** The site's address (WEB_PUBLIC_URL) for video, whose URLs are absolute; '' gives paths. */
    private readonly site: string,
    /** Where public video files are fetched from (`VideoConfig.filesBase`). */
    private readonly filesBase: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createHmac('sha256', secret).update('heynaija private media urls').digest()
  }

  /** The window the URLs made now work in. */
  window(): UrlWindow {
    return urlWindow(this.now())
  }

  /** A post image's path without the size suffix: the apps append `/640.webp`, `/1600.webp` or `/still.webp`. */
  postImage(id: string, privately: boolean): string {
    return privately ? `${this.signed('posts', id)}/posts/${id}` : postImagePath(id)
  }

  /** Where a video's files are fetched from, ending without a slash; a file's URL is this, `/` and its key. */
  videoBase(id: string, privately: boolean): string {
    return privately ? `${this.site}${this.signed('videos', id)}` : this.filesBase
  }

  /** True when `expiry` and `signature` from a URL were made here for this media item and have not run out. */
  verify(expiry: string, signature: string, folder: PrivateFolder, id: string): boolean {
    if (!/^\d{1,12}$/.test(expiry)) return false
    const until = Number(expiry)
    if (until * 1000 <= this.now()) return false
    const expected = Buffer.from(this.signature(folder, id, until))
    const given = Buffer.from(signature)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  private signed(folder: PrivateFolder, id: string): string {
    const until = Math.floor(this.window().expiresAt.getTime() / 1000)
    return `${PRIVATE_PATH}/${until}/${this.signature(folder, id, until)}`
  }

  private signature(folder: PrivateFolder, id: string, until: number): string {
    return createHmac('sha256', this.key).update(`${folder}/${id}/${until}`).digest('base64url')
  }
}

/** For services built without one (tests): a secret nobody else has, so its URLs work in this process only. */
export const localMediaUrls = (filesBase: string): MediaUrls => new MediaUrls(randomBytes(32).toString('hex'), '', filesBase)

const FILE_NAME = /^[\w-]+(\.[\w-]+)*$/

/**
 * A quality's HLS playlist with every file it names (the init segment in
 * `#EXT-X-MAP` and each piece) replaced by `sign(name)`, a short-lived URL
 * straight to storage: a player resolves those itself, so they cannot carry the
 * folder's signature the way the master playlist's relative lines do. Names are
 * plain file names beside the playlist, as the worker writes them; anything else
 * throws.
 */
export async function signPlaylist(text: string, sign: (name: string) => Promise<string>): Promise<string> {
  const named = (name: string) => {
    if (!FILE_NAME.test(name)) throw new Error(`unexpected file in a playlist: ${name}`)
    return sign(name)
  }
  const lines = await Promise.all(
    text.split('\n').map(async (raw) => {
      const line = raw.trim()
      const map = /^(#EXT-X-MAP:.*URI=")([^"]*)(".*)$/.exec(line)
      if (map) return `${map[1]}${await named(map[2]!)}${map[3]}`
      if (line === '' || line.startsWith('#')) return line
      return named(line)
    }),
  )
  return lines.join('\n')
}
