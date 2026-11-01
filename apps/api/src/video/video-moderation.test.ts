import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { media, members, posts, reports, videoDetails, videoRenditions } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { ModerationService } from '../moderation/moderation.service.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { MemoryVideoStore } from './memory-video-store.js'
import { DEFAULT_VIDEO_CONFIG } from './video-config.js'
import { posterKey, renditionKey } from './video-keys.js'
import { VideoService } from './video.service.js'

const ada = randomUUID() // posts the video
const bayo = randomUUID() // reports it
const sam = randomUUID() // site moderator

class FlakyStore extends MemoryVideoStore {
  failCopies = 0
  override async copy(...args: Parameters<MemoryVideoStore['copy']>) {
    if (this.failCopies > 0) {
      this.failCopies--
      throw new Error('storage is down')
    }
    return super.copy(...args)
  }
}

let store: FlakyStore
let videos: VideoService
let moderation: ModerationService
const postsService = new PostsService(db)
const jobs = { processVideo: async () => {}, purgeCdn: async () => {} }

before(migrate)
beforeEach(async () => {
  await reset()
  const old = new Date(Date.now() - 30 * 86_400_000)
  await db.insert(members).values([
    { id: ada, handle: 'ada', createdAt: old },
    { id: bayo, handle: 'bayo', createdAt: old },
    { id: sam, handle: 'sam', createdAt: old },
  ])
  store = new FlakyStore()
  videos = new VideoService(db, store, jobs, DEFAULT_VIDEO_CONFIG)
  moderation = new ModerationService(db, undefined, undefined, videos)
  await moderation.setSiteModerator('sam', true)
})
after(() => pool.end())

const livePost = async () => {
  const [p] = await db.insert(posts).values({ authorId: ada, text: 'a video post' }).returning({ id: posts.id })
  const [m] = await db
    .insert(media)
    .values({ ownerId: ada, kind: 'post_video', status: 'ready', contentType: 'video/mp4', bytes: 1000, width: 640, height: 360, readyAt: new Date(), postId: p!.id })
    .returning({ id: media.id })
  const id = m!.id
  await db.insert(videoDetails).values({ mediaId: id, durationMs: 12_000, width: 640, height: 360, posterKey: posterKey(id), scanResult: 'clear' })
  await db.insert(videoRenditions).values({ mediaId: id, height: 360, width: 640, bytes: 3000, bitrateKbps: 600 })
  for (const key of [renditionKey(id, 360), posterKey(id)]) store.objects.set(`media/${key}`, Buffer.from(key))
  return { postId: p!.id, mediaId: id }
}
const statusOf = async (id: string) => (await db.select().from(media).where(eq(media.id, id)))[0]!.status

test('a failed hide after an illegal report is finished by the sweep (it is not left public)', async () => {
  const { postId, mediaId } = await livePost()
  store.failCopies = 1 // the hide's first copy fails; the report itself stands
  await moderation.report(bayo, { postId }, 'illegal')
  assert.equal(await statusOf(mediaId), 'ready', 'the hide failed, so it is still up')
  assert.equal(store.keys('media').length, 2)

  await videos.sweepAbandoned()
  assert.equal(await statusOf(mediaId), 'quarantined')
  assert.deepEqual(store.keys('media'), [])
})

test('the hide runs even where moderation has no image service (it is not gated on images)', async () => {
  const { postId, mediaId } = await livePost()
  await moderation.report(bayo, { postId }, 'illegal')
  assert.equal(await statusOf(mediaId), 'quarantined')
})

test('the sweep leaves a ready video alone when its post has only a non-illegal report', async () => {
  const { postId, mediaId } = await livePost()
  await moderation.report(bayo, { postId }, 'spam')
  await videos.sweepAbandoned()
  assert.equal(await statusOf(mediaId), 'ready')
})

test('a dismissed illegal report puts the video back: ready, files public, visible in the thread', async () => {
  const { postId, mediaId } = await livePost()
  await moderation.report(bayo, { postId }, 'illegal')
  assert.equal(await statusOf(mediaId), 'quarantined')
  assert.equal((await postsService.thread(null, postId))!.post.video, null, 'hidden while under review')

  const [report] = await db.select().from(reports).where(eq(reports.postId, postId))
  await moderation.resolve(sam, report!.id, 'dismiss')

  assert.equal(await statusOf(mediaId), 'ready')
  assert.deepEqual(store.keys('media'), [renditionKey(mediaId, 360), posterKey(mediaId)].sort())
  assert.equal((await postsService.thread(null, postId))!.post.video?.id, mediaId)
})

test('a dismissal does not release a video that was never cleared, or one on a removed post', async () => {
  const held = await livePost()
  await db.update(videoDetails).set({ scanResult: 'unscanned' }).where(eq(videoDetails.mediaId, held.mediaId))
  await moderation.report(bayo, { postId: held.postId }, 'illegal')
  const [r1] = await db.select().from(reports).where(eq(reports.postId, held.postId))
  await moderation.resolve(sam, r1!.id, 'dismiss')
  assert.equal(await statusOf(held.mediaId), 'quarantined', 'no clear scan, no release')

  const gone = await livePost()
  await moderation.report(bayo, { postId: gone.postId }, 'illegal')
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, gone.postId))
  const [r2] = await db.select().from(reports).where(eq(reports.postId, gone.postId))
  await moderation.resolve(sam, r2!.id, 'dismiss')
  assert.equal(await statusOf(gone.mediaId), 'quarantined', 'a deleted post keeps its video private')
})

test('the moderator queue says a post has a video, even when it is hidden, and a video-only post is not shown as empty', async () => {
  const { postId } = await livePost()
  await db.update(posts).set({ text: '' }).where(eq(posts.id, postId))
  await moderation.report(bayo, { postId }, 'illegal')
  const [item] = await moderation.queue(sam)
  assert.equal(item!.post!.hasVideo, true)
  const none = await db.insert(posts).values({ authorId: ada, text: 'plain' }).returning({ id: posts.id })
  await moderation.report(bayo, { postId: none[0]!.id }, 'spam')
  const items = await moderation.queue(sam)
  assert.equal(items.find((i) => i.post!.id === none[0]!.id)!.post!.hasVideo, false)
})

test('dismissing a spam report leaves an illegal report open and the video hidden; dismissing the illegal one releases it', async () => {
  const { postId, mediaId } = await livePost()
  await moderation.report(bayo, { postId }, 'illegal')
  await moderation.report(sam, { postId }, 'spam')
  assert.equal(await statusOf(mediaId), 'quarantined')

  const spam = (await db.select().from(reports).where(eq(reports.postId, postId))).find((r) => r.reason === 'spam')!
  await moderation.resolve(sam, spam.id, 'dismiss')
  const after = await db.select().from(reports).where(eq(reports.postId, postId))
  assert.equal(after.find((r) => r.reason === 'illegal')!.status, 'open', 'the illegal report is still open')
  assert.equal(after.find((r) => r.reason === 'spam')!.status, 'dismissed')
  assert.equal(await statusOf(mediaId), 'quarantined', 'the video stays hidden')
  const { notifications } = await import('@heynaija/db')
  const told = await db.select().from(notifications).where(eq(notifications.recipientId, bayo))
  assert.equal(told.length, 0, 'the illegal reporter is not told their report was dismissed')

  await moderation.resolve(sam, after.find((r) => r.reason === 'illegal')!.id, 'dismiss')
  assert.equal(await statusOf(mediaId), 'ready')
})
