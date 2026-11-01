import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { featureFlags, media, members, moderationActions, posts, videoDetails, videoRenditions } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { AuthController } from '../auth/auth.controller.js'
import type { AuthedRequest } from '../auth/session.guard.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { slugParam } from '../http.js'
import { NoScanner } from '../media/media.service.js'
import { PhotoDnaScanner } from '../media/photodna.js'
import { newPost, PostsService, VideoNotReadyError } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { DEFAULT_VIDEO_CONFIG } from './video-config.js'
import { VideoGate } from './video-gate.js'
import { VideoError } from './video-error.js'

const ada = randomUUID()
const bayo = randomUUID()
const service = new PostsService(db)
const schema = newPost(slugParam)

before(migrate)
beforeEach(async () => {
  await reset()
  await db.delete(featureFlags)
  const old = new Date(Date.now() - 30 * 86_400_000)
  await db.insert(members).values([
    { id: ada, handle: 'ada', createdAt: old },
    { id: bayo, handle: 'bayo', createdAt: old },
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
    // A recent block would make the account ineligible (a different refusal, tested below), so this one is old.
    ['blocked', await (async () => { const id = await video(ada, 'blocked'); await db.update(media).set({ createdAt: new Date(Date.now() - 100 * 86_400_000) }).where(eq(media.id, id)); return id })()],
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

// --- The trust rules hold when the video is attached, not only when the upload starts (ADR 0019 section 4.7) ---

const capped = new PostsService(db, { ...DEFAULT_VIDEO_CONFIG, maxLivePerMember: 2 })
const code = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch (err) {
    assert.ok(err instanceof VideoError, String(err))
    return err.code
  }
  return null
}

test('attach: the live-video cap is checked at attach, so uploads started at cap-1 cannot both be posted', async () => {
  const first = await video()
  const second = await video()
  const third = await video()
  await capped.create(ada, 'one', { video: { id: first, description: '' } }) // 1 live
  await capped.create(ada, 'two', { video: { id: second, description: '' } }) // 2 live: the cap
  assert.equal(await code(() => capped.create(ada, 'three', { video: { id: third, description: '' } })), 'too_many_videos')
  const [row] = await db.select().from(media).where(eq(media.id, third))
  assert.equal(row!.postId, null, 'the refused video is not attached')
  assert.equal((await db.select().from(posts).where(eq(posts.authorId, ada))).length, 2, 'and no post was made')
})

test('attach: creates racing at the cap let exactly the cap through, the rest get too_many_videos, and none deadlocks', async () => {
  // Each create inserts its post (a key-share lock on the member row through the FK) and then locks the
  // member before counting. FOR UPDATE there makes two creates deadlock; FOR NO KEY UPDATE makes them queue.
  // Timing decides how many overlap, so it is repeated and many run at once.
  for (let round = 0; round < 3; round++) {
    await reset()
    await db.insert(members).values({ id: ada, handle: 'ada', createdAt: new Date(Date.now() - 30 * 86_400_000) })
    const ids = await Promise.all(Array.from({ length: 8 }, () => video()))
    const results = await Promise.allSettled(ids.map((id, i) => capped.create(ada, `r${round}-${i}`, { video: { id, description: '' } })))
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    assert.equal(results.length - refused.length, 2, `round ${round}: exactly the cap (2) got in`)
    for (const r of refused) assert.ok(r.reason instanceof VideoError && r.reason.code === 'too_many_videos', String(r.reason))
  }
})

test('attach: an upheld action between the upload and the post refuses the post', async () => {
  const id = await video()
  await db.insert(moderationActions).values({ actorId: bayo, action: 'remove_avatar', memberId: ada })
  assert.equal(await code(() => service.create(ada, 'late', { video: { id, description: '' } })), 'not_eligible')
  assert.equal((await db.select().from(posts).where(eq(posts.authorId, ada))).length, 0)
})

test('attach: an account that is too new is refused', async () => {
  await db.update(members).set({ createdAt: new Date() }).where(eq(members.id, ada))
  const id = await video()
  assert.equal(await code(() => service.create(ada, 'new here', { video: { id, description: '' } })), 'not_eligible')
})
