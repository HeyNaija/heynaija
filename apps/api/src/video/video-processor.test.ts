import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import { media, members, reports, videoDetails, videoRenditions } from '@heynaija/db'
import { UnrecoverableError } from 'bullmq'
import { eq } from 'drizzle-orm'
import { type ContentScanner, type FrameScan, NoScanner } from '../media/media.service.js'
import type { SafetyAlerts } from '../moderation/safety-alerts.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { MemoryVideoStore } from './memory-video-store.js'
import { DEFAULT_VIDEO_CONFIG as defaults } from './video-config.js'
import { originalKey, posterKey, quarantineOriginalKey, renditionKey } from './video-keys.js'
import { VideoProcessor } from './video-processor.js'

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const skip = !hasFfmpeg && 'ffmpeg and ffprobe are not installed here; the processor needs the real binaries'

const ada = randomUUID()
let dir: string
let clipBytes: Buffer
let store: MemoryVideoStore
const alerts: { subject: string; lines: string[] }[] = []
const safety: SafetyAlerts = { alert: async (subject, lines) => void alerts.push({ subject, lines }) }

class Scanner implements ContentScanner {
  seen: { frames: number; publicFiles: number }[] = []
  constructor(private readonly verdict: () => FrameScan | Error | Promise<FrameScan | Error>) {}
  async scan(): Promise<'clear'> {
    return 'clear'
  }
  async scanFrames(frames: Buffer[]): Promise<FrameScan> {
    // Nothing is public yet when the scan runs: scan first, then encode.
    this.seen.push({ frames: frames.length, publicFiles: store.keys('media').length })
    const v = await this.verdict()
    if (v instanceof Error) throw v
    return v
  }
}
const clear = () => new Scanner(() => ({ verdict: 'clear', matchIndex: null }))

before(async () => {
  await migrate()
  if (skip) return
  dir = await mkdtemp(join(tmpdir(), 'processor-test-'))
  const path = join(dir, 'clip.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=854x480:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path], { stdio: 'ignore' })
  clipBytes = await readFile(path)
})
after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  await pool.end()
})
beforeEach(async () => {
  await reset()
  await db.insert(members).values({ id: ada, handle: 'ada' })
  store = new MemoryVideoStore()
  alerts.length = 0
})

/** A video that has finished uploading and waits for the worker. */
const queued = async (body: Buffer = clipBytes) => {
  const [row] = await db.insert(media).values({ ownerId: ada, kind: 'post_video', status: 'processing', contentType: 'video/mp4', bytes: body.length }).returning({ id: media.id })
  await db.insert(videoDetails).values({ mediaId: row!.id, partSize: 5 * 1024 * 1024 })
  store.putOriginal(originalKey(row!.id), body)
  return row!.id
}
const processor = (scanner: ContentScanner, cfg = defaults, jobTimeoutMs?: number) => new VideoProcessor(db, store, scanner, cfg, safety, dir, jobTimeoutMs)
const rowOf = async (id: string) => (await db.select().from(media).where(eq(media.id, id)))[0]!
const detailsOf = async (id: string) => (await db.select().from(videoDetails).where(eq(videoDetails.mediaId, id)))[0]!

test('a clear video is probed, scanned, encoded, published and only then made ready; the original goes', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  const scanner = clear()
  await processor(scanner).process(id, { lastAttempt: false })

  assert.deepEqual(scanner.seen.map((s) => s.publicFiles), [0], 'scanned before anything was written publicly')
  assert.ok(scanner.seen[0]!.frames >= 4)
  const row = await rowOf(id)
  assert.equal(row.status, 'ready')
  assert.deepEqual([row.width, row.height], [854, 480])
  assert.ok(row.readyAt)
  assert.deepEqual(store.keys('media'), [renditionKey(id, 240), renditionKey(id, 360), renditionKey(id, 480), posterKey(id)].sort())
  assert.deepEqual(store.keys('uploads'), [], 'the original is deleted on success')
  const renditions = await db.select().from(videoRenditions).where(eq(videoRenditions.mediaId, id)).orderBy(videoRenditions.height)
  assert.deepEqual(renditions.map((r) => [r.height, r.width]), [[240, 428], [360, 640], [480, 854]]) // 854 wide at 240 high is 426.97, rounded to the even 428
  assert.ok(renditions.every((r) => r.bytes > 1000 && r.bitrateKbps > 0))
  const d = await detailsOf(id)
  assert.equal(d.scanResult, 'clear')
  assert.equal(d.originalSha256, createHash('sha256').update(clipBytes).digest('hex'))
  assert.ok(Math.abs(d.durationMs! - 4000) < 200)
  assert.deepEqual([d.width, d.height, d.posterKey], [854, 480, posterKey(id)])
  assert.ok(d.framesScanned! >= 4)
  assert.deepEqual((await readdir(dir)).filter((f) => f.startsWith('video-')), [], 'scratch space is cleaned up')
})

test('with no scanner bound a video is NEVER made ready: it is held quarantined, nothing is published, the original is kept privately', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  await processor(new NoScanner()).process(id, { lastAttempt: false })
  const row = await rowOf(id)
  assert.equal(row.status, 'quarantined')
  assert.equal(row.readyAt, null)
  assert.deepEqual(store.keys('media'), [])
  assert.deepEqual(store.keys('uploads'), [quarantineOriginalKey(id)])
  assert.equal((await detailsOf(id)).scanResult, 'unscanned')
  assert.equal(await db.$count(videoRenditions), 0)
})

test('a scanner without scanFrames counts as no scanner', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  await processor({ scan: async () => 'clear' }).process(id, { lastAttempt: false })
  assert.equal((await rowOf(id)).status, 'quarantined')
})

test('a match blocks the video: original kept privately, a report and an alert, nothing public, the frame time recorded', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  await processor(new Scanner(() => ({ verdict: 'match', matchIndex: 2 }))).process(id, { lastAttempt: false })
  const row = await rowOf(id)
  assert.equal(row.status, 'blocked')
  assert.deepEqual(store.keys('media'), [])
  assert.deepEqual(store.keys('uploads'), [quarantineOriginalKey(id)])
  const d = await detailsOf(id)
  assert.deepEqual([d.scanResult, d.matchFrameMs], ['match', 2000])
  const [report] = await db.select().from(reports)
  assert.deepEqual([report!.reason, report!.memberId, report!.reporterId], ['illegal', ada, null])
  assert.match(report!.details, new RegExp(id))
  assert.equal(alerts.length, 1)
  assert.ok(alerts[0]!.lines.join(' ').includes(id))
})

test('over a limit is rejected for good: a reason class, original deleted, no retry (it returns, it does not throw)', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  const scanner = clear()
  await processor(scanner, { ...defaults, maxSeconds: 2, minSeconds: 0 }).process(id, { lastAttempt: false })
  const row = await rowOf(id)
  assert.equal(row.status, 'rejected')
  assert.equal((await detailsOf(id)).rejectionReason, 'too_long')
  assert.deepEqual(store.keys('uploads'), [])
  assert.deepEqual(store.keys('media'), [])
  assert.equal(scanner.seen.length, 0, 'an over-limit video is not even scanned')
})

test('a file that is not a video is rejected as such', { timeout: 60_000, skip }, async () => {
  const id = await queued(Buffer.from('definitely not a video'))
  await processor(clear()).process(id, { lastAttempt: false })
  assert.equal((await rowOf(id)).status, 'rejected')
  assert.equal((await detailsOf(id)).rejectionReason, 'not_a_video')
})

test('the real file size is checked, not the declared one', { skip, timeout: 60_000 }, async () => {
  const id = await queued()
  await processor(clear(), { ...defaults, maxBytes: 1000 }).process(id, { lastAttempt: false })
  assert.equal((await detailsOf(id)).rejectionReason, 'too_large')
})

test('a scanner that cannot answer throws so the job retries, leaving the video processing; the last attempt marks it failed', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  const down = new Scanner(() => new Error('PhotoDNA gave no answer (HTTP 429)'))
  await assert.rejects(() => processor(down).process(id, { lastAttempt: false }), /PhotoDNA gave no answer/)
  assert.equal((await rowOf(id)).status, 'processing')
  assert.equal((await detailsOf(id)).attempts, 1)
  assert.deepEqual(store.keys('media'), [])
  assert.equal(store.keys('uploads').length, 1, 'the original is still there for the retry')

  await assert.rejects(() => processor(down).process(id, { lastAttempt: true }), /PhotoDNA gave no answer/)
  assert.equal((await rowOf(id)).status, 'failed')
  assert.match((await detailsOf(id)).failureReason!, /PhotoDNA gave no answer/)
  assert.deepEqual(store.keys('uploads'), [], 'a failed video’s original is deleted')
})

test('a job for a video that is no longer processing does nothing', { skip }, async () => {
  const id = await queued()
  await db.update(media).set({ status: 'deleted' }).where(eq(media.id, id))
  const scanner = clear()
  await processor(scanner).process(id, { lastAttempt: false })
  assert.equal(scanner.seen.length, 0)
  await processor(scanner).process(randomUUID(), { lastAttempt: false })
})

test('abandoned while it was being processed: nothing it wrote is left public', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  const scanner = new Scanner(async () => {
    // The owner deletes the video while the worker is mid-job (scan done, encode next).
    await db.update(media).set({ status: 'deleted' }).where(eq(media.id, id))
    return { verdict: 'clear', matchIndex: null }
  })
  await processor(scanner).process(id, { lastAttempt: false })
  assert.equal((await rowOf(id)).status, 'deleted')
  assert.deepEqual(store.keys('media'), [])
})

test('keeping originals is a setting, off by default', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  await processor(clear(), { ...defaults, keepOriginals: true }).process(id, { lastAttempt: false })
  assert.equal((await rowOf(id)).status, 'ready')
  assert.deepEqual(store.keys('uploads'), [originalKey(id)])
})

test('a rerun after success changes nothing (idempotent)', { skip, timeout: 120_000 }, async () => {
  const id = await queued()
  await processor(clear()).process(id, { lastAttempt: false })
  const before = store.keys('media')
  await processor(clear()).process(id, { lastAttempt: false })
  assert.deepEqual(store.keys('media'), before)
  assert.equal((await rowOf(id)).status, 'ready')
})

test('a timeout is permanent: the video is failed at once, the job is unrecoverable (no three retries of a five minute encode)', { skip, timeout: 60_000 }, async () => {
  const id = await queued()
  const scanner = clear()
  await assert.rejects(() => processor(scanner, defaults, 1).process(id, { lastAttempt: false }), (err: Error) => err instanceof UnrecoverableError && /timed out/.test(err.message))
  assert.equal((await rowOf(id)).status, 'failed')
  assert.match((await detailsOf(id)).failureReason!, /timed out/)
  assert.deepEqual(store.keys('uploads'), [])
  assert.equal(scanner.seen.length, 0)
})

test('a file whose container lies about its length is rejected, never scanned short and published long', { skip, timeout: 120_000 }, async () => {
  const raw = join(dir, 'long.webm')
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=30', '-c:v', 'libvpx', '-b:v', '50k', '-an', raw], { stdio: 'ignore' })
  } catch {
    return // no libvpx here: the same behaviour is pinned in ffmpeg.test.ts where it can be generated
  }
  const d = await readFile(raw)
  let patched = false
  for (let i = d.indexOf(Buffer.from([0x44, 0x89])); i >= 0 && !patched; i = d.indexOf(Buffer.from([0x44, 0x89]), i + 1)) {
    if (d[i + 2] === 0x88) (d.writeDoubleBE(4000, i + 3), (patched = true))
    else if (d[i + 2] === 0x84) (d.writeFloatBE(4000, i + 3), (patched = true))
  }
  assert.ok(patched)
  const id = await queued(d)
  const scanner = clear()
  await processor(scanner, { ...defaults, minSeconds: 0 }).process(id, { lastAttempt: false })
  assert.equal((await rowOf(id)).status, 'rejected')
  assert.equal(scanner.seen.length, 0)
  assert.deepEqual(store.keys('media'), [])
})
