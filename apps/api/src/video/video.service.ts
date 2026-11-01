import { type Db, media, members, moderationActions, posts, reports, videoDetails, videoRenditions } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, count, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import type { MediaJobs } from '../media/media.service.js'
import type { VideoStore } from '../media/object-store.js'
import { DB } from '../tokens.js'
import type { Rejection } from './ffmpeg.js'
import { type VideoConfig, VIDEO_TYPES, type VideoType } from './video-config.js'
import { assertVideoEligible } from './video-eligibility.js'
import { VideoError } from './video-error.js'
import { originalKey, posterKey, quarantinedKey, renditionKey } from './video-keys.js'
import { type PostVideo, toPostVideo } from './video-view.js'

export const VIDEO_STORE = Symbol('VIDEO_STORE')
export const VIDEO_JOBS = Symbol('VIDEO_JOBS')
export const VIDEO_CONFIG = Symbol('VIDEO_CONFIG')

/** What the API needs from the queue: somewhere to send a finished upload. */
export interface VideoJobs {
  /** Queues an uploaded video for the worker. Safe to repeat. */
  processVideo(mediaId: string): Promise<void>
}

export { VideoError }

export type VideoState = 'uploading' | 'processing' | 'quarantined' | 'ready' | 'rejected' | 'failed'
export type VideoStatusView = { status: VideoState; reason: Rejection | null; video: PostVideo | null }

export type SignedPart = { partNumber: number; url: string; bytes: number }
export type UploadPlan = {
  mediaId: string
  partSize: number
  totalParts: number
  /** Parts storage already holds (after a reload), so only the rest are sent. */
  done: { partNumber: number; size: number }[]
  parts: SignedPart[]
}

/** A video ready for an hour that no post took is cleared, as images are. */
const UNATTACHED_AFTER_MS = 60 * 60 * 1000

@Injectable()
export class VideoService {
  private readonly log = new Logger(VideoService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VIDEO_STORE) private readonly store: VideoStore,
    @Inject(VIDEO_JOBS) private readonly jobs: VideoJobs & Pick<MediaJobs, 'purgeCdn'>,
    @Inject(VIDEO_CONFIG) private readonly cfg: VideoConfig,
  ) {}

  // --- Upload ---

  /**
   * Step 1: checks the request against the server's own limits (the client's
   * numbers are a courtesy), reserves a media ID, opens a multipart upload and
   * signs a URL per part. The browser sends the parts straight to storage.
   */
  async startUpload(ownerId: string, input: { contentType: VideoType; bytes: number; durationMs?: number }): Promise<UploadPlan> {
    const { contentType, bytes, durationMs } = input
    if (!VIDEO_TYPES.includes(contentType)) throw new VideoError('bad_type', 'that is not an MP4, MOV or WebM video')
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > this.cfg.maxBytes) {
      throw new VideoError('too_large', `a video can be at most ${Math.floor(this.cfg.maxBytes / (1024 * 1024))} MB`)
    }
    if (durationMs !== undefined && durationMs > this.cfg.maxSeconds * 1000) {
      throw new VideoError('too_long', `a video can be at most ${this.cfg.maxSeconds} seconds`)
    }
    await this.assertEligible(ownerId)

    const partSize = this.cfg.partBytes
    const [row] = await this.db.insert(media).values({ ownerId, kind: 'post_video', status: 'uploading', contentType, bytes }).returning({ id: media.id })
    const id = row!.id
    await this.db.insert(videoDetails).values({ mediaId: id, partSize })
    let uploadId: string
    try {
      uploadId = await this.store.createMultipart(originalKey(id), contentType)
    } catch (err) {
      await this.db.update(media).set({ status: 'deleted' }).where(eq(media.id, id))
      throw err
    }
    await this.db.update(videoDetails).set({ uploadId }).where(eq(videoDetails.mediaId, id))
    const totalParts = Math.ceil(bytes / partSize)
    return { mediaId: id, partSize, totalParts, done: [], parts: await this.sign(id, uploadId, bytes, partSize, range(totalParts)) }
  }

  /** After a reload: what is already uploaded, and fresh URLs for the rest. Owner only, until the window ends. */
  async resumeUpload(ownerId: string, mediaId: string): Promise<UploadPlan> {
    const { row, details } = await this.open(ownerId, mediaId)
    const partSize = details.partSize!
    const totalParts = Math.ceil(row.bytes / partSize)
    const held = await this.store.listParts(originalKey(mediaId), details.uploadId!).catch(() => null)
    if (!held) throw new VideoError('not_found', 'that upload has ended; start again')
    const have = new Set(held.map((p) => p.partNumber))
    const rest = range(totalParts).filter((n) => !have.has(n))
    return {
      mediaId,
      partSize,
      totalParts,
      done: held.map((p) => ({ partNumber: p.partNumber, size: p.size })),
      parts: await this.sign(mediaId, details.uploadId!, row.bytes, partSize, rest),
    }
  }

  /**
   * Step 2: the browser says every part is sent. Storage, not the client, is asked
   * which parts it holds; they must be exactly the declared size. Then the upload
   * is assembled and the video goes to the worker.
   */
  async completeUpload(ownerId: string, mediaId: string): Promise<VideoStatusView> {
    const [found] = await this.db.select().from(media).where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId), eq(media.kind, 'post_video')))
    if (!found || found.status === 'deleted') throw new VideoError('not_found', 'no such video')
    if (found.status !== 'uploading') {
      // Done already (a retried request): the same answer, and the job again in case the first was lost.
      if (found.status === 'processing') await this.jobs.processVideo(mediaId)
      return (await this.status(ownerId, mediaId))!
    }
    const { row, details } = await this.open(ownerId, mediaId)
    const partSize = details.partSize!
    const total = Math.ceil(row.bytes / partSize)
    const parts = await this.store.listParts(originalKey(mediaId), details.uploadId!).catch(() => null)
    if (!parts) throw new VideoError('bad_parts', 'that upload is no longer open; start again')
    const sizeOf = (n: number) => (n < total ? partSize : row.bytes - partSize * (total - 1))
    const exact = parts.length === total && parts.every((p, i) => p.partNumber === i + 1 && p.size === sizeOf(p.partNumber))
    if (!exact) throw new VideoError('bad_parts', 'the upload is incomplete; send the missing parts, then finish')

    await this.store.completeMultipart(originalKey(mediaId), details.uploadId!, parts)
    if ((await this.store.size('uploads', originalKey(mediaId))) !== row.bytes) {
      await this.store.remove('uploads', originalKey(mediaId))
      await this.db.update(media).set({ status: 'deleted' }).where(eq(media.id, mediaId))
      throw new VideoError('bad_parts', 'the uploaded file is not the size that was declared; start again')
    }
    await this.db.update(media).set({ status: 'processing' }).where(and(eq(media.id, mediaId), eq(media.status, 'uploading')))
    await this.db.update(videoDetails).set({ uploadId: null }).where(eq(videoDetails.mediaId, mediaId))
    await this.jobs.processVideo(mediaId)
    return (await this.status(ownerId, mediaId))!
  }

  // --- Reading ---

  /**
   * The uploader's own view of a video, whatever its state. Null when it is not
   * theirs, is gone, or is not a video: a stranger learns nothing. Readers see
   * a video only through a post, and only once it is `ready`.
   */
  async status(ownerId: string, mediaId: string): Promise<VideoStatusView | null> {
    const [row] = await this.db
      .select({ status: media.status, alt: media.alt, reason: videoDetails.rejectionReason })
      .from(media)
      .leftJoin(videoDetails, eq(videoDetails.mediaId, media.id))
      .where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId), eq(media.kind, 'post_video')))
    if (!row || row.status === 'deleted') return null
    switch (row.status) {
      case 'ready':
        return { status: 'ready', reason: null, video: await this.summary(mediaId) }
      // The uploader is not told a scanner matched; to them it simply cannot be used.
      case 'blocked':
        return { status: 'rejected', reason: null, video: null }
      case 'rejected':
        return { status: 'rejected', reason: row.reason, video: null }
      case 'pending':
      case 'uploading':
        return { status: 'uploading', reason: null, video: null }
      case 'failed':
        return { status: 'failed', reason: null, video: null }
      case 'processing':
      case 'quarantined':
        return { status: row.status, reason: null, video: null }
      default:
        return null
    }
  }

  /** A ready video's files and size, whether or not it is on a post yet. */
  private async summary(mediaId: string): Promise<PostVideo | null> {
    const [m] = await this.db
      .select({ alt: media.alt, durationMs: videoDetails.durationMs, width: videoDetails.width, height: videoDetails.height })
      .from(media)
      .innerJoin(videoDetails, eq(videoDetails.mediaId, media.id))
      .where(eq(media.id, mediaId))
    if (!m || m.durationMs === null || m.width === null || m.height === null) return null
    const renditions = await this.db
      .select({ height: videoRenditions.height, width: videoRenditions.width, bytes: videoRenditions.bytes })
      .from(videoRenditions)
      .where(eq(videoRenditions.mediaId, mediaId))
      .orderBy(videoRenditions.height)
    return toPostVideo({ id: mediaId, alt: m.alt, durationMs: m.durationMs, width: m.width, height: m.height, renditions })
  }

  // --- Removing ---

  /**
   * Drops a video the member has not put on a post. True when removed, false when it
   * is on a post (delete the post instead). Not theirs or gone: not found.
   */
  async remove(ownerId: string, mediaId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ status: media.status, postId: media.postId, uploadId: videoDetails.uploadId })
      .from(media)
      .leftJoin(videoDetails, eq(videoDetails.mediaId, media.id))
      .where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId), eq(media.kind, 'post_video')))
    if (!row || row.status === 'deleted') throw new VideoError('not_found', 'no such video')
    if (row.postId) return false
    // A video the scanner held or blocked is evidence: it is not the uploader's to delete.
    if (row.status === 'blocked' || row.status === 'quarantined') return false
    const claimed = await this.db
      .update(media)
      .set({ status: 'deleted' })
      .where(and(eq(media.id, mediaId), isNull(media.postId), inArray(media.status, ['pending', 'uploading', 'processing', 'ready', 'failed', 'rejected'])))
      .returning({ id: media.id })
    if (claimed.length === 0) return false
    await this.erase(mediaId, row.uploadId)
    return true
  }

  // --- Taking down (ADR 0019 section 4.3) ---

  /** Takes a post's videos out of public view, keeping the files privately. Idempotent. */
  async quarantinePostVideos(postId: string): Promise<void> {
    const rows = await this.db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.postId, postId), eq(media.kind, 'post_video'), eq(media.status, 'ready')))
    for (const { id } of rows) await this.quarantine(id)
  }

  /**
   * A report of illegal content hides the video at once, pending review. This is
   * deliberately unlike images: video costs more to leave up and to review.
   */
  hideReportedVideos(postId: string): Promise<void> {
    return this.quarantinePostVideos(postId)
  }

  /**
   * After a dismissed report: puts the video back if nothing else keeps it down. The post must be
   * neither removed nor deleted, and no other open illegal report may be on it.
   */
  async releaseIfCleared(postId: string): Promise<void> {
    const [post] = await this.db.select({ removedAt: posts.removedAt, deletedAt: posts.deletedAt }).from(posts).where(eq(posts.id, postId))
    if (!post || post.removedAt || post.deletedAt) return
    const [open] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.postId, postId), eq(reports.status, 'open'), eq(reports.reason, 'illegal')))
      .limit(1)
    if (open) return
    await this.releasePostVideos(postId)
  }

  /** Puts a restored post's videos back. Only ones the scanner cleared: a held video has no public files. Idempotent. */
  async releasePostVideos(postId: string): Promise<void> {
    const rows = await this.db
      .select({ id: media.id })
      .from(media)
      .innerJoin(videoDetails, eq(videoDetails.mediaId, media.id))
      .where(and(eq(media.postId, postId), eq(media.kind, 'post_video'), eq(media.status, 'quarantined'), eq(videoDetails.scanResult, 'clear')))
    for (const { id } of rows) {
      for (const key of await this.publishedKeys(id)) {
        if ((await this.store.size('uploads', quarantinedKey(key))) === null) continue
        await this.store.copy('uploads', quarantinedKey(key), 'media', key)
        await this.store.remove('uploads', quarantinedKey(key))
      }
      await this.db.update(media).set({ status: 'ready' }).where(eq(media.id, id))
    }
  }

  /**
   * The videos of a post its author deleted: removed, unless the post has an open
   * report, when they are kept privately so the author cannot destroy what a
   * moderator needs. Idempotent.
   */
  async discardPostVideos(postId: string): Promise<void> {
    const rows = await this.db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.postId, postId), eq(media.kind, 'post_video'), eq(media.status, 'ready')))
    const [reported] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.postId, postId), eq(reports.status, 'open')))
      .limit(1)
    for (const { id } of rows) {
      if (reported) await this.quarantine(id)
      else {
        await this.db.update(media).set({ status: 'deleted' }).where(eq(media.id, id))
        await this.erase(id, null)
      }
    }
  }

  /** Moves a published video's files to the private bucket, purges the CDN, then marks it quarantined. */
  private async quarantine(mediaId: string): Promise<void> {
    const keys = await this.publishedKeys(mediaId)
    // Files move before the row changes, so a failure part-way is finished by the hourly sweep.
    for (const key of keys) {
      if ((await this.store.size('media', key)) === null) continue
      await this.store.copy('media', key, 'uploads', quarantinedKey(key))
      await this.store.remove('media', key)
    }
    // Out of the bucket, but Cloudflare may still hold a cached copy.
    await this.jobs.purgeCdn(keys)
    await this.db.update(media).set({ status: 'quarantined' }).where(eq(media.id, mediaId))
  }

  /** Every public file a published video has: its renditions and its poster. */
  private async publishedKeys(mediaId: string): Promise<string[]> {
    const rows = await this.db.select({ height: videoRenditions.height }).from(videoRenditions).where(eq(videoRenditions.mediaId, mediaId))
    return [...rows.map((r) => renditionKey(mediaId, r.height)), posterKey(mediaId)]
  }

  /** Deletes every file of a video that is no longer wanted: an open upload, the original, the public files. */
  private async erase(mediaId: string, uploadId: string | null): Promise<void> {
    if (uploadId) await this.store.abortMultipart(originalKey(mediaId), uploadId)
    await this.store.remove('uploads', originalKey(mediaId))
    for (const key of await this.publishedKeys(mediaId)) await this.store.remove('media', key)
  }

  // --- The hourly sweep ---

  /**
   * Clears uploads nobody finished within the window (aborting the open multipart
   * upload), videos never put on a post, and re-quarantines a video whose post was
   * removed but whose files are still public. `processing` is never swept: the
   * worker owns it, and a stuck one shows up in its logs.
   */
  async sweepAbandoned(): Promise<void> {
    const stale = await this.db
      .update(media)
      .set({ status: 'deleted' })
      .where(and(eq(media.kind, 'post_video'), inArray(media.status, ['pending', 'uploading']), lt(media.createdAt, new Date(Date.now() - this.cfg.uploadWindowMs))))
      .returning({ id: media.id })
    for (const { id } of stale) {
      const [d] = await this.db.select({ uploadId: videoDetails.uploadId }).from(videoDetails).where(eq(videoDetails.mediaId, id))
      await this.erase(id, d?.uploadId ?? null)
    }

    // One conditional update, so a video being attached to a post right now is attached or swept, never both.
    const unused = await this.db
      .update(media)
      .set({ status: 'deleted' })
      .where(and(eq(media.kind, 'post_video'), eq(media.status, 'ready'), isNull(media.postId), lt(media.readyAt, new Date(Date.now() - UNATTACHED_AFTER_MS))))
      .returning({ id: media.id })
    for (const { id } of unused) await this.erase(id, null)

    const exposed = await this.db
      .select({ id: media.id })
      .from(media)
      .innerJoin(posts, eq(posts.id, media.postId))
      .where(and(eq(media.kind, 'post_video'), eq(media.status, 'ready'), isNotNull(posts.removedAt)))
    for (const { id } of exposed) await this.quarantine(id)

    // A report of illegal content hides the video at once; if that hide failed (storage down), it is finished here.
    const reported = await this.db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.kind, 'post_video'),
          eq(media.status, 'ready'),
          sql`exists (select 1 from reports r where r.post_id = ${media.postId} and r.status = 'open' and r.reason = 'illegal')`,
        ),
      )
    for (const { id } of reported) await this.quarantine(id)
    const hidden = exposed.length + reported.length
    if (stale.length + unused.length + hidden > 0) {
      this.log.log(`video sweep: ${stale.length} abandoned uploads, ${unused.length} unused videos, ${hidden} re-quarantined`)
    }
  }

  // --- Checks ---

  private assertEligible(ownerId: string): Promise<void> {
    return assertVideoEligible(this.db, ownerId, this.cfg)
  }

  /** The member's own open upload, within its window. Anything else is not found. */
  private async open(ownerId: string, mediaId: string) {
    const [found] = await this.db
      .select({ row: media, details: videoDetails })
      .from(media)
      .innerJoin(videoDetails, eq(videoDetails.mediaId, media.id))
      .where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId), eq(media.kind, 'post_video'), eq(media.status, 'uploading')))
    if (!found || !found.details.uploadId || !found.details.partSize) throw new VideoError('not_found', 'no such upload')
    if (Date.now() - found.row.createdAt.getTime() > this.cfg.uploadWindowMs) throw new VideoError('not_found', 'that upload has expired; start again')
    return found
  }

  private async sign(mediaId: string, uploadId: string, bytes: number, partSize: number, numbers: number[]): Promise<SignedPart[]> {
    const total = Math.ceil(bytes / partSize)
    return Promise.all(
      numbers.map(async (partNumber) => {
        const size = partNumber < total ? partSize : bytes - partSize * (total - 1)
        return { partNumber, bytes: size, url: await this.store.presignPart(originalKey(mediaId), uploadId, partNumber, size) }
      }),
    )
  }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
