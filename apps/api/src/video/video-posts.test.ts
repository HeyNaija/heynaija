import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { featureFlags, media, members, posts, videoDetails, videoRenditions } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { AuthController } from '../auth/auth.controller.js'
import type { AuthedRequest } from '../auth/session.guard.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { slugParam } from '../http.js'
import { NoScanner } from '../media/media.service.js'
import { PhotoDnaScanner } from '../media/photodna.js'
import { newPost, PostsService, VideoNotReadyError } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { VideoGate } from './video-gate.js'

const ada = randomUUID()
const bayo = randomUUID()
const service = new PostsService(db)
const schema = newPost(slugParam)

before(migrate)
beforeEach(async () => {
  await reset()
  await db.delete(featureFlags)
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
  ])
})
after(() => pool.end())

const video = async (owner = ada, status: typeof media.$inferInsert['status'] = 'ready') => {
  const [row] = await db
    .insert(media)
    .values({ ownerId: owner, kind: 'post_video', status, contentType: 'video/mp4', bytes: 1000, width: 640, height: 360, readyAt: new Date() })
    .returning({ id: media.id })
  await db.insert(videoDetails).values({ mediaId: row!.id, durationMs: 9_000, width: 640, height: 360, scanResult: 'clear' })
  await db.insert(videoRenditions).values([
    { mediaId: row!.id, height: 360, width: 640, bytes: 3000, bitrateKbps: 614 },
    { mediaId: row!.id, height: 240, width: 426, bytes: 2000, bitrateKbps: 348 },
  ])
  return row!.id
}

test('a post carries its ready video: poster path, size, renditions smallest first, and the description', async () => {
  const id = await video()
  const { id: postId } = await service.create(ada, 'look at this', { video: { id, description: 'A goat on a bike' } })
  const post = await service.post(null, postId)
  assert.ok(post && !post.unavailable)
  assert.deepEqual(post.video, {
    id,
    src: `/media/videos/${id}`,
    durationMs: 9000,
    width: 640,
    height: 360,
    description: 'A goat on a bike',
    renditions: [
      { height: 240, width: 426, bytes: 2000 },
      { height: 360, width: 640, bytes: 3000 },
    ],
  })
  assert.deepEqual(post.images, [], 'a video is not an image')
})

test('a video alone is a post; the text may be empty', async () => {
  const id = await video()
  assert.ok(schema.safeParse({ text: '', video: { id } }).success)
  assert.ok(!schema.safeParse({ text: '' }).success)
})

test('one video, no images beside it, no poll, not in a reply', () => {
  const id = randomUUID()
  assert.ok(!schema.safeParse({ text: 'x', video: { id }, images: [{ id: randomUUID() }] }).success)
  assert.ok(!schema.safeParse({ text: 'x', video: { id }, replyTo: randomUUID() }).success)
  assert.ok(!schema.safeParse({ text: 'x', video: { id }, poll: { options: ['a', 'b'] } }).success)
  assert.ok(!schema.safeParse({ text: 'x', video: [{ id }, { id }] }).success, 'a list of videos is not one video')
})

test('only a READY video of your own can be attached; a held, blocked, unfinished or someone else’s is refused and no post is made', async () => {
  const cases: [string, string][] = [
    ['processing', await video(ada, 'processing')],
    ['quarantined', await video(ada, 'quarantined')],
    ['blocked', await video(ada, 'blocked')],
    ['uploading', await video(ada, 'uploading')],
    ['rejected', await video(ada, 'rejected')],
    ['someone else’s', await video(bayo)],
    ['one that does not exist', randomUUID()],
  ]
  for (const [what, id] of cases) {
    await assert.rejects(() => service.create(ada, 'nope', { video: { id, description: '' } }), VideoNotReadyError, what)
  }
  assert.equal(await db.$count(posts), 0, 'nothing was posted')
})

test('a video can be used by one post only', async () => {
  const id = await video()
  await service.create(ada, 'first', { video: { id, description: '' } })
  await assert.rejects(() => service.create(ada, 'second', { video: { id, description: '' } }), VideoNotReadyError)
})

test('a video taken down is not shown in its post', async () => {
  const id = await video()
  const { id: postId } = await service.create(ada, 'hi', { video: { id, description: '' } })
  await db.update(media).set({ status: 'quarantined' }).where(eq(media.id, id))
  const post = await service.post(null, postId)
  assert.ok(post && !post.unavailable)
  assert.equal(post.video, null)
})

// --- /v1/me ---

const meWith = (flags: FeatureFlags, appEnv: 'production' | 'staging', scanner: NoScanner | PhotoDnaScanner) =>
  new AuthController(
    {} as never,
    { scope: async () => ({ siteWide: false, communityIds: [] }) } as never,
    { unreadCount: async () => 0 } as never,
    {} as never,
    { APP_ENV: appEnv, CALLS_ENABLED: false, CALLS_GISTS_ENABLED: false, CALLS_MEMBERS: [] } as never,
    db,
    {} as never,
    {} as never,
    {} as never,
    flags,
    new VideoGate(flags, { APP_ENV: appEnv }, scanner),
  )
const asAda = { member: { id: ada, handle: 'ada' } } as AuthedRequest

test('/v1/me features.videoPosts: the flag AND the scanner rule, never the flag alone', async () => {
  await db.insert(featureFlags).values({ key: 'videoPosts', enabled: true })
  const prod = new FeatureFlags(db, 'production')
  assert.equal((await meWith(prod, 'production', new NoScanner()).me(asAda)).features.videoPosts, false, 'production, flag on, no scanner')
  assert.equal((await meWith(prod, 'production', new PhotoDnaScanner('k')).me(asAda)).features.videoPosts, true)
  assert.equal((await meWith(new FeatureFlags(db, 'staging'), 'staging', new NoScanner()).me(asAda)).features.videoPosts, true)
  await db.delete(featureFlags)
  const off = new FeatureFlags(db, 'production')
  assert.equal((await meWith(off, 'production', new PhotoDnaScanner('k')).me(asAda)).features.videoPosts, false, 'production default is off')
})
