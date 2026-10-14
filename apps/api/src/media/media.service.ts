import { type Db, media, members } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm'
import sharp from 'sharp'
import { DB } from '../tokens.js'
import type { ObjectStore } from './object-store.js'

export const OBJECT_STORE = Symbol('OBJECT_STORE')
export const MEDIA_JOBS = Symbol('MEDIA_JOBS')

/** What the media service needs from the job queue: somewhere to send work. */
export interface MediaJobs {
  /** Queues an uploaded post image for checking and re-encoding. Safe to repeat. */
  processPostImage(mediaId: string): Promise<void>
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
/** Square sizes we keep: one for lists and posts, one for the profile header. */
export const AVATAR_SIZES = [96, 256] as const

export const POST_IMAGE_MAX_BYTES = 10 * 1024 * 1024
/** Longest-edge limits we keep: one for feeds, one for viewing the image on its own. */
export const POST_IMAGE_SIZES = [640, 1600] as const
export const POST_IMAGES_MAX = 4
export const ALT_MAX = 1000

// Refuse absurd dimensions before decoding: a tiny file can describe a huge image.
const MAX_PIXELS = 40_000_000
// Uploads nobody finished, and post images never attached to a post, are cleared after this.
const ABANDONED_AFTER_MS = 60 * 60 * 1000

export class MediaError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_uploaded' | 'too_large' | 'not_an_image',
    message: string,
  ) {
    super(message)
  }
}

type Kind = 'avatar' | 'post_image'

const folder: Record<Kind, string> = { avatar: 'avatars', post_image: 'posts' }
const sizes: Record<Kind, readonly number[]> = { avatar: AVATAR_SIZES, post_image: POST_IMAGE_SIZES }
const uploadKey = (kind: Kind, mediaId: string) => `${folder[kind]}/${mediaId}`
const variantKey = (kind: Kind, mediaId: string, size: number) => `${folder[kind]}/${mediaId}/${size}.webp`

/**
 * Where a member's avatar is served from, without the size suffix: the web app
 * appends `/96.webp` or `/256.webp`. A path, not a URL, so the same response works
 * whether media is proxied by the web app or served from a CDN route.
 */
export const avatarPath = (mediaId: string | null): string | null =>
  mediaId ? `/media/avatars/${mediaId}` : null

/** Same idea for post images: the web app appends `/640.webp` or `/1600.webp`. */
export const postImagePath = (mediaId: string): string => `/media/posts/${mediaId}`

/** Decodes an upload, refusing anything that is not a JPEG, PNG or WebP. */
async function decode(original: Buffer): Promise<ReturnType<typeof sharp>> {
  const image = sharp(original, { limitInputPixels: MAX_PIXELS })
  const meta = await image.metadata()
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('unsupported format')
  return image
}

export type PostImageStatus = 'pending' | 'processing' | 'ready' | 'failed'

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(MEDIA_JOBS) private readonly jobs: MediaJobs,
  ) {}

  /**
   * Step 1: reserves a media ID and returns a URL the browser uploads the file
   * to directly. Nothing is public yet.
   */
  async startUpload(
    ownerId: string,
    kind: Kind,
    contentType: ImageType,
    bytes: number,
  ): Promise<{ mediaId: string; uploadUrl: string }> {
    await this.sweepAbandoned(ownerId)
    const [row] = await this.db
      .insert(media)
      .values({ ownerId, kind, contentType, bytes })
      .returning({ id: media.id })
    const uploadUrl = await this.store.presignUpload(uploadKey(kind, row!.id), contentType, bytes)
    return { mediaId: row!.id, uploadUrl }
  }

  startAvatarUpload(ownerId: string, contentType: ImageType, bytes: number) {
    return this.startUpload(ownerId, 'avatar', contentType, bytes)
  }

  startPostImageUpload(ownerId: string, contentType: ImageType, bytes: number) {
    return this.startUpload(ownerId, 'post_image', contentType, bytes)
  }

  /** The member's own upload of this kind, unless it is gone or unusable. */
  private async ownUpload(ownerId: string, mediaId: string, kind: Kind) {
    const [row] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId), eq(media.kind, kind)))
    if (!row || row.status === 'deleted' || row.status === 'failed') {
      throw new MediaError('not_found', 'no such upload')
    }
    return row
  }

  /** Checks the browser's upload arrived and is not over the limit. */
  private async checkUploaded(kind: Kind, mediaId: string, maxBytes: number): Promise<void> {
    const size = await this.store.size('uploads', uploadKey(kind, mediaId))
    if (size === null) throw new MediaError('not_uploaded', 'the file has not been uploaded yet')
    if (size > maxBytes) await this.fail(kind, mediaId, new MediaError('too_large', 'that file is too large'))
  }

  private async fail(kind: Kind, mediaId: string, error: MediaError): Promise<never> {
    await this.db.update(media).set({ status: 'failed' }).where(eq(media.id, mediaId))
    await this.store.remove('uploads', uploadKey(kind, mediaId))
    throw error
  }

  /**
   * Step 2, after the browser has uploaded: checks the file really is an image,
   * re-encodes it at our sizes (which drops any embedded location or camera data),
   * publishes those, and makes it the member's avatar. Done inside the request:
   * a 512px square is quick.
   */
  async finishAvatarUpload(ownerId: string, mediaId: string): Promise<string> {
    const row = await this.ownUpload(ownerId, mediaId, 'avatar')
    // Already done (a retried request): same answer, no second round of work.
    if (row.status === 'ready') return avatarPath(row.id)!

    await this.checkUploaded('avatar', row.id, AVATAR_MAX_BYTES)
    const key = uploadKey('avatar', row.id)
    const original = await this.store.read('uploads', key)
    let variants: { size: number; body: Buffer }[]
    try {
      const image = await decode(original)
      variants = await Promise.all(
        AVATAR_SIZES.map(async (px) => ({
          size: px,
          body: await image
            .clone()
            .rotate() // honour the camera's orientation flag before it is stripped
            .resize(px, px, { fit: 'cover', position: 'attention' })
            .webp({ quality: 82 })
            .toBuffer(),
        })),
      )
    } catch {
      return this.fail('avatar', row.id, new MediaError('not_an_image', 'that file is not a JPEG, PNG or WebP image'))
    }

    for (const v of variants) await this.store.write('media', variantKey('avatar', row.id, v.size), v.body, 'image/webp')
    await this.store.remove('uploads', key)

    const previous = await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ avatarMediaId: members.avatarMediaId })
        .from(members)
        .where(eq(members.id, ownerId))
        .for('update')
      await tx.update(media).set({ status: 'ready', readyAt: new Date() }).where(eq(media.id, row.id))
      await tx.update(members).set({ avatarMediaId: row.id }).where(eq(members.id, ownerId))
      return member?.avatarMediaId ?? null
    })
    if (previous && previous !== row.id) await this.discard('avatar', [previous])
    return avatarPath(row.id)!
  }

  /**
   * Step 2 for a post image: hands the upload to the background job, which does
   * what `finishAvatarUpload` does but at post-image sizes. The browser then asks
   * `postImageStatus` until it is ready, and only a ready image can go on a post.
   */
  async finishPostImageUpload(ownerId: string, mediaId: string): Promise<PostImageStatus> {
    const row = await this.ownUpload(ownerId, mediaId, 'post_image')
    if (row.status === 'ready') return 'ready'
    if (row.status === 'pending') {
      await this.checkUploaded('post_image', row.id, POST_IMAGE_MAX_BYTES)
      await this.db
        .update(media)
        .set({ status: 'processing' })
        .where(and(eq(media.id, row.id), eq(media.status, 'pending')))
    }
    // Queued again when already processing, in case the first job was lost.
    await this.jobs.processPostImage(row.id)
    return 'processing'
  }

  /** Null when there is no such upload of the member's (or it was abandoned). */
  async postImageStatus(ownerId: string, mediaId: string): Promise<PostImageStatus | null> {
    const [row] = await this.db
      .select({ status: media.status })
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId), eq(media.kind, 'post_image')))
    return !row || row.status === 'deleted' ? null : row.status
  }

  /**
   * The background job. Keeps the original proportions, never enlarges, and
   * records the dimensions so pages can reserve the image's space before it loads.
   * A file that is not an image fails quietly; storage errors throw so the job
   * is retried.
   */
  async processPostImage(mediaId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.kind, 'post_image')))
    if (row?.status !== 'processing') return

    const key = uploadKey('post_image', row.id)
    const original = await this.store.read('uploads', key)
    let variants: { size: number; body: Buffer; width: number; height: number }[]
    try {
      const image = await decode(original)
      variants = await Promise.all(
        POST_IMAGE_SIZES.map(async (px) => {
          const { data, info } = await image
            .clone()
            .rotate()
            .resize(px, px, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer({ resolveWithObject: true })
          return { size: px, body: data, width: info.width, height: info.height }
        }),
      )
    } catch {
      await this.db.update(media).set({ status: 'failed' }).where(eq(media.id, row.id))
      await this.store.remove('uploads', key)
      return
    }

    for (const v of variants) await this.store.write('media', variantKey('post_image', row.id, v.size), v.body, 'image/webp')
    await this.store.remove('uploads', key)
    const largest = variants.at(-1)!
    const done = await this.db
      .update(media)
      .set({ status: 'ready', readyAt: new Date(), width: largest.width, height: largest.height })
      .where(and(eq(media.id, row.id), eq(media.status, 'processing')))
      .returning({ id: media.id })
    // Abandoned while we worked: do not leave its files public.
    if (done.length === 0) await this.discard('post_image', [row.id])
  }

  /** Goes back to the initial-letter avatar. Idempotent. */
  async removeAvatar(ownerId: string): Promise<void> {
    const [member] = await this.db
      .select({ avatarMediaId: members.avatarMediaId })
      .from(members)
      .where(eq(members.id, ownerId))
    if (!member?.avatarMediaId) return
    await this.db.update(members).set({ avatarMediaId: null }).where(eq(members.id, ownerId))
    await this.discard('avatar', [member.avatarMediaId])
  }

  /** Deletes the images of a post its author has deleted. Idempotent. */
  async discardPostImages(postId: string): Promise<void> {
    const rows = await this.db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.postId, postId), eq(media.status, 'ready')))
    await this.discard('post_image', rows.map((r) => r.id))
  }

  /** Deletes published files and marks their rows deleted. */
  private async discard(kind: Kind, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return
    await this.db.update(media).set({ status: 'deleted' }).where(inArray(media.id, mediaIds))
    for (const id of mediaIds) for (const px of sizes[kind]) await this.store.remove('media', variantKey(kind, id, px))
  }

  /**
   * Clears uploads that were started and never finished, and post images that
   * never made it onto a post, so abandoned files do not pile up. Runs for one
   * member whenever they start an upload, and for everyone hourly.
   */
  async sweepAbandoned(ownerId?: string): Promise<void> {
    const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS)
    const whose: SQL | undefined = ownerId ? eq(media.ownerId, ownerId) : undefined

    const unfinished = await this.db
      .update(media)
      .set({ status: 'deleted' })
      .where(and(whose, inArray(media.status, ['pending', 'processing']), lt(media.createdAt, cutoff)))
      .returning({ id: media.id, kind: media.kind })
    for (const row of unfinished) await this.store.remove('uploads', uploadKey(row.kind, row.id))

    // One conditional update, so an image being attached to a post right now is
    // either attached or swept, never both.
    const unused = await this.db
      .update(media)
      .set({ status: 'deleted' })
      .where(
        and(
          whose,
          eq(media.kind, 'post_image'),
          eq(media.status, 'ready'),
          isNull(media.postId),
          lt(media.readyAt, cutoff),
        ),
      )
      .returning({ id: media.id })
    await this.discard('post_image', unused.map((r) => r.id))
  }
}
