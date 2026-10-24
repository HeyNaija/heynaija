import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, members, mutes, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { NotACommunityModeratorError, PostsService } from './posts.service.js'

const service = new PostsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const mod = randomUUID()
const siteMod = randomUUID()
const lagos = randomUUID()
const abuja = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
    { id: mod, handle: 'lagos_mod' },
    { id: siteMod, handle: 'site_mod', role: 'moderator' },
  ])
  await db.insert(communities).values([
    { id: lagos, slug: 'lagos', name: 'Lagos', description: 'Eko' },
    { id: abuja, slug: 'abuja', name: 'Abuja', description: 'FCT' },
  ])
  await db.insert(communityMemberships).values([
    { communityId: lagos, memberId: ada },
    { communityId: lagos, memberId: bayo },
    { communityId: lagos, memberId: mod, role: 'moderator' },
    { communityId: abuja, memberId: ada },
  ])
})
after(() => pool.end())

const pinnedText = async (viewerId: string | null, authorId: string) => (await service.pinnedOnProfile(viewerId, authorId))?.text ?? null
const communityPinText = async (viewerId: string | null, communityId: string) =>
  (await service.pinnedInCommunity(viewerId, communityId))?.text ?? null

test('a member pins one of their own posts to their profile, and a new pin replaces it', async () => {
  const first = await service.create(ada, 'first')
  const second = await service.create(ada, 'second')
  assert.equal(await pinnedText(null, ada), null)

  assert.equal(await service.pinToProfile(ada, first.id), true)
  assert.equal(await pinnedText(null, ada), 'first')
  assert.equal((await service.post(null, first.id))!.pinnedOnProfile, true)
  assert.equal((await service.post(null, second.id))!.pinnedOnProfile, false)

  assert.equal(await service.pinToProfile(ada, second.id), true)
  assert.equal(await pinnedText(null, ada), 'second')
  assert.equal((await service.post(null, first.id))!.pinnedOnProfile, false)

  // Unpinning something else changes nothing; unpinning the pin clears it, twice is harmless.
  await service.unpinFromProfile(ada, first.id)
  assert.equal(await pinnedText(null, ada), 'second')
  await service.unpinFromProfile(ada, second.id)
  await service.unpinFromProfile(ada, second.id)
  assert.equal(await pinnedText(null, ada), null)
})

test('only your own live top-level posts can go on your profile', async () => {
  const theirs = await service.create(bayo, 'by bayo')
  const reply = await service.create(ada, 'a reply', { replyTo: theirs.id })
  const deleted = await service.create(ada, 'deleted')
  await service.remove(ada, deleted.id)
  const removed = await service.create(ada, 'taken down')
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, removed.id))
  for (const id of [theirs.id, reply.id, deleted.id, removed.id, randomUUID()]) {
    assert.equal(await service.pinToProfile(ada, id), false)
  }
  assert.equal(await pinnedText(null, ada), null)
})

test('a pinned post shows only while it is live and the reader may see it', async () => {
  const { id } = await service.create(ada, 'pinned')
  await service.pinToProfile(ada, id)

  // Muting someone does not hide their pin on their own profile; a block does.
  await db.insert(mutes).values({ muterId: bayo, mutedId: ada })
  assert.equal(await pinnedText(bayo, ada), 'pinned')
  await db.insert(blocks).values({ blockerId: ada, blockedId: chi })
  assert.equal(await pinnedText(chi, ada), null)

  // Taken down, it is gone; restored, it is back. Suspended, gone.
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, id))
  assert.equal(await pinnedText(null, ada), null)
  await db.update(posts).set({ removedAt: null }).where(eq(posts.id, id))
  assert.equal(await pinnedText(null, ada), 'pinned')
  await db.update(members).set({ active: false }).where(eq(members.id, ada))
  assert.equal(await pinnedText(null, ada), null)
  await db.update(members).set({ active: true }).where(eq(members.id, ada))

  // Deleted by its author, the pin is gone for good.
  await service.remove(ada, id)
  assert.equal(await pinnedText(null, ada), null)
})

test("a community's moderators pin one of its posts, and site moderators can too", async () => {
  const welcome = await service.create(mod, 'Welcome to Lagos', { communitySlug: 'lagos' })
  const guide = await service.create(bayo, 'Where to eat in Yaba', { communitySlug: 'lagos' })

  assert.equal(await service.pinInCommunity(mod, welcome.id), true)
  assert.equal(await communityPinText(null, lagos), 'Welcome to Lagos')
  assert.equal((await service.post(null, welcome.id))!.pinnedInCommunity, true)

  // A moderator may pin a member's post; it replaces the welcome.
  assert.equal(await service.pinInCommunity(mod, guide.id), true)
  assert.equal(await communityPinText(null, lagos), 'Where to eat in Yaba')
  assert.equal(await service.pinInCommunity(siteMod, welcome.id), true)
  assert.equal(await communityPinText(null, lagos), 'Welcome to Lagos')

  // Members who do not moderate it cannot, the post's author included.
  await assert.rejects(service.pinInCommunity(bayo, guide.id), NotACommunityModeratorError)
  await assert.rejects(service.unpinInCommunity(ada, welcome.id), NotACommunityModeratorError)
  assert.equal(await communityPinText(null, lagos), 'Welcome to Lagos')

  await service.unpinInCommunity(mod, welcome.id)
  await service.unpinInCommunity(mod, welcome.id)
  assert.equal(await communityPinText(null, lagos), null)
})

test('only live top-level posts in an active community can be pinned there', async () => {
  const root = await service.create(ada, 'root', { communitySlug: 'lagos' })
  const reply = await service.create(bayo, 'reply', { replyTo: root.id })
  const outside = await service.create(mod, 'not in a community')
  const elsewhere = await service.create(ada, 'in Abuja', { communitySlug: 'abuja' })
  const deleted = await service.create(ada, 'deleted', { communitySlug: 'lagos' })
  await service.remove(ada, deleted.id)
  for (const id of [reply.id, outside.id, deleted.id, randomUUID()]) assert.equal(await service.pinInCommunity(mod, id), false)
  // Moderating Lagos is not moderating Abuja.
  await assert.rejects(service.pinInCommunity(mod, elsewhere.id), NotACommunityModeratorError)

  await service.pinInCommunity(mod, root.id)
  await db.update(communities).set({ active: false }).where(eq(communities.id, lagos))
  assert.equal(await service.pinInCommunity(mod, root.id), false)
})

test('a post says whether the reader may pin it in its community', async () => {
  const root = await service.create(ada, 'root', { communitySlug: 'lagos' })
  const reply = await service.create(bayo, 'reply', { replyTo: root.id })
  const outside = await service.create(ada, 'outside')
  const canPin = async (viewerId: string | null, id: string) => (await service.post(viewerId, id))!.viewerCanPinInCommunity
  assert.equal(await canPin(mod, root.id), true)
  assert.equal(await canPin(siteMod, root.id), true)
  assert.equal(await canPin(ada, root.id), false)
  assert.equal(await canPin(null, root.id), false)
  assert.equal(await canPin(mod, reply.id), false)
  assert.equal(await canPin(siteMod, outside.id), false)
  // Replies on a thread page say the same.
  const thread = (await service.thread(mod, root.id))!
  assert.deepEqual(thread.replies.map((r) => !r.unavailable && [r.viewerCanPinInCommunity, r.pinnedOnProfile, r.pinnedInCommunity]), [[false, false, false]])
})

test('a pinned post removed for good takes its pins with it', async () => {
  const { id } = await service.create(mod, 'short-lived', { communitySlug: 'lagos' })
  await service.pinToProfile(mod, id)
  await service.pinInCommunity(mod, id)
  await db.delete(posts).where(eq(posts.id, id))
  const [member] = await db.select({ pinned: members.pinnedPostId }).from(members).where(eq(members.id, mod))
  const [community] = await db.select({ pinned: communities.pinnedPostId }).from(communities).where(eq(communities.id, lagos))
  assert.deepEqual([member!.pinned, community!.pinned], [null, null])
})
