import { type Db, media, members } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, lt } from 'drizzle-orm'
import sharp from 'sharp'
import { DB } from '../tokens.js'
import type { ObjectStore } from './object-store.js'

export const OBJECT_STORE = Symbol('OBJECT_STORE')

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
/** Square sizes we keep: one for lists and posts, one for the profile header. */
export const AVATAR_SIZES = [96, 256] as const

// Refuse absurd dimensions before decoding: a tiny file can describe a huge image.
const MAX_PIXELS = 40_000_000
const PENDING_TTL_MS = 60 * 60 * 1000

export class MediaError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_uploaded' | 'too_large' | 'not_an_image',
    message: string,
  ) {
    super(message)
  }
}

const uploadKey = (mediaId: string) => `avatars/${mediaId}`
const variantKey = (mediaId: string, size: number) => `avatars/${mediaId}/${size}.webp`

/**
 * Where a member's avatar is served from, without the size suffix: the web app
 * appends `/96.webp` or `/256.webp`. A path, not a URL, so the same response works
 * whether media is proxied by the web app or served from a CDN route.
 */
export const avatarPath = (mediaId: string | null): string | null =>
  mediaId ? `/media/avatars/${mediaId}` : null

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {}

  /**
   * Step 1: reserves a media ID and returns a URL the browser uploads the file
   * to directly. Nothing is public yet.
   */
  async startAvatarUpload(
    ownerId: string,
    contentType: (typeof AVATAR_TYPES)[number],
    bytes: number,
  ): Promise<{ mediaId: string; uploadUrl: string }> {
    await this.purgeAbandoned(ownerId)
    const [row] = await this.db
      .insert(media)
      .values({ ownerId, kind: 'avatar', contentType, bytes })
      .returning({ id: media.id })
    const uploadUrl = await this.store.presignUpload(uploadKey(row!.id), contentType, bytes)
    return { mediaId: row!.id, uploadUrl }
  }

  /**
   * Step 2, after the browser has uploaded: checks the file really is an image,
   * re-encodes it at our sizes (which drops any embedded location or camera data),
   * publishes those, and makes it the member's avatar.
   */
  async finishAvatarUpload(ownerId: string, mediaId: string): Promise<string> {
    const [row] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId), eq(media.kind, 'avatar')))
    if (!row || row.status === 'deleted' || row.status === 'failed') {
      throw new MediaError('not_found', 'no such upload')
    }
    // Already done (a retried request): same answer, no second round of work.
    if (row.status === 'ready') return avatarPath(row.id)!

    const key = uploadKey(row.id)
    const size = await this.store.size('uploads', key)
    if (size === null) throw new MediaError('not_uploaded', 'the file has not been uploaded yet')

    const fail = async (error: MediaError): Promise<never> => {
      await this.db.update(media).set({ status: 'failed' }).where(eq(media.id, row.id))
      await this.store.remove('uploads', key)
      throw error
    }
    if (size > AVATAR_MAX_BYTES) await fail(new MediaError('too_large', 'that file is too large'))

    const original = await this.store.read('uploads', key)
    let variants: { size: number; body: Buffer }[]
    try {
      const meta = await sharp(original, { limitInputPixels: MAX_PIXELS }).metadata()
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('unsupported format')
      variants = await Promise.all(
        AVATAR_SIZES.map(async (px) => ({
          size: px,
          body: await sharp(original, { limitInputPixels: MAX_PIXELS })
            .rotate() // honour the camera's orientation flag before it is stripped
            .resize(px, px, { fit: 'cover', position: 'attention' })
            .webp({ quality: 82 })
            .toBuffer(),
        })),
      )
    } catch {
      return fail(new MediaError('not_an_image', 'that file is not a JPEG, PNG or WebP image'))
    }

    for (const v of variants) await this.store.write('media', variantKey(row.id, v.size), v.body, 'image/webp')
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
    if (previous && previous !== row.id) await this.discard(previous)
    return avatarPath(row.id)!
  }

  /** Goes back to the initial-letter avatar. Idempotent. */
  async removeAvatar(ownerId: string): Promise<void> {
    const [member] = await this.db
      .select({ avatarMediaId: members.avatarMediaId })
      .from(members)
      .where(eq(members.id, ownerId))
    if (!member?.avatarMediaId) return
    await this.db.update(members).set({ avatarMediaId: null }).where(eq(members.id, ownerId))
    await this.discard(member.avatarMediaId)
  }

  /** Deletes a published avatar's files and marks its row deleted. */
  private async discard(mediaId: string): Promise<void> {
    await this.db.update(media).set({ status: 'deleted' }).where(eq(media.id, mediaId))
    for (const px of AVATAR_SIZES) await this.store.remove('media', variantKey(mediaId, px))
  }

  /**
   * Clears this member's uploads that were started and never finished, so
   * abandoned files do not pile up. Runs whenever they start a new one.
   */
  private async purgeAbandoned(ownerId: string): Promise<void> {
    const stale = await this.db
      .update(media)
      .set({ status: 'deleted' })
      .where(
        and(
          eq(media.ownerId, ownerId),
          eq(media.status, 'pending'),
          lt(media.createdAt, new Date(Date.now() - PENDING_TTL_MS)),
        ),
      )
      .returning({ id: media.id })
    for (const row of stale) await this.store.remove('uploads', uploadKey(row.id))
  }
}

