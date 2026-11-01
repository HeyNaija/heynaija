import { communities, type Db, media, members, posts, reports } from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { and, eq, inArray, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { managesPhoto } from '../communities/photo-managers.js'
import { SAFETY_ALERTS, type SafetyAlerts } from '../moderation/safety-alerts.js'
import { DB } from '../tokens.js'
import type { ObjectStore } from './object-store.js'

export const OBJECT_STORE = Symbol('OBJECT_STORE')
export const MEDIA_JOBS = Symbol('MEDIA_JOBS')

/** What the media service needs from the job queue: somewhere to send work. */
export interface MediaJobs {
  /** Queues an uploaded post image for checking and re-encoding. Safe to repeat. */
  processPostImage(mediaId: string): Promise<void>
  /** Queues dropping these media-bucket files from the CDN's cache, retried until it works. */
  purgeCdn(keys: string[]): Promise<void>
}

export const CONTENT_SCANNER = Symbol('CONTENT_SCANNER')

/**
 * Checks an upload against known child sexual abuse material before anything is
 * published. See docs/safety/abuse-material-scanning.md: PhotoDNA once it is
 * approved (./photodna.ts); until then every image passes.
 */
export interface ContentScanner {
  /** Throws when it cannot tell, and then the image is not published. */
  scan(image: Buffer): Promise<'clear' | 'match'>
}

export class NoScanner implements ContentScanner {
  async scan(): Promise<'clear'> {
    return 'clear'
  }
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]
/** A post may also carry a GIF, which is kept as an animated WebP. A profile photo may not. */
export const POST_IMAGE_TYPES = [...IMAGE_TYPES, 'image/gif'] as const
export type PostImageType = (typeof POST_IMAGE_TYPES)[number]

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
/** Square sizes we keep: one for lists and posts, one for the profile header. */
export const AVATAR_SIZES = [96, 256] as const

export const POST_IMAGE_MAX_BYTES = 10 * 1024 * 1024
/** Longest-edge limits we keep: one for feeds, one for viewing the image on its own. */
export const POST_IMAGE_SIZES = [640, 1600] as const
export const POST_IMAGES_MAX = 4
export const ALT_MAX = 1000
/**
 * A GIF is held decoded, frame by frame, while it is re-encoded, so what costs
 * memory is frames × pixels. These keep a job within a few hundred megabytes and
 * keep "short" honest: 300 frames is about half a minute at the usual 10 a second.
 */
export const ANIMATION_MAX_FRAMES = 300
export const ANIMATION_MAX_PIXELS = 40_000_000

// Refuse absurd dimensions before decoding: a tiny file can describe a huge image.
const MAX_PIXELS = 40_000_000
// Uploads nobody finished, and post images never attached to a post, are cleared after this.
const ABANDONED_AFTER_MS = 60 * 60 * 1000

export class MediaError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_uploaded' | 'too_large' | 'not_an_image' | 'blocked' | 'scan_unavailable' | 'forbidden',
    message: string,
  ) {
    super(message)
  }
}

type Kind = 'avatar' | 'post_image' | 'community_photo'
export type { Kind as MediaKind }

const folder: Record<Kind, string> = { avatar: 'avatars', post_image: 'posts', community_photo: 'community-photos' }
// Whether an image is its uploader's, and so goes when their account is erased.
// A community's photo is the community's, whichever moderator uploaded it.
const personal: Record<Kind, boolean> = { avatar: true, post_image: true, community_photo: false }
/** The kinds erasing an account takes with it (AccountDeletionService, `eraseFilesOf`). */
export const ACCOUNT_MEDIA_KINDS = (Object.keys(personal) as Kind[]).filter((kind) => personal[kind])
const sizes: Record<Kind, readonly number[]> = { avatar: AVATAR_SIZES, post_image: POST_IMAGE_SIZES, community_photo: AVATAR_SIZES }
const uploadKey = (kind: Kind, mediaId: string) => `${folder[kind]}/${mediaId}`
const variantKey = (kind: Kind, mediaId: string, size: number) => `${folder[kind]}/${mediaId}/${size}.webp`
// A GIF's first frame, so readers can pause it and quoted posts need not play it.
const stillKey = (kind: Kind, mediaId: string) => `${folder[kind]}/${mediaId}/still.webp`
/** Every file a published image may have: its sizes, and a still if it is animated. */
export const publishedKeys = (kind: Kind, mediaId: string) => [
  ...sizes[kind].map((px) => variantKey(kind, mediaId, px)),
  ...(kind === 'post_image' ? [stillKey(kind, mediaId)] : []),
]
// Private copies of what moderators took down or the scanner blocked, kept as
// evidence and so a removal can be undone. Never touched by the abandoned-upload
// clean-up, here or in the bucket's lifecycle rule.
const quarantineKey = (key: string) => `quarantine/${key}`

/**
 * Where a member's avatar is served from, without the size suffix: the web app
 * appends `/96.webp` or `/256.webp`. A path, not a URL, so the same response works
 * whether media is proxied by the web app or served from a CDN route.
 */
export const avatarPath = (mediaId: string | null): string | null =>
  mediaId ? `/media/avatars/${mediaId}` : null

/** Same idea for a community's photo: `/96.webp` or `/256.webp` follows. */
export const communityPhotoPath = (mediaId: string | null): string | null =>
  mediaId ? `/media/community-photos/${mediaId}` : null

/** Same idea for post images: the web app appends `/640.webp` or `/1600.webp`. */
export const postImagePath = (mediaId: string): string => `/media/posts/${mediaId}`

/** Decodes an upload, refusing anything that is not a JPEG, PNG or WebP (or, where allowed, a GIF's first frame). */
async function decode(original: Buffer, formats: string[] = ['jpeg', 'png', 'webp']): Promise<ReturnType<typeof sharp>> {
  const image = sharp(original, { limitInputPixels: MAX_PIXELS })
  const meta = await image.metadata()
  if (!meta.format || !formats.includes(meta.format)) throw new Error('unsupported format')
  return image
}

type Encoded = {
  animated: boolean
  /** Names inside the image's folder, such as `640.webp`. */
  files: { name: string; body: Buffer }[]
  /** Of the largest version, one frame's worth for an animation. */
  width: number
  height: number
}

/** Fits the image within `px` on its longest edge, never enlarging it. */
const fit = (image: ReturnType<typeof sharp>, px: number) => image.resize(px, px, { fit: 'inside', withoutEnlargement: true })

/**
 * A GIF with more than one frame as animated WebP at our sizes, plus a still of its
 * first frame; null for anything that is not an animation. A GIF over the limits
 * throws, as an unusable file does.
 */
async function encodeAnimation(original: Buffer): Promise<Encoded | null> {
  const source = () => sharp(original, { limitInputPixels: MAX_PIXELS, animated: true })
  const meta = await source().metadata()
  const frames = meta.pages ?? 1
  if (meta.format !== 'gif' || frames < 2) return null
  const frameHeight = meta.pageHeight ?? meta.height!
  if (frames > ANIMATION_MAX_FRAMES || meta.width! * frameHeight * frames > ANIMATION_MAX_PIXELS) {
    throw new Error('animation too long or too large')
  }
  const large = await fit(source(), POST_IMAGE_SIZES[1]).webp({ quality: 75 }).toBuffer({ resolveWithObject: true })
  const width = large.info.width
  const height = large.info.pageHeight ?? large.info.height
  // Encoding is the slow part: a GIF already within the small size is not encoded twice.
  const small =
    Math.max(width, height) > POST_IMAGE_SIZES[0]
      ? (await fit(source(), POST_IMAGE_SIZES[0]).webp({ quality: 75 }).toBuffer()) as Buffer
      : large.data
  const still = await fit(sharp(original, { limitInputPixels: MAX_PIXELS }), POST_IMAGE_SIZES[0]).webp({ quality: 80 }).toBuffer()
  return {
    animated: true,
    files: [
      { name: `${POST_IMAGE_SIZES[0]}.webp`, body: small },
      { name: `${POST_IMAGE_SIZES[1]}.webp`, body: large.data },
      { name: 'still.webp', body: still },
    ],
    width,
    height,
  }
}

/** A post image, whatever it is, as the files we publish: re-encoded, with location data dropped. */
async function encodePostImage(original: Buffer): Promise<Encoded> {
  const animation = await encodeAnimation(original)
  if (animation) return animation
  const image = await decode(original, ['jpeg', 'png', 'webp', 'gif'])
  const sized = await Promise.all(
    POST_IMAGE_SIZES.map(async (px) => {
      const { data, info } = await fit(image.clone().rotate(), px).webp({ quality: 80 }).toBuffer({ resolveWithObject: true })
      return { name: `${px}.webp`, body: data, width: info.width, height: info.height }
    }),
  )
  const largest = sized.at(-1)!
  return { animated: false, files: sized.map(({ name, body }) => ({ name, body })), width: largest.width, height: largest.height }
}

export type PostImageStatus = 'pending' | 'processing' | 'ready' | 'failed'

@Injectable()
export class MediaService {
  private readonly log = new Logger(MediaService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(MEDIA_JOBS) private readonly jobs: MediaJobs,
    @Optional() @Inject(CONTENT_SCANNER) private readonly scanner: ContentScanner = new NoScanner(),
    @Optional() @Inject(SAFETY_ALERTS) private readonly alerts?: SafetyAlerts,
  ) {}

  /**
   * Runs the scanner on an upload. On a match the original is kept privately,
   * the row is marked blocked, the account goes into the moderation queue and
   * whoever handles safety is alerted; the uploader is told only that the image
   * cannot be used. A scanner that cannot answer fails closed: nothing is
   * published, and the upload can be tried again.
   */
  private async screen(kind: Kind, mediaId: string, ownerId: string, original: Buffer): Promise<boolean> {
    let verdict: 'clear' | 'match'
    try {
      verdict = await this.scanner.scan(original)
    } catch (err) {
      this.log.warn(`content scanner could not check upload ${mediaId}: ${(err as Error).message}`)
      throw new MediaError('scan_unavailable', 'images cannot be checked right now; try again in a few minutes')
    }
    if (verdict === 'clear') return true

    const key = uploadKey(kind, mediaId)
    await this.store.write('uploads', quarantineKey(`originals/${key}`), original, 'application/octet-stream')
    await this.store.remove('uploads', key)
    await this.db.update(media).set({ status: 'blocked' }).where(eq(media.id, mediaId))
    const what = kind === 'avatar' ? 'profile photo' : kind === 'community_photo' ? 'community photo' : 'post image'
    await this.db.insert(reports).values({
      reporterId: null,
      memberId: ownerId,
      reason: 'illegal',
      details:
        `The upload scanner matched a ${what} this account uploaded (media ${mediaId}) with known child sexual abuse material. ` +
        'It was never published, and the original is kept privately. Do not try to view it: suspend the account and follow the safety runbook.',
    })
    await this.alerts?.alert('An upload matched known abuse material', [
      `The scanner blocked a ${what} (media ${mediaId}) uploaded by member ${ownerId}. It was not published.`,
      'The account is waiting in the moderation queue.',
    ])
    return false
  }

  /**
   * Step 1: reserves a media ID and returns a URL the browser uploads the file
   * to directly. Nothing is public yet. A community photo names its community.
   */
  async startUpload(
    ownerId: string,
    kind: Kind,
    contentType: PostImageType,
    bytes: number,
    communityId: string | null = null,
  ): Promise<{ mediaId: string; uploadUrl: string }> {
    await this.sweepAbandoned(ownerId)
    const [row] = await this.db
      .insert(media)
      .values({ ownerId, kind, contentType, bytes, communityId })
      .returning({ id: media.id })
    const uploadUrl = await this.store.presignUpload(uploadKey(kind, row!.id), contentType, bytes)
    return { mediaId: row!.id, uploadUrl }
  }

  startAvatarUpload(ownerId: string, contentType: ImageType, bytes: number) {
    return this.startUpload(ownerId, 'avatar', contentType, bytes)
  }

  startPostImageUpload(ownerId: string, contentType: PostImageType, bytes: number) {
    return this.startUpload(ownerId, 'post_image', contentType, bytes)
  }

  /** The member's own upload of this kind, unless it is gone or unusable. */
  private async ownUpload(ownerId: string, mediaId: string, kind: Kind) {
    const [row] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId), eq(media.kind, kind)))
    if (!row || !['pending', 'processing', 'ready'].includes(row.status)) {
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
   * The shared middle of a profile or community photo: checks the upload, makes
   * square versions (dropping embedded location or camera data), runs the
   * scanner, and publishes the versions. Throws a MediaError when it cannot.
   */
  private async publishSquare(kind: 'avatar' | 'community_photo', mediaId: string, ownerId: string): Promise<void> {
    await this.checkUploaded(kind, mediaId, AVATAR_MAX_BYTES)
    const key = uploadKey(kind, mediaId)
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
      return this.fail(kind, mediaId, new MediaError('not_an_image', 'that file is not a JPEG, PNG or WebP image'))
    }
    if (!(await this.screen(kind, mediaId, ownerId, original))) {
      throw new MediaError('blocked', 'that image cannot be used')
    }

    for (const v of variants) await this.store.write('media', variantKey(kind, mediaId, v.size), v.body, 'image/webp')
    await this.store.remove('uploads', key)
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

    await this.publishSquare('avatar', row.id, ownerId)

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
    if (!row || row.status === 'deleted' || row.status === 'quarantined') return null
    // The uploader is not told their image matched; to them it simply failed.
    return row.status === 'blocked' ? 'failed' : row.status
  }

  /**
   * The background job. Keeps the original proportions, never enlarges, and
   * records the dimensions so pages can reserve the image's space before it loads.
   * A file that is not an image fails quietly; storage errors throw so the job
   * is retried. A GIF becomes an animated WebP with a still of its first frame.
   */
  async processPostImage(mediaId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.kind, 'post_image')))
    if (row?.status !== 'processing') return

    const key = uploadKey('post_image', row.id)
    const original = await this.store.read('uploads', key)
    let encoded: Encoded
    try {
      encoded = await encodePostImage(original)
    } catch {
      await this.db.update(media).set({ status: 'failed' }).where(eq(media.id, row.id))
      await this.store.remove('uploads', key)
      return
    }
    if (!(await this.screen('post_image', row.id, row.ownerId, original))) return

    for (const file of encoded.files) {
      await this.store.write('media', `${folder.post_image}/${row.id}/${file.name}`, file.body, 'image/webp')
    }
    await this.store.remove('uploads', key)
    const done = await this.db
      .update(media)
      .set({ status: 'ready', readyAt: new Date(), width: encoded.width, height: encoded.height, animated: encoded.animated })
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

  /**
   * Takes a post's images out of public view, keeping the files privately, when
   * a moderator removes the post. Files move before the rows change, so if
   * storage fails part-way the hourly sweep finishes the job. Idempotent.
   */
  async quarantinePostImages(postId: string): Promise<void> {
    const rows = await this.db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.postId, postId), eq(media.status, 'ready')))
    await this.quarantine('post_image', rows.map((r) => r.id))
  }

  /**
   * Puts a restored post's images back, unless the post has been deleted: then
   * they stay private, as the evidence images of an erased account must
   * (docs/adr/0016). Idempotent.
   */
  async releasePostImages(postId: string): Promise<void> {
    const rows = await this.db
      .select({ id: media.id })
      .from(media)
      .innerJoin(posts, eq(posts.id, media.postId))
      .where(and(eq(media.postId, postId), eq(media.status, 'quarantined'), isNull(posts.deletedAt)))
    for (const { id } of rows) {
      await this.moveVariants('post_image', id, 'release')
      await this.db.update(media).set({ status: 'ready' }).where(eq(media.id, id))
    }
  }

  /**
   * Takes down a profile photo a moderator removed. The member's avatar is
   * cleared by the moderation decision itself; this moves the files.
   */
  async quarantineAvatar(mediaId: string): Promise<void> {
    await this.quarantine('avatar', [mediaId])
  }

  // --- Community photos: the same steps as a profile photo, for moderators. ---

  /**
   * The community, if the member may change its photo (see photo-managers.ts).
   * Throws not_found for an unknown or closed community, whoever asks, and
   * forbidden for anyone who may not change it. Communities are public, so
   * telling the two apart gives nothing away.
   */
  private async photoManagerFor(memberId: string, slug: string): Promise<{ id: string; photoMediaId: string | null }> {
    const [community] = await this.db
      .select({ id: communities.id, photoMediaId: communities.photoMediaId, allowed: managesPhoto(memberId) })
      .from(communities)
      .where(and(eq(communities.slug, slug), eq(communities.active, true)))
    if (!community) throw new MediaError('not_found', 'no such community')
    if (!community.allowed) throw new MediaError('forbidden', 'only the moderators of this community can change its photo')
    return { id: community.id, photoMediaId: community.photoMediaId }
  }

  async startCommunityPhotoUpload(memberId: string, slug: string, contentType: ImageType, bytes: number) {
    const community = await this.photoManagerFor(memberId, slug)
    return this.startUpload(memberId, 'community_photo', contentType, bytes, community.id)
  }

  /** Publishes the upload as the community's photo and deletes the one it replaces. */
  async finishCommunityPhotoUpload(memberId: string, slug: string, mediaId: string): Promise<string> {
    const community = await this.photoManagerFor(memberId, slug)
    const row = await this.ownUpload(memberId, mediaId, 'community_photo')
    // Started for another community: it can only ever be that one's photo, so two
    // communities never share one set of files.
    if (row.communityId !== community.id) throw new MediaError('not_found', 'no such upload')
    if (row.status === 'ready' && community.photoMediaId === row.id) return communityPhotoPath(row.id)!

    await this.publishSquare('community_photo', row.id, memberId)
    const previous = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ photoMediaId: communities.photoMediaId })
        .from(communities)
        .where(eq(communities.id, community.id))
        .for('update')
      await tx.update(media).set({ status: 'ready', readyAt: new Date() }).where(eq(media.id, row.id))
      await tx.update(communities).set({ photoMediaId: row.id }).where(eq(communities.id, community.id))
      return current?.photoMediaId ?? null
    })
    if (previous && previous !== row.id) await this.discardCommunityPhoto(previous)
    return communityPhotoPath(row.id)!
  }

  /** Back to the subject icon. Idempotent. */
  async removeCommunityPhoto(memberId: string, slug: string): Promise<void> {
    const community = await this.photoManagerFor(memberId, slug)
    if (!community.photoMediaId) return
    await this.db.update(communities).set({ photoMediaId: null }).where(eq(communities.id, community.id))
    await this.discardCommunityPhoto(community.photoMediaId)
  }

  /**
   * Deletes the files of a community photo that was replaced or removed, unless
   * it has an open report: then they are kept privately, so whoever set it
   * cannot destroy what a moderator needs to judge. Idempotent.
   */
  private async discardCommunityPhoto(mediaId: string): Promise<void> {
    const [reported] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.photoMediaId, mediaId), eq(reports.status, 'open')))
      .limit(1)
    if (reported) await this.quarantine('community_photo', [mediaId])
    else await this.discard('community_photo', [mediaId])
  }

  /** Moves the files of a photo a site moderator took down. The decision itself clears the column. */
  async quarantineCommunityPhoto(mediaId: string): Promise<void> {
    await this.quarantine('community_photo', [mediaId])
  }

  /**
   * A replaced or removed community photo kept privately only because it was
   * reported: once every report about it has been dismissed, its private copies
   * go, as a replaced photo's files do. Kept while it is still the community's
   * photo, a report about it is open, or one was upheld. Idempotent.
   */
  async discardClearedCommunityPhoto(mediaId: string): Promise<void> {
    const cleared = await this.db
      .update(media)
      .set({ status: 'deleted' })
      .where(
        and(
          eq(media.id, mediaId),
          eq(media.kind, 'community_photo'),
          eq(media.status, 'quarantined'),
          sql`not exists(select 1 from communities c where c.photo_media_id = ${media.id})`,
          sql`not exists(select 1 from reports r where r.photo_media_id = ${media.id} and r.status <> 'dismissed')`,
        ),
      )
      .returning({ id: media.id })
    if (cleared.length === 0) return
    for (const key of publishedKeys('community_photo', mediaId)) await this.store.remove('uploads', quarantineKey(key))
  }

  private async quarantine(kind: Kind, mediaIds: string[]): Promise<void> {
    for (const id of mediaIds) {
      await this.moveVariants(kind, id, 'quarantine')
      // Out of the bucket, but Cloudflare may still hold a cached copy for a year.
      await this.jobs.purgeCdn(publishedKeys(kind, id))
      await this.db.update(media).set({ status: 'quarantined' }).where(eq(media.id, id))
    }
  }

  /** Moves published files between the public bucket and the private quarantine. */
  private async moveVariants(kind: Kind, mediaId: string, direction: 'quarantine' | 'release'): Promise<void> {
    for (const key of publishedKeys(kind, mediaId)) {
      const [from, fromKey, to, toKey] =
        direction === 'quarantine'
          ? (['media', key, 'uploads', quarantineKey(key)] as const)
          : (['uploads', quarantineKey(key), 'media', key] as const)
      // Already moved (a retry): nothing to do for this file.
      if ((await this.store.size(from, fromKey)) === null) continue
      await this.store.write(to, toKey, await this.store.read(from, fromKey), 'image/webp')
      await this.store.remove(from, fromKey)
    }
  }

  /**
   * Deletes the images of a post its author has deleted, unless the post has
   * been reported and not yet decided: then they are kept privately, so the
   * author cannot destroy what a moderator needs to see. Idempotent.
   */
  async discardPostImages(postId: string): Promise<void> {
    const rows = await this.db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.postId, postId), eq(media.status, 'ready')))
    const [reported] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.postId, postId), eq(reports.status, 'open')))
      .limit(1)
    if (reported) await this.quarantine('post_image', rows.map((r) => r.id))
    else await this.discard('post_image', rows.map((r) => r.id))
  }

  /** Deletes published files and marks their rows deleted. */
  private async discard(kind: Kind, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return
    await this.db.update(media).set({ status: 'deleted' }).where(inArray(media.id, mediaIds))
    const keys = mediaIds.flatMap((id) => publishedKeys(kind, id))
    for (const key of keys) await this.store.remove('media', key)
    // Gone from the bucket, but Cloudflare may still serve a cached copy for a year.
    // One job for them all: the purger splits them into requests Cloudflare takes.
    await this.jobs.purgeCdn(keys)
  }

  /**
   * After an account's rows are erased (docs/adr/0016): deletes the files of
   * every image of theirs marked deleted, unfinished uploads included, and takes
   * what was kept as evidence (left 'ready') out of public view. Old deleted ones
   * too: one deleted before deleting purged the CDN may still be cached there.
   * A community photo they uploaded is the community's and is left alone.
   * Safe to repeat: removing a file already gone changes nothing.
   */
  async eraseFilesOf(ownerId: string): Promise<void> {
    const rows = await this.db
      .select({ id: media.id, kind: media.kind, status: media.status })
      .from(media)
      .where(and(eq(media.ownerId, ownerId), inArray(media.kind, ACCOUNT_MEDIA_KINDS), inArray(media.status, ['deleted', 'ready'])))
    for (const kind of ACCOUNT_MEDIA_KINDS) {
      const ids = (status: 'deleted' | 'ready') => rows.filter((r) => r.kind === kind && r.status === status).map((r) => r.id)
      for (const id of ids('deleted')) await this.store.remove('uploads', uploadKey(kind, id))
      await this.discard(kind, ids('deleted'))
      await this.quarantine(kind, ids('ready'))
    }
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

    // Taken down by a moderator but somehow still public, because moving the
    // files failed at the time: images of removed posts, and profile photos no
    // member uses any more. Everyone's, so only on the hourly run.
    if (!ownerId) {
      const exposedImages = await this.db
        .select({ id: media.id })
        .from(media)
        .innerJoin(posts, eq(posts.id, media.postId))
        .where(and(eq(media.status, 'ready'), isNotNull(posts.removedAt)))
      await this.quarantine('post_image', exposedImages.map((r) => r.id))
      const exposedAvatars = await this.db
        .select({ id: media.id })
        .from(media)
        .where(
          and(
            eq(media.kind, 'avatar'),
            eq(media.status, 'ready'),
            sql`not exists(select 1 from members m where m.avatar_media_id = ${media.id})`,
          ),
        )
      await this.quarantine('avatar', exposedAvatars.map((r) => r.id))
      const exposedPhotos = await this.db
        .select({ id: media.id })
        .from(media)
        .where(
          and(
            eq(media.kind, 'community_photo'),
            eq(media.status, 'ready'),
            sql`not exists(select 1 from communities c where c.photo_media_id = ${media.id})`,
          ),
        )
      await this.quarantine('community_photo', exposedPhotos.map((r) => r.id))
    }
  }
}
