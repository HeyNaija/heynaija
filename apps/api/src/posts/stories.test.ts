import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, follows, members, notifications, posts } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { NotificationsService } from '../notifications/notifications.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { PostsService, StoryNotFoundError } from './posts.service.js'

// Stories (docs/adr/0024): a post plus the updates its author adds to it.
const service = new PostsService(db)
const inbox = new NotificationsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const lagos = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
  await db.insert(communities).values({ id: lagos, slug: 'lagos', name: 'Lagos', description: 'Eko' })
  await db.insert(communityMemberships).values({ communityId: lagos, memberId: ada })
})
after(() => pool.end())

/** Posts one after another, a millisecond apart, so their order is certain. */
const later = () => new Promise((resolve) => setTimeout(resolve, 2))
const texts = async (page: Promise<{ posts: { text: string }[] }>) => (await page).posts.map((p) => p.text)

test('a story shows once in feeds, as its newest update, and steps back when that is deleted', async () => {
  const start = await service.create(ada, 'Building HeyNaija in public')
  await later()
  await service.create(bayo, 'something else')
  await later()
  const one = await service.create(ada, 'update one', { storyOf: start.id })
  assert.deepEqual(await texts(service.feed(null, 20)), ['update one', 'something else'])
  await later()
  const two = await service.create(ada, 'update two', { storyOf: start.id })
  assert.deepEqual(await texts(service.feed(null, 20)), ['update two', 'something else'])
  // The profile's Posts tab and Following do the same.
  assert.deepEqual(await texts(service.byAuthor(null, ada, 20)), ['update two'])
  await db.insert(follows).values({ followerId: chi, followeeId: ada })
  assert.deepEqual(await texts(service.followingFeed(chi, 20)), ['update two'])

  assert.equal(await service.remove(ada, two.id), true)
  assert.deepEqual(await texts(service.feed(null, 20)), ['update one', 'something else'])
  // A moderator taking the last one down brings the first post back.
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, one.id))
  assert.deepEqual(await texts(service.feed(null, 20)), ['something else', 'Building HeyNaija in public'])
  await db.update(posts).set({ removedAt: null }).where(eq(posts.id, one.id))
  assert.deepEqual(await texts(service.feed(null, 20)), ['update one', 'something else'])
})

test('each post of a story says which story, its place, and how many updates there are', async () => {
  const start = await service.create(ada, 'start', { communitySlug: 'lagos' })
  const plain = await service.create(ada, 'not a story')
  const ids: string[] = []
  for (const n of [1, 2, 3]) {
    await later()
    ids.push((await service.create(ada, `update ${n}`, { storyOf: start.id })).id)
  }
  assert.equal((await service.post(null, plain.id))!.story, null)
  const first = (await service.post(null, start.id))!
  assert.deepEqual({ ...first.story, start: undefined }, { id: start.id, number: 0, updates: 3, followers: 0, following: false, start: undefined })
  assert.equal(first.story!.start, null)
  const second = (await service.post(null, ids[1]!))!
  assert.equal(second.story!.number, 2)
  assert.equal(second.story!.updates, 3)
  // An update is a post in its story's community, and answers no one.
  assert.equal(second.community?.slug, 'lagos')
  assert.equal(second.replyParentId, null)
  // The first post, as a quoted post is shown, for the box above an update in a feed.
  assert.ok(second.story!.start && !second.story!.start.unavailable)
  assert.equal(second.story!.start.text, 'start')
  // Deleting one renumbers the rest, so there is no gap.
  await service.remove(ada, ids[0]!)
  assert.equal((await service.post(null, ids[1]!))!.story!.number, 1)
  assert.equal((await service.post(null, start.id))!.story!.updates, 2)
})

test('only the author adds updates, to their own live top-level post that is not an update', async () => {
  const start = await service.create(ada, 'start')
  const update = await service.create(ada, 'update', { storyOf: start.id })
  const reply = await service.create(ada, 'a reply', { replyTo: start.id })
  await assert.rejects(service.create(bayo, 'mine now', { storyOf: start.id }), StoryNotFoundError)
  await assert.rejects(service.create(ada, 'update of an update', { storyOf: update.id }), StoryNotFoundError)
  await assert.rejects(service.create(ada, 'onto a reply', { storyOf: reply.id }), StoryNotFoundError)
  await assert.rejects(service.create(ada, 'both', { storyOf: start.id, replyTo: start.id }), StoryNotFoundError)
  await service.remove(ada, start.id)
  await assert.rejects(service.create(ada, 'too late', { storyOf: start.id }), StoryNotFoundError)
})

test("an update starts with the first post's reply audience, unless it sets its own", async () => {
  const start = await service.create(ada, 'start', { replyAudience: 'following' })
  const inherited = await service.create(ada, 'update', { storyOf: start.id })
  const own = await service.create(ada, 'update', { storyOf: start.id, replyAudience: 'everyone' })
  const audience = async (id: string) => (await db.select({ a: posts.replyAudience }).from(posts).where(eq(posts.id, id)))[0]!.a
  assert.equal(await audience(inherited.id), 'following')
  assert.equal(await audience(own.id), 'everyone')
})

test("the story page has the newest updates oldest first, and the rest page in from the start", async () => {
  const start = await service.create(ada, 'start')
  for (const n of [1, 2, 3, 4]) {
    await later()
    await service.create(ada, `update ${n}`, { storyOf: start.id })
  }
  // Four fit without folding.
  assert.deepEqual((await service.thread(null, start.id))!.updates.map((p) => p.text), ['update 1', 'update 2', 'update 3', 'update 4'])
  await later()
  await service.create(ada, 'update 5', { storyOf: start.id })
  assert.deepEqual((await service.thread(null, start.id))!.updates.map((p) => p.text), ['update 3', 'update 4', 'update 5'])

  const first = (await service.storyUpdates(null, start.id, 2))!
  assert.deepEqual(first.posts.map((p) => p.text), ['update 1', 'update 2'])
  const next = (await service.storyUpdates(null, start.id, 2, first.cursor!))!
  assert.deepEqual(next.posts.map((p) => p.text), ['update 3', 'update 4'])
  const last = (await service.storyUpdates(null, start.id, 2, next.cursor!))!
  assert.deepEqual(last.posts.map((p) => p.text), ['update 5'])
  assert.equal(last.cursor, null)

  // An update's own page has no updates of its own, and an update is not a story to page.
  const update = (await service.thread(null, first.posts[0]!.id))!
  assert.deepEqual(update.updates, [])
  assert.equal(await service.storyUpdates(null, first.posts[0]!.id, 2), null)
})

test('followers are told about each update, and only while they follow', async () => {
  const start = await service.create(ada, 'start')
  // Not a story yet: nothing to follow.
  assert.equal(await service.followStory(bayo, start.id), false)
  await service.create(ada, 'update 1', { storyOf: start.id })
  assert.equal(await service.followStory(bayo, start.id), true)
  assert.equal(await service.followStory(bayo, start.id), true)
  // The author does not follow their own.
  assert.equal(await service.followStory(ada, start.id), false)
  const story = (await service.post(bayo, start.id))!.story!
  assert.equal(story.following, true)
  assert.equal(story.followers, 1)

  // Named in the update as well, Bayo is told once, as a follower.
  const two = await service.create(ada, 'update 2, thanks @bayo', { storyOf: start.id })
  const told = await db.select({ kind: notifications.kind }).from(notifications).where(and(eq(notifications.recipientId, bayo), eq(notifications.postId, two.id)))
  assert.deepEqual(told.map((n) => n.kind), ['story_update'])
  assert.deepEqual((await inbox.list(bayo, 20)).notifications.map((n) => n.kind), ['story_update'])

  // Stopping hides what was said and says no more.
  await service.unfollowStory(bayo, start.id)
  assert.deepEqual((await inbox.list(bayo, 20)).notifications, [])
  await service.create(ada, 'update 3', { storyOf: start.id })
  assert.equal((await db.select().from(notifications).where(eq(notifications.recipientId, bayo))).length, 1)
})

test('a story the member cannot read cannot be followed', async () => {
  const start = await service.create(ada, 'start')
  await service.create(ada, 'update', { storyOf: start.id })
  await db.insert(blocks).values({ blockerId: ada, blockedId: chi })
  assert.equal(await service.followStory(chi, start.id), false)
  assert.equal(await service.followStory(chi, randomUUID()), false)
})
