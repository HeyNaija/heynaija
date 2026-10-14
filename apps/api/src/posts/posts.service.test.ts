import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { follows, members, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { InvalidCursorError, ParentNotFoundError, PostsService, postText } from './posts.service.js'

const service = new PostsService(db)
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

const texts = async () => (await service.feed(null, 100)).posts.map((p) => p.text)

test('a post appears in the feed with its author handle', async () => {
  const { id } = await service.create(ada, 'hello')
  const { posts: feed } = await service.feed(null, 10)
  assert.equal(feed.length, 1)
  assert.deepEqual(
    { id: feed[0]!.id, authorId: feed[0]!.authorId, authorHandle: feed[0]!.authorHandle, text: feed[0]!.text },
    { id, authorId: ada, authorHandle: 'ada', text: 'hello' },
  )
})

test('the feed is newest first', async () => {
  for (const text of ['one', 'two', 'three']) await service.create(ada, text)
  assert.deepEqual(await texts(), ['three', 'two', 'one'])
})

test('a member can delete their own post', async () => {
  const { id } = await service.create(ada, 'mine')
  assert.equal(await service.remove(ada, id), true)
  assert.deepEqual(await texts(), [])
  // Soft delete: the row is kept.
  assert.notEqual((await db.select().from(posts).where(eq(posts.id, id)))[0]!.deletedAt, null)
})

test("a member cannot delete someone else's post", async () => {
  const { id } = await service.create(ada, 'mine')
  assert.equal(await service.remove(bayo, id), false)
  assert.deepEqual(await texts(), ['mine'])
})

test('deleting twice, or deleting nothing, reports false', async () => {
  const { id } = await service.create(ada, 'mine')
  await service.remove(ada, id)
  assert.equal(await service.remove(ada, id), false)
  assert.equal(await service.remove(ada, randomUUID()), false)
})

test('posts by an inactive member are hidden and return on reactivation', async () => {
  await service.create(ada, 'from ada')
  await service.create(bayo, 'from bayo')
  await db.update(members).set({ active: false, status: 'suspended' }).where(eq(members.id, bayo))
  assert.deepEqual(await texts(), ['from ada'])
  await db.update(members).set({ active: true, status: null }).where(eq(members.id, bayo))
  assert.deepEqual(await texts(), ['from bayo', 'from ada'])
})

test('pagination walks every post exactly once, including identical timestamps', async () => {
  const at = new Date('2026-01-01T00:00:00.000Z')
  await db.insert(posts).values(Array.from({ length: 7 }, (_, i) => ({ authorId: ada, text: `p${i}`, createdAt: at })))
  await service.create(bayo, 'newest')

  const seen: string[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await service.feed(null, 3, cursor)
    seen.push(...page.posts.map((p) => p.text))
    cursor = page.cursor ?? undefined
    pages++
  } while (cursor)

  assert.equal(pages, 3)
  assert.equal(seen[0], 'newest')
  assert.equal(seen.length, 8)
  assert.equal(new Set(seen).size, 8)
})

test('a tampered cursor is rejected, not executed', async () => {
  await assert.rejects(service.feed(null, 10, 'garbage'), InvalidCursorError)
  const forged = Buffer.from(JSON.stringify(['2026-01-01T00:00:00.000Z', "x' or 1=1 --"])).toString('base64url')
  await assert.rejects(service.feed(null, 10, forged), InvalidCursorError)
})

test('a reply joins its thread and stays out of the main feed', async () => {
  const root = await service.create(ada, 'root')
  const reply = await service.create(bayo, 'reply', { replyTo: root.id })
  const nested = await service.create(chi, 'nested', { replyTo: reply.id })

  assert.deepEqual(await texts(), ['root'])
  const rows = await db.select().from(posts)
  const row = (id: string) => rows.find((r) => r.id === id)!
  assert.equal(row(reply.id).replyParentId, root.id)
  assert.equal(row(reply.id).rootId, root.id)
  assert.equal(row(nested.id).replyParentId, reply.id)
  assert.equal(row(nested.id).rootId, root.id)
})

test('you cannot reply to a post that is missing, deleted or by a suspended member', async () => {
  await assert.rejects(service.create(ada, 'x', { replyTo: randomUUID() }), ParentNotFoundError)

  const gone = await service.create(ada, 'gone')
  await service.remove(ada, gone.id)
  await assert.rejects(service.create(bayo, 'x', { replyTo: gone.id }), ParentNotFoundError)

  const hidden = await service.create(chi, 'hidden')
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  await assert.rejects(service.create(bayo, 'x', { replyTo: hidden.id }), ParentNotFoundError)
})

test('a thread shows the conversation above and the direct replies below, oldest first', async () => {
  const root = await service.create(ada, 'root')
  const mid = await service.create(bayo, 'mid', { replyTo: root.id })
  const first = await service.create(ada, 'first reply', { replyTo: mid.id })
  const second = await service.create(chi, 'second reply', { replyTo: mid.id })
  await service.create(ada, 'grandchild', { replyTo: first.id })

  const thread = (await service.thread(null, mid.id))!
  assert.deepEqual(thread.ancestors.map((p) => p.text), ['root'])
  assert.equal(thread.post.text, 'mid')
  assert.deepEqual(thread.replies.map((p) => p.id), [first.id, second.id])
  assert.equal(thread.post.replyCount, 2)
  assert.equal(thread.replies[0]!.replyCount, 1)

  const deep = (await service.thread(null, first.id))!
  assert.deepEqual(deep.ancestors.map((p) => p.text), ['root', 'mid'])
})

test('a deleted post in the middle of a thread is a placeholder with no text', async () => {
  const root = await service.create(ada, 'secret words')
  const reply = await service.create(bayo, 'reply', { replyTo: root.id })
  await service.remove(ada, root.id)

  assert.equal(await service.thread(null, root.id), null)
  const thread = (await service.thread(null, reply.id))!
  assert.equal(thread.ancestors.length, 1)
  assert.equal(thread.ancestors[0]!.deleted, true)
  assert.equal(thread.ancestors[0]!.text, '')
})

test('likes are idempotent, counted, and personal to the viewer', async () => {
  const { id } = await service.create(ada, 'likeable')
  assert.equal(await service.like(bayo, id), true)
  assert.equal(await service.like(bayo, id), true)
  assert.equal(await service.like(chi, id), true)

  const seenBy = async (viewer: string | null) => (await service.feed(viewer, 10)).posts[0]!
  assert.equal((await seenBy(null)).likeCount, 2)
  assert.equal((await seenBy(null)).viewerLiked, false)
  assert.equal((await seenBy(bayo)).viewerLiked, true)
  assert.equal((await seenBy(ada)).viewerLiked, false)

  await service.unlike(bayo, id)
  await service.unlike(bayo, id)
  assert.equal((await seenBy(bayo)).likeCount, 1)
  assert.equal((await seenBy(bayo)).viewerLiked, false)
})

test('you cannot like a post that is missing or deleted', async () => {
  assert.equal(await service.like(ada, randomUUID()), false)
  const { id } = await service.create(ada, 'gone')
  await service.remove(ada, id)
  assert.equal(await service.like(bayo, id), false)
})

test('likes and replies from a suspended member stop counting', async () => {
  const { id } = await service.create(ada, 'post')
  await service.like(chi, id)
  await service.create(chi, 'reply', { replyTo: id })
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  const [post] = (await service.feed(null, 10)).posts
  assert.equal(post!.likeCount, 0)
  assert.equal(post!.replyCount, 0)
})

test('the following feed has only your own and followed members\' top-level posts', async () => {
  await service.create(ada, 'ada post')
  const b = await service.create(bayo, 'bayo post')
  await service.create(chi, 'chi post')
  await service.create(bayo, 'bayo reply', { replyTo: b.id })
  const following = async () => (await service.followingFeed(ada, 10)).posts.map((p) => p.text)

  assert.deepEqual(await following(), ['ada post'])
  await db.insert(follows).values({ followerId: ada, followeeId: bayo })
  assert.deepEqual(await following(), ['bayo post', 'ada post'])
})

test('a member\'s own list includes their replies', async () => {
  const root = await service.create(ada, 'root')
  await service.create(bayo, 'bayo reply', { replyTo: root.id })
  await service.create(bayo, 'bayo post')
  const mine = (await service.byAuthor(null, bayo, 10)).posts
  assert.deepEqual(mine.map((p) => p.text), ['bayo post', 'bayo reply'])
  assert.equal(mine[1]!.replyParentId, root.id)
})

test('bookmarks are idempotent and private to their owner', async () => {
  const { id } = await service.create(ada, 'worth saving')
  assert.equal(await service.bookmark(bayo, id), true)
  assert.equal(await service.bookmark(bayo, id), true)

  assert.deepEqual((await service.bookmarked(bayo, 10)).posts.map((p) => p.text), ['worth saving'])
  assert.deepEqual((await service.bookmarked(chi, 10)).posts, [])
  const seenBy = async (viewer: string | null) => (await service.feed(viewer, 10)).posts[0]!.viewerBookmarked
  assert.equal(await seenBy(bayo), true)
  assert.equal(await seenBy(chi), false)
  assert.equal(await seenBy(null), false)

  await service.unbookmark(bayo, id)
  await service.unbookmark(bayo, id)
  assert.deepEqual((await service.bookmarked(bayo, 10)).posts, [])
})

test('a bookmarked post that is later deleted drops out of the list', async () => {
  const { id } = await service.create(ada, 'temporary')
  await service.bookmark(bayo, id)
  await service.remove(ada, id)
  assert.deepEqual((await service.bookmarked(bayo, 10)).posts, [])
  assert.equal(await service.bookmark(chi, id), false)
})

test('trending ranks this week\'s top-level posts by replies then likes, and skips quiet ones', async () => {
  const quiet = await service.create(ada, 'quiet')
  const liked = await service.create(ada, 'liked twice')
  const discussed = await service.create(bayo, 'two replies')
  const old = await service.create(chi, 'old but busy')

  await service.like(bayo, liked.id)
  await service.like(chi, liked.id)
  const reply = await service.create(ada, 'r1', { replyTo: discussed.id })
  await service.create(chi, 'r2', { replyTo: discussed.id })
  await service.like(bayo, reply.id) // a liked reply is not itself a trending conversation
  await service.like(ada, old.id)
  await db.update(posts).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(posts.id, old.id))

  const trending = await service.trending(null, 5)
  assert.deepEqual(trending.map((p) => p.text), ['two replies', 'liked twice'])
  assert.ok(!trending.some((p) => p.id === quiet.id))
  assert.deepEqual((await service.trending(null, 1)).map((p) => p.text), ['two replies'])
})

test('search finds whole words in posts and replies, and treats input as text, not syntax', async () => {
  const root = await service.create(ada, 'Best suya spot in Lagos?')
  await service.create(bayo, 'University of Suya, obviously', { replyTo: root.id })
  await service.create(chi, 'Nothing to see here')
  const deleted = await service.create(chi, 'deleted suya take')
  await service.remove(chi, deleted.id)

  const found = async (q: string) => (await service.search(null, q, 10)).map((p) => p.text)
  assert.deepEqual(await found('suya'), ['University of Suya, obviously', 'Best suya spot in Lagos?'])
  assert.deepEqual(await found('SUYA lagos'), ['Best suya spot in Lagos?'])
  assert.deepEqual(await found('jollof'), [])
  // Operators and quotes in user input must not raise a syntax error.
  for (const q of ["suya & | ! ( ' \" :*", "'; drop table posts; --", '%', '""']) await found(q)
  assert.equal((await db.select().from(posts)).length, 4)
})

test('post text: trimmed, non-empty, at most 300 characters as a person counts them', () => {
  assert.equal(postText.parse('  hi  '), 'hi')
  assert.equal(postText.safeParse('   ').success, false)
  assert.equal(postText.safeParse('a'.repeat(300)).success, true)
  assert.equal(postText.safeParse('a'.repeat(301)).success, false)
  // 300 flag emoji are 300 characters to a person but 1,200 UTF-16 code units.
  assert.equal(postText.safeParse('🇳🇬'.repeat(300)).success, true)
  assert.equal(postText.safeParse('🇳🇬'.repeat(301)).success, false)
})
