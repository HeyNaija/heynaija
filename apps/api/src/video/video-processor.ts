import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Db, media, reports, videoDetails, videoRenditions } from '@heynaija/db'
import { Logger } from '@nestjs/common'
import { UnrecoverableError } from 'bullmq'
import { and, eq, sql } from 'drizzle-orm'
import { type ContentScanner, type FrameScan } from '../media/media.service.js'
import type { VideoStore } from '../media/object-store.js'
import type { SafetyAlerts } from '../moderation/safety-alerts.js'
import { checkLimits, type Deadline, DurationMismatch, extractFrames, extractPoster, FFMPEG_SAFETY, FfmpegTimeout, newDeadline, type Probe, probe, type Rejection, renditionPlan, transcode } from './ffmpeg.js'
import type { VideoConfig } from './video-config.js'
import { originalKey, posterKey, quarantineOriginalKey, renditionKey } from './video-keys.js'

/**
 * The video worker's job (ADR 0019 section 3.5): probe, refuse what is over a
 * limit, take sample frames from the original, scan them, and only then encode
 * and publish. Nothing is public until the scan is clear and the encode is done,
 * and `ready` is set last, in a conditional update.
 *
 * Fail closed. A video is made `ready` on one verdict only: the scanner said
 * `clear`. No scanner (or no frame scanning in it) keeps the video `quarantined`
 * with its original kept privately; a match blocks it; a scanner that cannot
 * answer throws so the job is retried.
 */
export class VideoProcessor {
  private readonly log = new Logger(VideoProcessor.name)

  constructor(
    private readonly db: Db,
    private readonly store: VideoStore,
    private readonly scanner: ContentScanner,
    private readonly cfg: VideoConfig,
    private readonly alerts?: SafetyAlerts,
    private readonly workDir: string = tmpdir(),
    /** One limit for every ffmpeg run of a job: the whole job, not each run, is bounded. */
    private readonly jobTimeoutMs: number = FFMPEG_SAFETY.jobTimeoutMs,
  ) {}

  /**
   * Runs one queued video. Returns for a finished job and for a permanent refusal
   * (no retry); throws when a retry could help. On the last attempt a throw also
   * leaves the video `failed`.
   */
  async process(mediaId: string, { lastAttempt }: { lastAttempt: boolean }): Promise<void> {
    const [row] = await this.db
      .select({ ownerId: media.ownerId, status: media.status })
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.kind, 'post_video')))
    if (row?.status !== 'processing') return

    await this.db.update(videoDetails).set({ attempts: sql`${videoDetails.attempts} + 1` }).where(eq(videoDetails.mediaId, mediaId))
    const work = await mkdtemp(join(this.workDir, `video-${mediaId}-`))
    try {
      await this.run(mediaId, row.ownerId, work, newDeadline(this.jobTimeoutMs))
    } catch (err) {
      const message = (err as Error).message
      // A timeout will happen again with the same file: fail it now and tell the queue not to retry.
      const permanent = err instanceof FfmpegTimeout
      this.log.warn(`video ${mediaId} failed${lastAttempt || permanent ? ' for good' : ', will retry'}: ${message}`)
      if (lastAttempt || permanent) {
        await this.db.update(media).set({ status: 'failed' }).where(and(eq(media.id, mediaId), eq(media.status, 'processing')))
        await this.db.update(videoDetails).set({ failureReason: message.slice(0, 500) }).where(eq(videoDetails.mediaId, mediaId))
        await this.store.remove('uploads', originalKey(mediaId))
      }
      throw permanent ? new UnrecoverableError(message) : err
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  private async run(mediaId: string, ownerId: string, work: string, deadline: Deadline): Promise<void> {
    const original = join(work, 'original')
    await this.store.download('uploads', originalKey(mediaId), original)
    const bytes = (await stat(original)).size
    const sha256 = await sha256Of(original)

    const p = await probe(original, deadline)
    const refusal = checkLimits(p, bytes, this.cfg)
    if (refusal || !p) return this.reject(mediaId, refusal ?? 'not_a_video')

    let frames
    try {
      frames = await extractFrames(original, join(work, 'frames'), p.durationMs, this.cfg.maxSeconds, deadline)
    } catch (err) {
      // More video than the container admits to: refused, not scanned in part.
      if (err instanceof DurationMismatch) return this.reject(mediaId, 'not_a_video')
      throw err
    }
    // Defence in depth: an empty sample must never count as "nothing found".
    if (frames.length === 0) throw new Error('no frames could be sampled from the video, so nothing was scanned')
    // Throws when the scanner cannot answer: the job is retried, nothing is published.
    const scan: FrameScan = this.scanner.scanFrames
      ? await this.scanner.scanFrames(frames.map((f) => f.jpeg))
      : { verdict: 'unscanned', matchIndex: null }
    await this.db
      .update(videoDetails)
      .set({ originalSha256: sha256, durationMs: p.durationMs, width: p.width, height: p.height, fps: p.fps, framesScanned: frames.length, scanResult: scan.verdict })
      .where(eq(videoDetails.mediaId, mediaId))

    if (scan.verdict === 'match') return this.block(mediaId, ownerId, frames[scan.matchIndex ?? 0]?.ms ?? null)
    if (scan.verdict !== 'clear') return this.hold(mediaId)
    return this.publish(mediaId, original, p, work, deadline)
  }

  /** A permanent refusal: a reason class the uploader can be told, the original deleted, no retry. */
  private async reject(mediaId: string, reason: Rejection): Promise<void> {
    await this.db.update(videoDetails).set({ rejectionReason: reason }).where(eq(videoDetails.mediaId, mediaId))
    await this.db.update(media).set({ status: 'rejected' }).where(and(eq(media.id, mediaId), eq(media.status, 'processing')))
    await this.store.remove('uploads', originalKey(mediaId))
    this.log.log(`video ${mediaId} rejected: ${reason}`)
  }

  /** Keeps the original privately, where evidence belongs, by server-side copy. */
  private async keepPrivately(mediaId: string): Promise<void> {
    await this.store.copy('uploads', originalKey(mediaId), 'uploads', quarantineOriginalKey(mediaId))
    await this.store.remove('uploads', originalKey(mediaId))
  }

  /** No scanner has cleared it: held quarantined. Never made ready, whatever else is true. */
  private async hold(mediaId: string): Promise<void> {
    await this.keepPrivately(mediaId)
    await this.db.update(media).set({ status: 'quarantined' }).where(and(eq(media.id, mediaId), eq(media.status, 'processing')))
    this.log.warn(`video ${mediaId} is held in quarantine: NO UPLOAD SCANNER IS CONFIGURED, so no video can be published (docs/safety/video-scanning.md)`)
  }

  /** A match: as for images, the original is kept, the account goes to the moderation queue and safety is alerted. */
  private async block(mediaId: string, ownerId: string, frameMs: number | null): Promise<void> {
    await this.keepPrivately(mediaId)
    await this.db.update(videoDetails).set({ matchFrameMs: frameMs }).where(eq(videoDetails.mediaId, mediaId))
    await this.db.update(media).set({ status: 'blocked' }).where(and(eq(media.id, mediaId), eq(media.status, 'processing')))
    await this.db.insert(reports).values({
      reporterId: null,
      memberId: ownerId,
      reason: 'illegal',
      details:
        `The upload scanner matched a frame of a video this account uploaded (media ${mediaId}) with known child sexual abuse material. ` +
        'It was never published, and the original is kept privately. Do not try to view it: suspend the account and follow the safety runbook.',
    })
    await this.alerts?.alert('An upload matched known abuse material', [
      `The scanner blocked a video (media ${mediaId}) uploaded by member ${ownerId}. It was not published.`,
      'The account is waiting in the moderation queue.',
    ])
  }

  private async publish(mediaId: string, original: string, p: Probe, work: string, deadline: Deadline): Promise<void> {
    const plan = renditionPlan(p)
    const outputs = plan.map((r) => join(work, `${r.label}.mp4`))
    await transcode(original, outputs, p, this.cfg, deadline)
    const poster = await extractPoster(original, join(work, 'poster-source.jpg'), p.durationMs, deadline)
    await writeFile(join(work, 'poster.webp'), poster)

    const sizes: number[] = []
    for (const [i, r] of plan.entries()) {
      await this.store.upload('media', renditionKey(mediaId, r.label), outputs[i]!, 'video/mp4')
      sizes.push((await stat(outputs[i]!)).size)
    }
    await this.store.write('media', posterKey(mediaId), poster, 'image/webp')

    const ready = await this.db.transaction(async (tx) => {
      // Last, and conditional: a video abandoned while we worked is not published.
      const done = await tx
        .update(media)
        .set({ status: 'ready', readyAt: new Date(), width: p.width, height: p.height })
        .where(and(eq(media.id, mediaId), eq(media.status, 'processing')))
        .returning({ id: media.id })
      if (done.length === 0) return false
      await tx.delete(videoRenditions).where(eq(videoRenditions.mediaId, mediaId))
      await tx.insert(videoRenditions).values(
        plan.map((r, i) => ({ mediaId, height: r.label, width: r.width, bytes: sizes[i]!, bitrateKbps: r.videoKbps + (p.hasAudio ? r.audioKbps : 0) })),
      )
      await tx.update(videoDetails).set({ posterKey: posterKey(mediaId) }).where(eq(videoDetails.mediaId, mediaId))
      return true
    })
    if (!ready) {
      for (const r of plan) await this.store.remove('media', renditionKey(mediaId, r.label))
      await this.store.remove('media', posterKey(mediaId))
      await this.store.remove('uploads', originalKey(mediaId))
      return
    }
    if (!this.cfg.keepOriginals) await this.store.remove('uploads', originalKey(mediaId))
  }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
