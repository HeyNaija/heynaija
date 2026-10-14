import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, mock, test } from 'node:test'
import { blocks, follows, likes, members, mutes, notifications, posts } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { InvalidCursorError, ParentNotFoundError, PostsService, postText, TRENDING_TTL_MS } from './posts.service.js'

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

/** Posts whose stored counters differ from counting likes and replies afresh. */
const counterDrift = async () =>
  (
    await db.execute<{ id: string }>(sql`
      select p.id from posts p
      where p.like_count <> (select count(*) from likes l join members m on m.id = l.member_id and m.active where l.post_id = p.id)
         or p.reply_count <> (select count(*) from posts r join members m on m.id = r.author_id and m.active
                              where r.reply_parent_id = p.id and r.deleted_at is null and r.removed_at is null)`)
  ).rows

const countsOf = async (id: string) => {
  const [row] = await db.select({ likes: posts.likeCount, replies: posts.replyCount }).from(posts).where(eq(posts.id, id))
  return row!
}

test('a reinstated member\'s likes and live replies count again, without counting twice', async () => {
  const { id } = await service.create(ada, 'post')
  await service.like(chi, id)
  await service.like(bayo, id)
  const kept = await service.create(chi, 'kept', { replyTo: id })
  const deletedWhileSuspended = await service.create(chi, 'gone', { replyTo: id })
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.deepEqual(await countsOf(id), { likes: 1, replies: 0 })

  // Changes made while suspended must not move the counts a second time.
  await service.unlike(chi, id)
  await service.remove(chi, deletedWhileSuspended.id)
  assert.deepEqual(await countsOf(id), { likes: 1, replies: 0 })

  await db.update(members).set({ active: true }).where(eq(members.id, chi))
  assert.deepEqual(await countsOf(id), { likes: 1, replies: 1 })
  assert.equal((await service.thread(null, kept.id))!.ancestors[0]!.replyCount, 1)
  assert.deepEqual(await counterDrift(), [])
})

test('deleting, taking down and restoring a reply move its parent\'s reply count', async () => {
  const { id } = await service.create(ada, 'post')
  const one = await service.create(bayo, 'one', { replyTo: id })
  const two = await service.create(chi, 'two', { replyTo: id })
  // Replies to a reply count on that reply, not on the top post.
  await service.create(ada, 'nested', { replyTo: one.id })
  assert.deepEqual(await countsOf(id), { likes: 0, replies: 2 })
  assert.deepEqual(await countsOf(one.id), { likes: 0, replies: 1 })

  await service.remove(bayo, one.id)
  assert.equal((await countsOf(id)).replies, 1)
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, two.id))
  assert.equal((await countsOf(id)).replies, 0)
  // Taking down an already deleted reply changes nothing.
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, one.id))
  assert.equal((await countsOf(id)).replies, 0)
  await db.update(posts).set({ removedAt: null }).where(eq(posts.id, two.id))
  assert.equal((await countsOf(id)).replies, 1)

  // A reply removed outright (as the load-test cleanup does) stops counting too.
  await db.delete(notifications).where(eq(notifications.postId, two.id))
  await db.delete(posts).where(eq(posts.id, two.id))
  assert.equal((await countsOf(id)).replies, 0)
  assert.deepEqual(await counterDrift(), [])
})

test('deleting a post keeps its counts and leaves other posts\' counts alone', async () => {
  const { id } = await service.create(ada, 'post')
  const other = await service.create(bayo, 'other')
  await service.like(bayo, id)
  await service.like(chi, other.id)
  await service.create(chi, 'reply', { replyTo: id })
  await service.remove(ada, id)
  assert.deepEqual(await countsOf(id), { likes: 1, replies: 1 })
  assert.deepEqual(await countsOf(other.id), { likes: 1, replies: 0 })
  assert.deepEqual(await counterDrift(), [])
})

test('bulk inserts and deletes of likes and replies keep every counter right', async () => {
  const [a, b] = await Promise.all([service.create(ada, 'a'), service.create(bayo, 'b')])
  await db.insert(likes).values([
    { memberId: ada, postId: a.id },
    { memberId: bayo, postId: a.id },
    { memberId: chi, postId: a.id },
    { memberId: ada, postId: b.id },
  ])
  await db.insert(posts).values([
    { authorId: bayo, text: 'r1', replyParentId: a.id, rootId: a.id },
    { authorId: chi, text: 'r2', replyParentId: a.id, rootId: a.id },
    { authorId: chi, text: 'r3', replyParentId: b.id, rootId: b.id, deletedAt: new Date() },
  ])
  assert.deepEqual(await countsOf(a.id), { likes: 3, replies: 2 })
  assert.deepEqual(await countsOf(b.id), { likes: 1, replies: 0 })
  await db.delete(likes).where(eq(likes.postId, a.id))
  assert.deepEqual(await countsOf(a.id), { likes: 0, replies: 2 })
  assert.deepEqual(await counterDrift(), [])
})

test('concurrent likes and unlikes on one post are all counted', async () => {
  const crowd = Array.from({ length: 40 }, (_, i) => ({ id: randomUUID(), handle: `fan${i}` }))
  await db.insert(members).values(crowd)
  const { id } = await service.create(ada, 'popular')

  // Everyone likes at once, some twice.
  await Promise.all(crowd.flatMap((m, i) => (i % 4 === 0 ? [service.like(m.id, id), service.like(m.id, id)] : [service.like(m.id, id)])))
  assert.equal((await countsOf(id)).likes, 40)

  // Half unlike while the others like again (a no-op) and new likes arrive.
  await Promise.all([
    ...crowd.map((m, i) => (i % 2 === 0 ? service.unlike(m.id, id) : service.like(m.id, id))),
    service.like(bayo, id),
    service.like(chi, id),
  ])
  assert.equal((await countsOf(id)).likes, 22)
  assert.equal((await service.feed(null, 1)).posts[0]!.likeCount, 22)
  assert.deepEqual(await counterDrift(), [])
})

test('likes and replies racing their author\'s suspension end up counted correctly', async () => {
  const crowd = Array.from({ length: 20 }, (_, i) => ({ id: randomUUID(), handle: `racer${i}` }))
  await db.insert(members).values(crowd)
  const { id } = await service.create(ada, 'post')

  await Promise.all(
    crowd.flatMap((m, i) => [
      db.insert(likes).values({ memberId: m.id, postId: id }),
      db.insert(posts).values({ authorId: m.id, text: 'reply', replyParentId: id, rootId: id }),
      ...(i % 3 === 0 ? [db.update(members).set({ active: false }).where(eq(members.id, m.id))] : []),
    ]),
  )
  const suspended = crowd.filter((_, i) => i % 3 === 0).length
  assert.deepEqual(await countsOf(id), { likes: 20 - suspended, replies: 20 - suspended })
  assert.deepEqual(await counterDrift(), [])
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

  // A fresh service each time: the ranking is cached per instance.
  const fresh = new PostsService(db)
  const trending = await fresh.trending(null, 5)
  assert.deepEqual(trending.map((p) => p.text), ['two replies', 'liked twice'])
  assert.ok(!trending.some((p) => p.id === quiet.id))
  assert.deepEqual((await fresh.trending(null, 1)).map((p) => p.text), ['two replies'])
})

const trendingTexts = async (svc: PostsService, viewerId: string | null = null) =>
  (await svc.trending(viewerId, 5)).map((p) => p.text)

test('trending counts only likes and live replies by active members, and leaves out removed posts', async () => {
  const dan = randomUUID()
  await db.insert(members).values({ id: dan, handle: 'dan' })
  const liked = await service.create(ada, 'liked by an active member')
  const ghostLiked = await service.create(ada, 'liked by a suspended member')
  const ghostReplied = await service.create(bayo, 'replied to by a suspended member')
  const deletedReply = await service.create(bayo, 'its reply was deleted')
  const takenDown = await service.create(chi, 'taken down')
  const byInactive = await service.create(dan, 'by a suspended author')

  await service.like(bayo, liked.id)
  await service.like(dan, ghostLiked.id)
  await service.create(dan, 'ghost reply', { replyTo: ghostReplied.id })
  const r = await service.create(ada, 'gone', { replyTo: deletedReply.id })
  await service.remove(ada, r.id)
  for (const id of [takenDown.id, byInactive.id]) {
    await service.like(ada, id)
    await service.like(bayo, id)
  }
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, takenDown.id))
  await db.update(members).set({ active: false, status: 'suspended' }).where(eq(members.id, dan))

  assert.deepEqual(await trendingTexts(new PostsService(db)), ['liked by an active member'])
})

test("trending applies each viewer's blocks and mutes to the shared ranking", async () => {
  const dan = randomUUID()
  await db.insert(members).values({ id: dan, handle: 'dan' })
  const top = await service.create(ada, 'top')
  const second = await service.create(bayo, 'second')
  await service.like(bayo, top.id)
  await service.like(chi, top.id)
  await service.like(chi, second.id)

  const fresh = new PostsService(db)
  assert.deepEqual(await trendingTexts(fresh), ['top', 'second'])
  await db.insert(blocks).values({ blockerId: ada, blockedId: chi })
  await db.insert(mutes).values({ muterId: dan, mutedId: bayo })
  assert.deepEqual(await trendingTexts(fresh, chi), ['second']) // blocked by ada
  assert.deepEqual(await trendingTexts(fresh, dan), ['top'])
  assert.deepEqual(await trendingTexts(fresh, bayo), ['top', 'second'])
})

test('a cached trending post that is deleted, taken down or loses its author drops out at once', async () => {
  const kept = await service.create(ada, 'kept')
  const deleted = await service.create(ada, 'deleted')
  const removed = await service.create(bayo, 'removed')
  const suspended = await service.create(chi, 'author suspended')
  for (const { id } of [kept, deleted, removed, suspended]) await service.like(bayo, id)

  const fresh = new PostsService(db)
  assert.equal((await trendingTexts(fresh)).length, 4)
  await service.remove(ada, deleted.id)
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, removed.id))
  await db.update(members).set({ active: false, status: 'suspended' }).where(eq(members.id, chi))
  await service.like(chi, kept.id)
  const shown = await fresh.trending(null, 5)
  assert.deepEqual(shown.map((p) => p.text), ['kept'])
  // Counts are read fresh even when the ranking is cached; chi's like does not count.
  assert.equal(shown[0]!.likeCount, 1)
})

test('the trending ranking is reused for a minute, then refreshed without making callers wait', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  t.after(() => mock.timers.reset())
  const first = await service.create(ada, 'first')
  const later = await service.create(bayo, 'later')
  await service.like(chi, first.id)

  const fresh = new PostsService(db)
  assert.deepEqual(await trendingTexts(fresh), ['first'])
  await service.like(ada, later.id)
  await service.like(chi, later.id)
  mock.timers.tick(TRENDING_TTL_MS - 1)
  assert.deepEqual(await trendingTexts(fresh), ['first'])

  mock.timers.tick(1)
  // Expired: this call still gets the old ranking and starts a refresh.
  assert.deepEqual(await trendingTexts(fresh), ['first'])
  let now: string[] = []
  for (let i = 0; i < 100 && now.length < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    now = await trendingTexts(fresh)
  }
  assert.deepEqual(now, ['later', 'first'])
})

test('concurrent first calls share one ranking query', async () => {
  const { id } = await service.create(ada, 'only')
  await service.like(bayo, id)
  const fresh = new PostsService(db)
  let rankings = 0
  const rank = (fresh as unknown as { rankTrending: () => Promise<string[]> }).rankTrending.bind(fresh)
  ;(fresh as unknown as { rankTrending: () => Promise<string[]> }).rankTrending = () => {
    rankings++
    return rank()
  }
  const results = await Promise.all(Array.from({ length: 5 }, () => trendingTexts(fresh)))
  assert.deepEqual(results, Array.from({ length: 5 }, () => ['only']))
  assert.equal(rankings, 1)
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
