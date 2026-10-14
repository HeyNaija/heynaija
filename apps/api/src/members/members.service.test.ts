import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { follows, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { CannotFollowSelfError, MembersService } from './members.service.js'

const service = new MembersService(db)
const postsService = new PostsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
})
after(() => pool.end())

test('a profile carries counts and how the viewer relates to it', async () => {
  await postsService.create(ada, 'one')
  const deleted = await postsService.create(ada, 'two')
  await postsService.remove(ada, deleted.id)
  await service.follow(bayo, 'ada')
  await service.follow(chi, 'ada')
  await service.follow(ada, 'bayo')

  const asBayo = (await service.profile(bayo, 'ada'))!
  assert.equal(asBayo.handle, 'ada')
  assert.equal(asBayo.postCount, 1)
  assert.equal(asBayo.followerCount, 2)
  assert.equal(asBayo.followingCount, 1)
  assert.equal(asBayo.viewerFollows, true)
  assert.equal(asBayo.isSelf, false)

  assert.equal((await service.profile(ada, 'ada'))!.isSelf, true)
  const anonymous = (await service.profile(null, 'ada'))!
  assert.equal(anonymous.viewerFollows, false)
  assert.equal(anonymous.isSelf, false)
})

test('unknown and suspended members have no profile', async () => {
  assert.equal(await service.profile(null, 'nobody'), null)
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.equal(await service.profile(null, 'chi'), null)
  assert.equal(await service.follow(ada, 'chi'), false)
  assert.equal(await service.follow(ada, 'nobody'), false)
})

test('follow and unfollow are idempotent', async () => {
  assert.equal(await service.follow(ada, 'bayo'), true)
  assert.equal(await service.follow(ada, 'bayo'), true)
  assert.equal((await service.profile(ada, 'bayo'))!.followerCount, 1)

  assert.equal(await service.unfollow(ada, 'bayo'), true)
  assert.equal(await service.unfollow(ada, 'bayo'), true)
  const after = (await service.profile(ada, 'bayo'))!
  assert.equal(after.followerCount, 0)
  assert.equal(after.viewerFollows, false)
})

test('you cannot follow yourself', async () => {
  await assert.rejects(service.follow(ada, 'ada'), CannotFollowSelfError)
})

test('a suspended follower stops counting', async () => {
  await service.follow(chi, 'ada')
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.equal((await service.profile(null, 'ada'))!.followerCount, 0)
})

test('after a rename, a handle resolves to whoever was seen with it most recently', async () => {
  const renamed = randomUUID()
  await db.insert(members).values({ id: renamed, handle: 'ada', lastSeenAt: new Date() })
  assert.equal((await service.profile(null, 'ada'))!.id, renamed)
})

test('member search matches handle prefixes literally', async () => {
  await db.insert(members).values([
    { id: randomUUID(), handle: 'ada_obi' },
    { id: randomUUID(), handle: 'adaxobi' },
    { id: randomUUID(), handle: 'adaeze', active: false },
  ])
  const found = async (q: string) => (await service.search(q, 10)).map((m) => m.handle)
  assert.deepEqual(await found('ada'), ['ada', 'ada_obi', 'adaxobi'])
  assert.deepEqual(await found('@ADA'), ['ada', 'ada_obi', 'adaxobi'])
  // "_" is a real character in handles, not a single-character wildcard.
  assert.deepEqual(await found('ada_'), ['ada_obi'])
  assert.deepEqual(await found('%'), [])
  assert.deepEqual(await found('zzz'), [])
})

test('blocking is mutual invisibility and ends follows both ways', async () => {
  await service.follow(ada, 'bayo')
  await service.follow(bayo, 'ada')
  const bayoPost = await postsService.create(bayo, 'from bayo')
  await postsService.create(ada, 'from ada')
  await postsService.create(chi, 'from chi')

  assert.equal(await service.block(ada, 'bayo'), true)
  assert.equal(await service.block(ada, 'bayo'), true)
  assert.equal((await db.select().from(follows)).length, 0)

  const seenBy = async (viewer: string) => (await postsService.feed(viewer, 10)).posts.map((p) => p.text)
  assert.deepEqual(await seenBy(ada), ['from chi', 'from ada'])
  assert.deepEqual(await seenBy(bayo), ['from chi', 'from bayo'])
  assert.deepEqual(await seenBy(chi), ['from chi', 'from ada', 'from bayo'])

  // The blocker still sees the profile (to unblock); to the blocked, they are gone.
  assert.equal((await service.profile(ada, 'bayo'))!.viewerBlocks, true)
  assert.equal(await service.profile(bayo, 'ada'), null)
  assert.equal((await service.profile(chi, 'ada'))!.viewerBlocks, false)

  // No following, liking or replying across a block, in either direction.
  assert.equal(await service.follow(bayo, 'ada'), false)
  assert.equal(await service.follow(ada, 'bayo'), false)
  assert.equal(await postsService.like(ada, bayoPost.id), false)
  await assert.rejects(postsService.create(ada, 'reply', { replyTo: bayoPost.id }))
  assert.equal(await postsService.thread(ada, bayoPost.id), null)

  await service.unblock(ada, 'bayo')
  assert.deepEqual(await seenBy(ada), ['from chi', 'from ada', 'from bayo'])
  assert.equal(await service.follow(ada, 'bayo'), true)
})

test('muting is one-sided: only the muter stops seeing posts, except on the profile itself', async () => {
  await postsService.create(bayo, 'from bayo')
  await postsService.create(ada, 'from ada')
  assert.equal(await service.mute(ada, 'bayo'), true)

  const seenBy = async (viewer: string) => (await postsService.feed(viewer, 10)).posts.map((p) => p.text)
  assert.deepEqual(await seenBy(ada), ['from ada'])
  assert.deepEqual(await seenBy(bayo), ['from ada', 'from bayo'])
  assert.equal((await postsService.search(ada, 'bayo', 10)).length, 0)

  const profile = (await service.profile(ada, 'bayo'))!
  assert.equal(profile.viewerMutes, true)
  assert.deepEqual((await postsService.byAuthor(ada, bayo, 10)).posts.map((p) => p.text), ['from bayo'])
  // The muted member can tell nothing: they can still see and follow the muter.
  assert.equal((await service.profile(bayo, 'ada'))!.viewerMutes, false)
  assert.equal(await service.follow(bayo, 'ada'), true)

  await service.unmute(ada, 'bayo')
  assert.deepEqual(await seenBy(ada), ['from ada', 'from bayo'])
})

test('you cannot block or mute yourself or someone who does not exist', async () => {
  assert.equal(await service.block(ada, 'ada'), false)
  assert.equal(await service.mute(ada, 'ada'), false)
  assert.equal(await service.block(ada, 'nobody'), false)
  assert.equal(await service.mute(ada, 'nobody'), false)
})
