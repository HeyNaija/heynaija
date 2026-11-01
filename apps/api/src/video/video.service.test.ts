import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { media, members, moderationActions, posts, videoDetails, videoRenditions } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { MemoryVideoStore } from './memory-video-store.js'
import { DEFAULT_VIDEO_CONFIG as defaults } from './video-config.js'
import { originalKey, posterKey, quarantineOriginalKey, renditionKey } from './video-keys.js'
import { VideoError, VideoService } from './video.service.js'

const MIB = 1024 * 1024
const ada = randomUUID()
const bayo = randomUUID()
const newbie = randomUUID()

class Jobs {
  readonly processed: string[] = []
  readonly purged: string[][] = []
  async processVideo(id: string) {
    this.processed.push(id)
  }
  async purgeCdn(keys: string[]) {
    this.purged.push(keys)
  }
}

let store: MemoryVideoStore
let jobs: Jobs
let service: VideoService
const make = (cfg = defaults) => new VideoService(db, store, jobs, cfg)

before(migrate)
beforeEach(async () => {
  await reset()
  const old = new Date(Date.now() - 30 * 86_400_000)
  await db.insert(members).values([
    { id: ada, handle: 'ada', createdAt: old },
    { id: bayo, handle: 'bayo', createdAt: old },
    { id: newbie, handle: 'newbie' },
  ])
  store = new MemoryVideoStore()
  jobs = new Jobs()
  service = make()
})
after(() => pool.end())

const refusal = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch (err) {
    assert.ok(err instanceof VideoError, String(err))
    return err.code
  }
  return null
}

/** Starts an upload of `bytes` and sends every part, as a browser would. */
const upload = async (owner = ada, bytes = 11 * MIB, contentType = 'video/mp4' as const) => {
  const started = await service.startUpload(owner, { contentType, bytes })
  const [row] = await db.select().from(videoDetails).where(eq(videoDetails.mediaId, started.mediaId))
  for (const p of started.parts) store.putPart(row!.uploadId!, p.partNumber, Buffer.alloc(p.bytes, p.partNumber))
  return { ...started, uploadId: row!.uploadId! }
}

/** A video that has been processed and published, as the worker leaves it. */
const publish = async (owner = ada, over: Partial<typeof media.$inferInsert> = {}) => {
  const [row] = await db
    .insert(media)
    .values({ ownerId: owner, kind: 'post_video', status: 'ready', contentType: 'video/mp4', bytes: 1000, width: 640, height: 360, readyAt: new Date(), ...over })
    .returning({ id: media.id })
  const id = row!.id
  await db.insert(videoDetails).values({ mediaId: id, durationMs: 12_000, width: 640, height: 360, posterKey: posterKey(id), scanResult: 'clear' })
  await db.insert(videoRenditions).values([240, 360].map((h) => ({ mediaId: id, height: h, width: h * 2, bytes: h * 100, bitrateKbps: 300 })))
  for (const key of [renditionKey(id, 240), renditionKey(id, 360), posterKey(id)]) store.objects.set(`media/${key}`, Buffer.from(key))
  return id
}

const post = async (authorId = ada, removed = false) => {
  const [row] = await db.insert(posts).values({ authorId, text: 'hi', removedAt: removed ? new Date() : null }).returning({ id: posts.id })
  return row!.id
}

// --- Starting ---

test('start: reserves an owned uploading row and returns a signed URL per 5 MiB part, straight to storage', async () => {
  const started = await service.startUpload(ada, { contentType: 'video/mp4', bytes: 11 * MIB })
  assert.equal(started.partSize, 5 * MIB)
  assert.equal(started.totalParts, 3)
  assert.deepEqual(started.parts.map((p) => [p.partNumber, p.bytes]), [[1, 5 * MIB], [2, 5 * MIB], [3, 1 * MIB]])
  assert.ok(started.parts.every((p) => p.url.startsWith('memory://part/')))
  const [row] = await db.select().from(media).where(eq(media.id, started.mediaId))
  assert.deepEqual([row!.ownerId, row!.kind, row!.status, row!.contentType, row!.bytes], [ada, 'post_video', 'uploading', 'video/mp4', 11 * MIB])
  const [d] = await db.select().from(videoDetails).where(eq(videoDetails.mediaId, started.mediaId))
  assert.ok(d!.uploadId)
  assert.equal(d!.partSize, 5 * MIB)
})

test('start: never trusts the client — type, size and a too-long claimed duration are refused server-side', async () => {
  assert.equal(await refusal(() => service.startUpload(ada, { contentType: 'video/mp4', bytes: defaults.maxBytes + 1 })), 'too_large')
  assert.equal(await refusal(() => service.startUpload(ada, { contentType: 'video/mp4', bytes: 0 })), 'too_large')
  assert.equal(await refusal(() => service.startUpload(ada, { contentType: 'image/png' as never, bytes: 1000 })), 'bad_type')
  assert.equal(await refusal(() => service.startUpload(ada, { contentType: 'video/mp4', bytes: 1000, durationMs: 61_000 })), 'too_long')
  assert.equal((await service.startUpload(ada, { contentType: 'video/mp4', bytes: defaults.maxBytes, durationMs: 60_000 })).totalParts, 20)
})

test('start: accounts under 7 days old, and members with a recent upheld action, are not eligible', async () => {
  assert.equal(await refusal(() => service.startUpload(newbie, { contentType: 'video/mp4', bytes: 1000 })), 'not_eligible')
  assert.ok(await make({ ...defaults, minAccountAgeDays: 0 }).startUpload(newbie, { contentType: 'video/mp4', bytes: 1000 }))

  const mod = randomUUID()
  await db.insert(members).values({ id: mod, handle: 'mod' })
  const badPost = await post(bayo)
  await db.insert(moderationActions).values({ actorId: mod, action: 'remove_post', postId: badPost })
  assert.equal(await refusal(() => service.startUpload(bayo, { contentType: 'video/mp4', bytes: 1000 })), 'not_eligible')

  // Old enough that it no longer counts.
  await db.update(moderationActions).set({ createdAt: new Date(Date.now() - 91 * 86_400_000) })
  assert.ok(await service.startUpload(bayo, { contentType: 'video/mp4', bytes: 1000 }))

  await db.insert(moderationActions).values({ actorId: mod, action: 'suspend_member', memberId: ada })
  assert.equal(await refusal(() => service.startUpload(ada, { contentType: 'video/mp4', bytes: 1000 })), 'not_eligible')
})

test('start: a member whose upload the scanner blocked is not eligible either', async () => {
  await publish(ada, { status: 'blocked' })
  assert.equal(await refusal(() => service.startUpload(ada, { contentType: 'video/mp4', bytes: 1000 })), 'not_eligible')
})

test('start: at most 50 live videos a member (a setting)', async () => {
  const small = make({ ...defaults, maxLivePerMember: 2 })
  for (let i = 0; i < 2; i++) await publish(ada, { postId: await post(ada) })
  assert.equal(await refusal(() => small.startUpload(ada, { contentType: 'video/mp4', bytes: 1000 })), 'too_many_videos')
  assert.ok(await small.startUpload(bayo, { contentType: 'video/mp4', bytes: 1000 }))
})

// --- Resuming and completing ---

test('resume: lists the parts storage holds and signs URLs only for the rest', async () => {
  const started = await service.startUpload(ada, { contentType: 'video/mp4', bytes: 11 * MIB })
  const [d] = await db.select().from(videoDetails).where(eq(videoDetails.mediaId, started.mediaId))
  store.putPart(d!.uploadId!, 1, Buffer.alloc(5 * MIB))
  const resumed = await service.resumeUpload(ada, started.mediaId)
  assert.deepEqual(resumed.done.map((p) => p.partNumber), [1])
  assert.deepEqual(resumed.parts.map((p) => p.partNumber), [2, 3])
  assert.equal(resumed.totalParts, 3)
})

test('resume, complete, status and remove are the owner’s alone: anyone else gets not found', async () => {
  const up = await upload(ada)
  for (const run of [
    () => service.resumeUpload(bayo, up.mediaId),
    () => service.completeUpload(bayo, up.mediaId),
    () => service.remove(bayo, up.mediaId),
  ]) {
    assert.equal(await refusal(run), 'not_found')
  }
  assert.equal(await service.status(bayo, up.mediaId), null)
  assert.equal(await service.status(ada, up.mediaId).then((s) => s?.status), 'uploading')
})

test('complete: assembles the upload, checks the size, moves to processing and queues the job once', async () => {
  const up = await upload(ada)
  const done = await service.completeUpload(ada, up.mediaId)
  assert.equal(done.status, 'processing')
  assert.equal(await store.size('uploads', originalKey(up.mediaId)), 11 * MIB)
  assert.deepEqual(jobs.processed, [up.mediaId])
  // A retried request: same answer, the job is queued again in case the first was lost.
  assert.equal((await service.completeUpload(ada, up.mediaId)).status, 'processing')
  assert.deepEqual(jobs.processed, [up.mediaId, up.mediaId])
})

test('complete: a missing part is refused and the upload stays open to finish', async () => {
  const started = await service.startUpload(ada, { contentType: 'video/mp4', bytes: 11 * MIB })
  const [d] = await db.select().from(videoDetails).where(eq(videoDetails.mediaId, started.mediaId))
  store.putPart(d!.uploadId!, 1, Buffer.alloc(5 * MIB))
  store.putPart(d!.uploadId!, 3, Buffer.alloc(1 * MIB))
  assert.equal(await refusal(() => service.completeUpload(ada, started.mediaId)), 'bad_parts')
  assert.equal((await service.status(ada, started.mediaId))?.status, 'uploading')
  assert.deepEqual(jobs.processed, [])
  store.putPart(d!.uploadId!, 2, Buffer.alloc(5 * MIB))
  assert.equal((await service.completeUpload(ada, started.mediaId)).status, 'processing')
})

test('complete: parts that add up to a different size than declared are refused', async () => {
  const started = await service.startUpload(ada, { contentType: 'video/mp4', bytes: 11 * MIB })
  const [d] = await db.select().from(videoDetails).where(eq(videoDetails.mediaId, started.mediaId))
  store.putPart(d!.uploadId!, 1, Buffer.alloc(5 * MIB))
  store.putPart(d!.uploadId!, 2, Buffer.alloc(5 * MIB))
  store.putPart(d!.uploadId!, 3, Buffer.alloc(3 * MIB)) // declared 1 MiB
  assert.equal(await refusal(() => service.completeUpload(ada, started.mediaId)), 'bad_parts')
})

// --- Status ---

test('status: what the uploader is told for each state, and never why a scanner blocked it', async () => {
  const states: [typeof media.$inferInsert['status'], string, string | null][] = [
    ['processing', 'processing', null],
    ['quarantined', 'quarantined', null],
    ['blocked', 'rejected', null],
    ['rejected', 'rejected', 'too_long'],
    ['failed', 'failed', null],
    ['ready', 'ready', null],
  ]
  for (const [status, shown, reason] of states) {
    const id = await publish(ada, { status })
    if (reason) await db.update(videoDetails).set({ rejectionReason: reason as 'too_long' }).where(eq(videoDetails.mediaId, id))
    const s = await service.status(ada, id)
    assert.deepEqual([s?.status, s?.reason], [shown, reason], status)
    assert.equal(s?.video !== null, status === 'ready', `${status}: only a ready video carries its files`)
  }
})

test('status of a ready video carries its poster, size and renditions in order', async () => {
  const id = await publish()
  const s = await service.status(ada, id)
  assert.deepEqual(s?.video, {
    id,
    src: `/media/videos/${id}`,
    durationMs: 12_000,
    width: 640,
    height: 360,
    description: '',
    renditions: [
      { height: 240, width: 480, bytes: 24_000 },
      { height: 360, width: 720, bytes: 36_000 },
    ],
  })
})

test('a deleted video, or another kind of media, is not found', async () => {
  const gone = await publish(ada, { status: 'deleted' })
  const image = await publish(ada, { kind: 'post_image' })
  assert.equal(await service.status(ada, gone), null)
  assert.equal(await service.status(ada, image), null)
})

// --- Removing ---

test('remove: aborts an open upload and deletes an unattached video; an attached one stays', async () => {
  const up = await upload(ada)
  assert.equal(await service.remove(ada, up.mediaId), true)
  assert.deepEqual(store.aborted, [up.uploadId])
  assert.equal((await service.status(ada, up.mediaId)), null)

  const ready = await publish()
  assert.equal(await service.remove(ada, ready), true)
  assert.deepEqual(store.keys('media'), [])

  const attached = await publish(ada, { postId: await post() })
  assert.equal(await service.remove(ada, attached), false)
  assert.equal(store.keys('media').length, 3)
})

// --- Taking down ---

test('quarantine moves every public file to the private bucket by server-side copy, purges the CDN, and release puts them back', async () => {
  const postId = await post()
  const id = await publish(ada, { postId })
  const keys = [renditionKey(id, 240), renditionKey(id, 360), posterKey(id)]
  await service.quarantinePostVideos(postId)
  assert.deepEqual(store.keys('media'), [])
  assert.deepEqual(store.keys('uploads'), keys.map((k) => `quarantine/${k}`).sort())
  assert.deepEqual(jobs.purged.flat().sort(), [...keys].sort())
  assert.equal((await db.select().from(media).where(eq(media.id, id)))[0]!.status, 'quarantined')
  // Idempotent.
  await service.quarantinePostVideos(postId)
  assert.equal(jobs.purged.length, 1)

  await service.releasePostVideos(postId)
  assert.deepEqual(store.keys('media'), [...keys].sort())
  assert.deepEqual(store.keys('uploads'), [])
  assert.equal((await db.select().from(media).where(eq(media.id, id)))[0]!.status, 'ready')
})

test('deleting a post removes its video, unless the post is under report: then it is kept privately', async () => {
  const plain = await post()
  const a = await publish(ada, { postId: plain })
  await service.discardPostVideos(plain)
  assert.deepEqual(store.keys('media'), [])
  assert.equal((await db.select().from(media).where(eq(media.id, a)))[0]!.status, 'deleted')

  const reported = await post()
  const b = await publish(ada, { postId: reported })
  const { reports } = await import('@heynaija/db')
  await db.insert(reports).values({ reporterId: bayo, postId: reported, reason: 'spam' })
  await service.discardPostVideos(reported)
  assert.equal((await db.select().from(media).where(eq(media.id, b)))[0]!.status, 'quarantined')
  assert.equal(store.keys('uploads').length, 3)
})

test('an illegal report hides the video at once, pending review (ADR open question 6)', async () => {
  const postId = await post()
  const id = await publish(ada, { postId })
  await service.hideReportedVideos(postId)
  assert.equal((await db.select().from(media).where(eq(media.id, id)))[0]!.status, 'quarantined')
  assert.deepEqual(store.keys('media'), [])
})

// --- The sweep ---

test('sweep: an upload past its window is aborted and deleted; one inside it is left; processing is never swept', async () => {
  const old = await upload(ada)
  const fresh = await upload(bayo)
  const processing = await publish(ada, { status: 'processing' })
  const long = new Date(Date.now() - 25 * 3_600_000)
  await db.update(media).set({ createdAt: long }).where(eq(media.id, old.mediaId))
  await db.update(media).set({ createdAt: long }).where(eq(media.id, processing))
  await service.sweepAbandoned()
  const status = async (id: string) => (await db.select().from(media).where(eq(media.id, id)))[0]!.status
  assert.equal(await status(old.mediaId), 'deleted')
  assert.deepEqual(store.aborted, [old.uploadId])
  assert.equal(await status(fresh.mediaId), 'uploading')
  assert.equal(await status(processing), 'processing')
})

test('sweep: a ready video never put on a post is cleared after an hour', async () => {
  const stale = await publish(ada, { readyAt: new Date(Date.now() - 2 * 3_600_000) })
  const young = await publish(ada)
  await service.sweepAbandoned()
  const status = async (id: string) => (await db.select().from(media).where(eq(media.id, id)))[0]!.status
  assert.equal(await status(stale), 'deleted')
  assert.equal(await status(young), 'ready')
  assert.ok(!store.keys('media').some((k) => k.includes(stale)))
})

test('sweep: a video whose post was removed but is still public is quarantined', async () => {
  const removed = await post(ada, true)
  const id = await publish(ada, { postId: removed })
  await service.sweepAbandoned()
  assert.equal((await db.select().from(media).where(eq(media.id, id)))[0]!.status, 'quarantined')
})

test('the original of a quarantined upload is kept where the evidence belongs', () => {
  assert.equal(quarantineOriginalKey('abc'), 'quarantine/originals/videos/abc')
  assert.equal(originalKey('abc'), 'videos/abc')
  assert.equal(renditionKey('abc', 360), 'videos/abc/360.mp4')
})
