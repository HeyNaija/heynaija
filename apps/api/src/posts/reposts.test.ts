import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, follows, members, mutes, posts, reposts } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { type PostPage, PostsService, type PostView, QuotedPostNotFoundError } from './posts.service.js'

const service = new PostsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const dayo = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo', displayName: 'Bayo A.' },
    { id: chi, handle: 'chi' },
    { id: dayo, handle: 'dayo' },
  ])
})
after(() => pool.end())

const follow = (followerId: string, followeeId: string) => db.insert(follows).values({ followerId, followeeId })

/** Each entry as text, with who reposted it when it is there as a repost. */
const entries = (page: PostPage) =>
  page.posts.map((p) => (p.reason === 'repost' ? `${p.text} <- @${p.repostedBy!.handle}` : p.text))
const following = async (viewer: string) => entries(await service.followingFeed(viewer, 50))
const profile = async (viewer: string | null, author: string) => entries(await service.byAuthor(viewer, author, 50))

const repostCount = async (id: string) =>
  (await db.select({ n: posts.repostCount }).from(posts).where(eq(posts.id, id)))[0]!.n

// Posts whose stored repost count disagrees with what readers should see.
const drift = async () =>
  (
    await db.execute<{ id: string }>(sql`
      select p.id from posts p
      where p.repost_count <> (select count(*) from reposts r join members m on m.id = r.member_id and m.active where r.post_id = p.id)`)
  ).rows

test('reposts are idempotent, counted, and personal to the viewer', async () => {
  const { id } = await service.create(ada, 'worth sharing')
  assert.equal(await service.repost(bayo, id), true)
  assert.equal(await service.repost(bayo, id), true)
  await service.repost(chi, id)
  assert.equal(await repostCount(id), 2)

  const seenBy = async (viewer: string | null) => (await service.post(viewer, id))!
  assert.equal((await seenBy(bayo)).viewerReposted, true)
  assert.equal((await seenBy(dayo)).viewerReposted, false)
  assert.equal((await seenBy(null)).viewerReposted, false)
  assert.equal((await seenBy(null)).repostCount, 2)

  await service.unrepost(bayo, id)
  await service.unrepost(bayo, id)
  assert.equal(await repostCount(id), 1)
  assert.equal((await seenBy(bayo)).viewerReposted, false)
  assert.deepEqual(await drift(), [])
})

test('you cannot repost a post that is missing, deleted, taken down or hidden by a block', async () => {
  assert.equal(await service.repost(bayo, randomUUID()), false)

  const deleted = await service.create(ada, 'deleted')
  await service.remove(ada, deleted.id)
  assert.equal(await service.repost(bayo, deleted.id), false)

  const removed = await service.create(ada, 'removed')
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, removed.id))
  assert.equal(await service.repost(bayo, removed.id), false)

  const blocked = await service.create(ada, 'blocked')
  await db.insert(blocks).values({ blockerId: ada, blockedId: bayo })
  assert.equal(await service.repost(bayo, blocked.id), false)
  assert.equal(await db.$count(reposts), 0)
})

test('reposts by a suspended member stop counting, and count again once, on reinstatement', async () => {
  const { id } = await service.create(ada, 'popular')
  await service.repost(bayo, id)
  await service.repost(chi, id)
  await db.update(members).set({ active: false }).where(eq(members.id, bayo))
  assert.equal(await repostCount(id), 1)
  // Taking back a repost while suspended changes nothing that was counted.
  await service.unrepost(bayo, id)
  assert.equal(await repostCount(id), 1)
  await db.update(members).set({ active: true }).where(eq(members.id, bayo))
  assert.equal(await repostCount(id), 1)

  await service.repost(bayo, id)
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  await db.update(members).set({ active: true }).where(eq(members.id, chi))
  assert.equal(await repostCount(id), 2)

  // Bulk statements update each post once and stay right.
  const other = await service.create(bayo, 'other')
  await db.insert(reposts).values([dayo, ada, chi].map((memberId) => ({ memberId, postId: other.id })))
  await db.delete(reposts).where(eq(reposts.memberId, dayo))
  assert.equal(await repostCount(other.id), 2)
  assert.deepEqual(await drift(), [])
})

test('a repost brings a post into followers\' Following feed, at the time of the repost', async () => {
  await follow(ada, bayo)
  const older = await service.create(chi, 'from chi, whom ada does not follow')
  await service.create(ada, 'ada, after it')
  await service.create(dayo, 'from dayo, never reposted')

  assert.deepEqual(await following(ada), ['ada, after it'])
  await service.repost(bayo, older.id)
  assert.deepEqual(await following(ada), ['from chi, whom ada does not follow <- @bayo', 'ada, after it'])

  const [reposted] = (await service.followingFeed(ada, 50)).posts
  assert.equal(reposted!.reason, 'repost')
  assert.deepEqual(reposted!.repostedBy, { id: bayo, handle: 'bayo', displayName: 'Bayo A.' })
  // It is chi's post, with chi's own time; only its place in the feed moved.
  assert.equal(reposted!.authorHandle, 'chi')
  // Nobody else's feed changes, and reposts never enter Latest twice.
  assert.deepEqual(await following(dayo), ['from dayo, never reposted'])
  assert.deepEqual((await service.feed(ada, 50)).posts.map((p) => p.text), [
    'from dayo, never reposted',
    'ada, after it',
    'from chi, whom ada does not follow',
  ])
})

test('a post reposted by several people, or also followed directly, appears once, at its latest way in', async () => {
  await follow(ada, bayo)
  await follow(ada, chi)
  await follow(ada, dayo)
  const post = await service.create(chi, 'chi says')
  assert.deepEqual(await following(ada), ['chi says'])

  await service.repost(bayo, post.id)
  assert.deepEqual(await following(ada), ['chi says <- @bayo'])
  await service.create(ada, 'in between')
  await service.repost(dayo, post.id)
  assert.deepEqual(await following(ada), ['chi says <- @dayo', 'in between'])

  // The viewer's own repost counts as a way in too.
  await service.repost(ada, post.id)
  assert.deepEqual(await following(ada), ['chi says <- @ada', 'in between'])

  // Taking reposts back moves it back down, to the latest that remains.
  await service.unrepost(ada, post.id)
  await service.unrepost(dayo, post.id)
  assert.deepEqual(await following(ada), ['in between', 'chi says <- @bayo'])
  await service.unrepost(bayo, post.id)
  assert.deepEqual(await following(ada), ['in between', 'chi says'])
})

test('Following pages walk posts and reposts once each, in order, across equal times', async () => {
  await follow(ada, bayo)
  const at = new Date('2026-10-01T12:00:00.000Z')
  const others = await db
    .insert(posts)
    .values(Array.from({ length: 6 }, (_, i) => ({ authorId: chi, text: `chi ${i}`, createdAt: new Date(at.getTime() - 60_000) })))
    .returning({ id: posts.id })
  // Bayo's own posts and his reposts of chi's all at the same moment, to the microsecond.
  await db.insert(posts).values(Array.from({ length: 4 }, (_, i) => ({ authorId: bayo, text: `bayo ${i}`, createdAt: at })))
  await db.insert(reposts).values(others.map(({ id }) => ({ memberId: bayo, postId: id, createdAt: at })))
  await db.execute(sql`update reposts set created_at = created_at + interval '7 microseconds'`)

  const all = await following(ada)
  assert.equal(all.length, 10)
  const seen: string[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await service.followingFeed(ada, 3, cursor)
    seen.push(...entries(page))
    cursor = page.cursor ?? undefined
    pages++
  } while (cursor)
  assert.equal(pages, 4)
  assert.deepEqual(seen, all)
  // The reposts are 7 microseconds newer than bayo's posts, so they come first.
  assert.ok(seen.slice(0, 6).every((e) => e.endsWith('<- @bayo')))
})

test('a profile\'s Posts tab has their posts and reposts; Replies and Media do not', async () => {
  const theirs = await service.create(ada, 'ada wrote this')
  const mine = await service.create(bayo, 'bayo wrote this')
  await service.create(bayo, 'bayo replied', { replyTo: theirs.id })
  await service.repost(bayo, theirs.id)
  // Reposting your own post moves it up rather than showing it twice.
  await service.create(bayo, 'bayo again')
  await service.repost(bayo, mine.id)

  assert.deepEqual(await profile(null, bayo), ['bayo wrote this <- @bayo', 'bayo again', 'ada wrote this <- @bayo'])
  assert.deepEqual(await profile(null, ada), ['ada wrote this'])
  assert.deepEqual((await service.byAuthor(null, bayo, 50, undefined, 'replies')).posts.map((p) => p.text), ['bayo replied'])
  assert.deepEqual((await service.byAuthor(null, bayo, 50, undefined, 'media')).posts, [])
})

test('blocks and mutes apply to the reposter and to the original author', async () => {
  await follow(ada, bayo)
  const post = await service.create(chi, 'chi post')
  await service.repost(bayo, post.id)
  const sees = ['chi post <- @bayo']
  assert.deepEqual(await following(ada), sees)

  // The original author: muted, blocked by the viewer, or blocking the viewer.
  await db.insert(mutes).values({ muterId: ada, mutedId: chi })
  assert.deepEqual(await following(ada), [])
  assert.deepEqual(await profile(ada, bayo), [])
  await db.delete(mutes)
  await db.insert(blocks).values({ blockerId: ada, blockedId: chi })
  assert.deepEqual(await following(ada), [])
  await db.delete(blocks)
  await db.insert(blocks).values({ blockerId: chi, blockedId: ada })
  assert.deepEqual(await following(ada), [])
  assert.deepEqual(await profile(ada, bayo), [])
  await db.delete(blocks)
  assert.deepEqual(await following(ada), sees)

  // The reposter: muting them hides their reposts from Following, but their
  // profile, opened on purpose, still lists them.
  await db.insert(mutes).values({ muterId: ada, mutedId: bayo })
  assert.deepEqual(await following(ada), [])
  assert.deepEqual(await profile(ada, bayo), sees)
  await db.delete(mutes)
  await db.insert(blocks).values({ blockerId: bayo, blockedId: ada })
  assert.deepEqual(await following(ada), [])
  assert.deepEqual(await profile(ada, bayo), [])
  await db.delete(blocks)

  // A hidden reposter is passed over for the next way in: here, following chi.
  await follow(ada, chi)
  await db.insert(mutes).values({ muterId: ada, mutedId: bayo })
  assert.deepEqual(await following(ada), ['chi post'])
  // And a suspended reposter's reposts are gone for everyone.
  await db.delete(mutes)
  await db.update(members).set({ active: false }).where(eq(members.id, bayo))
  assert.deepEqual(await following(ada), ['chi post'])
  assert.deepEqual(await profile(null, bayo), [])
})

test('a deleted or taken-down original leaves every repost of it; a restore brings them back', async () => {
  await follow(ada, bayo)
  const post = await service.create(chi, 'soon gone')
  await service.repost(bayo, post.id)

  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, post.id))
  assert.deepEqual(await following(ada), [])
  assert.deepEqual(await profile(null, bayo), [])
  await db.update(posts).set({ removedAt: null }).where(eq(posts.id, post.id))
  assert.deepEqual(await following(ada), ['soon gone <- @bayo'])

  await service.remove(chi, post.id)
  assert.deepEqual(await following(ada), [])
  assert.deepEqual(await profile(null, bayo), [])
  // The repost row stays, kept out of sight, so nothing is lost if a moderator restores the post.
  assert.equal(await db.$count(reposts), 1)
})

const quoteOf = (post: PostView) => post.quote

test('a quote is its own post, embedding the post it quotes', async () => {
  const original = await service.create(ada, 'the original')
  const quote = await service.create(bayo, 'my take on it', { quote: original.id })

  const [first] = (await service.feed(null, 10)).posts
  assert.equal(first!.id, quote.id)
  assert.equal(first!.text, 'my take on it')
  const embedded = quoteOf(first!)
  assert.ok(embedded && !embedded.unavailable)
  assert.deepEqual(
    { id: embedded.id, authorHandle: embedded.authorHandle, text: embedded.text, images: embedded.images },
    { id: original.id, authorHandle: 'ada', text: 'the original', images: [] },
  )
  assert.ok(embedded.createdAt instanceof Date)
  // Ordinary posts have no quote; quotes are not counted as reposts.
  assert.equal(quoteOf((await service.post(null, original.id))!), null)
  assert.equal(await repostCount(original.id), 0)
  // A quote shows on its author's profile and in followers' feeds like any post.
  await follow(chi, bayo)
  assert.deepEqual(await following(chi), ['my take on it'])
  assert.deepEqual(await profile(null, bayo), ['my take on it'])
})

test('a quoted post that is deleted, taken down or hidden from the reader becomes a placeholder', async () => {
  const original = await service.create(ada, 'quoted')
  const quote = await service.create(bayo, 'quoting', { quote: original.id })
  const seenBy = async (viewer: string | null) => quoteOf((await service.post(viewer, quote.id))!)
  const placeholder = { unavailable: true }

  await db.insert(blocks).values({ blockerId: ada, blockedId: chi })
  assert.deepEqual(await seenBy(chi), placeholder)
  assert.equal((await seenBy(dayo))?.unavailable, undefined)
  await db.insert(mutes).values({ muterId: dayo, mutedId: ada })
  assert.deepEqual(await seenBy(dayo), placeholder)

  await db.update(members).set({ active: false }).where(eq(members.id, ada))
  assert.deepEqual(await seenBy(null), placeholder)
  await db.update(members).set({ active: true }).where(eq(members.id, ada))

  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, original.id))
  assert.deepEqual(await seenBy(null), placeholder)
  await db.update(posts).set({ removedAt: null }).where(eq(posts.id, original.id))
  await service.remove(ada, original.id)
  assert.deepEqual(await seenBy(null), placeholder)
  // The placeholder says nothing about why, and carries none of the post.
  assert.deepEqual(Object.keys((await seenBy(null))!), ['unavailable'])
  // The quote itself stays up.
  assert.equal((await service.post(null, quote.id))!.text, 'quoting')
})

test('quotes in thread replies carry their quoted post too', async () => {
  const root = await service.create(ada, 'root')
  const elsewhere = await service.create(chi, 'elsewhere')
  await service.create(bayo, 'see this', { replyTo: root.id, quote: elsewhere.id })
  const thread = (await service.thread(dayo, root.id))!
  const [reply] = thread.replies
  assert.ok(reply && !reply.unavailable)
  assert.equal(reply.repostCount, 0)
  assert.equal(reply.viewerReposted, false)
  const embedded = reply.quote
  assert.ok(embedded && !embedded.unavailable)
  assert.equal(embedded.text, 'elsewhere')
  assert.ok(embedded.createdAt instanceof Date)
})

test('you cannot quote a post that is missing, deleted, or across a block', async () => {
  await assert.rejects(service.create(bayo, 'x', { quote: randomUUID() }), QuotedPostNotFoundError)
  const gone = await service.create(ada, 'gone')
  await service.remove(ada, gone.id)
  await assert.rejects(service.create(bayo, 'x', { quote: gone.id }), QuotedPostNotFoundError)
  const kept = await service.create(ada, 'kept')
  await db.insert(blocks).values({ blockerId: ada, blockedId: bayo })
  await assert.rejects(service.create(bayo, 'x', { quote: kept.id }), QuotedPostNotFoundError)
  assert.equal(await db.$count(posts), 2)
})
