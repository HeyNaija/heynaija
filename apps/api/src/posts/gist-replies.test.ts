import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, follows, gists, members, notifications, posts } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { PostsService, ParentNotFoundError, QuotedPostNotFoundError, ReplyNotAllowedError } from './posts.service.js'

const service = new PostsService(db)
const host = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const dayo = randomUUID()
let gist: string
const makeGist = async (hostId: string, title: string) =>
  (await db.insert(gists).values({ hostId, title }).returning({ id: gists.id }))[0]!.id

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: host, handle: 'host' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
    { id: dayo, handle: 'dayo' },
  ])
  gist = await makeGist(host, 'Jollof wars')
})
after(() => pool.end())

const reply = (author: string, text: string, replyTo?: string) => service.create(author, text, { gist, replyTo })

test('a reply in a Gist is a post with the gist id, and replies under it inherit it', async () => {
  const top = await reply(bayo, 'Team party jollof #jollof @chi')
  const nested = await reply(chi, 'Nope', top.id)
  const rows = await db.select().from(posts)
  const row = (id: string) => rows.find((r) => r.id === id)!
  assert.equal(row(top.id).gistId, gist)
  assert.equal(row(top.id).replyParentId, null)
  assert.equal(row(top.id).rootId, null)
  assert.equal(row(nested.id).gistId, gist)
  assert.equal(row(nested.id).replyParentId, top.id)
  assert.equal(row(nested.id).rootId, top.id)
  assert.equal(row(top.id).communityId, null)
})

test('replying under a post of another Gist, or of no Gist, is refused', async () => {
  const other = await makeGist(bayo, 'Other')
  const elsewhere = await service.create(bayo, 'elsewhere', { gist: other })
  const plain = await service.create(bayo, 'plain post')
  await assert.rejects(reply(chi, 'x', elsewhere.id), ParentNotFoundError)
  await assert.rejects(reply(chi, 'x', plain.id), ParentNotFoundError)
  await assert.rejects(service.create(chi, 'x', { gist: randomUUID() }), ParentNotFoundError)
})

test('the ordinary post route cannot reply to, quote, like, repost or bookmark a reply in a Gist', async () => {
  const top = await reply(bayo, 'inside')
  await assert.rejects(service.create(chi, 'sneaky', { replyTo: top.id }), ParentNotFoundError)
  await assert.rejects(service.create(chi, 'quoting', { quote: top.id }), QuotedPostNotFoundError)
  assert.equal(await service.like(chi, top.id), false)
  assert.equal(await service.repost(chi, top.id), false)
  assert.equal(await service.bookmark(chi, top.id), false)
  assert.equal(await service.post(chi, top.id), null)
  assert.equal(await service.thread(chi, top.id), null)
  assert.equal(await service.replies(chi, top.id), null)
})

test('replies in a Gist are in no feed, profile, search, hashtag page, trending, Discover or bookmark list', async () => {
  const top = await reply(bayo, 'secret #jollofwars @chi')
  const nested = await reply(chi, 'also secret #jollofwars', top.id)
  await reply(host, 'host reply #jollofwars')
  await db.update(posts).set({ createdAt: sql`now() - interval '1 minute'` })
  await db.insert(follows).values([
    { followerId: dayo, followeeId: bayo },
    { followerId: dayo, followeeId: chi },
    { followerId: dayo, followeeId: host },
  ])
  await service.create(bayo, 'a normal post #jollofwars')

  const lists = async (viewer: string | null) => [
    await service.feed(viewer, 50),
    ...(viewer ? [await service.followingFeed(viewer, 50)] : []),
    await service.withHashtag(viewer, 'jollofwars', 50),
    ...(await Promise.all((['posts', 'replies', 'media'] as const).map((filter) => service.byAuthor(viewer, bayo, 50, undefined, filter)))),
  ]
  for (const viewer of [null, dayo, bayo, host]) {
    for (const list of await lists(viewer)) {
      const texts = list.posts.map((p) => p.text)
      assert.ok(!texts.some((t) => /secret|host reply/.test(t)), `${viewer}: ${texts.join(' | ')}`)
    }
  }
  for (const viewer of [null, dayo, bayo]) {
    assert.ok(!(await service.search(viewer, 'secret', 10)).length)
    assert.ok(!(await service.discover(viewer, 50)).posts.some((p) => /secret|host reply/.test(p.text)))
    assert.ok(!(await new PostsService(db).trending(viewer, 5)).some((p) => /secret/.test(p.text)))
  }
  await db.execute(sql`insert into bookmarks (member_id, post_id) values (${chi}, ${nested.id})`)
  assert.deepEqual((await service.bookmarked(chi, 10)).posts, [])
})

test('the Gist\'s replies list the host\'s first, then others\', each newest first, and page', async () => {
  const a = await reply(bayo, 'first from bayo')
  const b = await reply(chi, 'second from chi')
  const h = await reply(host, 'host answer')
  const c = await reply(bayo, 'third from bayo')
  const page = await service.gistReplies(dayo, gist, 20, 'newest')
  assert.deepEqual(page.replies.map((r) => r.id), [h.id, c.id, b.id, a.id])
  const first = await service.gistReplies(dayo, gist, 2, 'newest')
  assert.equal(first.replies.length, 2)
  assert.ok(first.cursor)
  const rest = await service.gistReplies(dayo, gist, 2, 'newest', first.cursor!)
  assert.deepEqual([...first.replies, ...rest.replies].map((r) => r.id), [h.id, c.id, b.id, a.id])
  assert.equal(rest.cursor, null)
  const oldest = await service.gistReplies(dayo, gist, 20, 'oldest')
  assert.deepEqual(oldest.replies.map((r) => r.id), [h.id, a.id, b.id, c.id])
})

test('a reply\'s own replies are read through the Gist, and only if it belongs to it', async () => {
  const top = await reply(bayo, 'top')
  const n1 = await reply(chi, 'nested one', top.id)
  const n2 = await reply(bayo, 'nested two', top.id)
  const page = await service.repliesInGist(dayo, gist, top.id, 20, undefined, 'oldest')
  assert.deepEqual(page!.replies.map((r) => r.id), [n2.id, n1.id])
  const other = await makeGist(bayo, 'Other')
  assert.equal(await service.repliesInGist(dayo, other, top.id, 20, undefined, 'newest'), null)
  assert.equal((await service.postInGist(dayo, gist, n1.id))!.text, 'nested one')
  assert.equal(await service.postInGist(dayo, other, n1.id), null)
})

test('the Gist\'s reply count counts live replies of active members at any depth', async () => {
  const top = await reply(bayo, 'top')
  const nested = await reply(chi, 'nested', top.id)
  await reply(chi, 'gone')
  assert.equal(await service.gistReplyCount(gist), 3)
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, nested.id))
  assert.equal(await service.gistReplyCount(gist), 2)
  await db.update(members).set({ active: false }).where(eq(members.id, bayo))
  assert.equal(await service.gistReplyCount(gist), 1)
})

test('the Gist\'s reply controls: everyone, following, mentioned, off; the host always may; blocks refuse', async () => {
  const may = async (viewer: string) => (await service.gistReplies(viewer, gist, 20, 'newest')).viewerCanReply
  assert.equal(await may(bayo), true)
  await db.update(gists).set({ replyAudience: 'off' }).where(eq(gists.id, gist))
  assert.equal(await may(bayo), false)
  assert.equal(await may(host), true)
  await assert.rejects(reply(bayo, 'closed'), ReplyNotAllowedError)
  await reply(host, 'host still can')

  await db.update(gists).set({ replyAudience: 'following' }).where(eq(gists.id, gist))
  assert.equal(await may(bayo), false)
  await db.insert(follows).values({ followerId: host, followeeId: bayo })
  assert.equal(await may(bayo), true)
  await reply(bayo, 'followed by the host')
  await assert.rejects(reply(chi, 'not followed'), ReplyNotAllowedError)

  await db.update(gists).set({ replyAudience: 'mentioned' }).where(eq(gists.id, gist))
  assert.equal(await may(chi), false)
  await reply(host, 'question for @chi')
  assert.equal(await may(chi), true)
  await reply(chi, 'answer')
  await assert.rejects(reply(dayo, 'not mentioned'), ReplyNotAllowedError)

  await db.update(gists).set({ replyAudience: 'everyone' }).where(eq(gists.id, gist))
  await db.insert(blocks).values({ blockerId: host, blockedId: dayo })
  assert.equal(await may(dayo), false)
  await assert.rejects(reply(dayo, 'blocked by the host'), ReplyNotAllowedError)
})

test('the Gist\'s reply controls apply to replies under a reply too', async () => {
  const top = await reply(bayo, 'top')
  await db.update(gists).set({ replyAudience: 'off' }).where(eq(gists.id, gist))
  await assert.rejects(reply(chi, 'nested', top.id), ReplyNotAllowedError)
  assert.equal((await service.postInGist(chi, gist, top.id))!.viewerCanReply, false)
  assert.equal((await service.postInGist(host, gist, top.id))!.viewerCanReply, true)
})

test('a block between the replier and the author of the reply they answer refuses it', async () => {
  const top = await reply(bayo, 'top')
  await db.insert(blocks).values({ blockerId: bayo, blockedId: chi })
  await assert.rejects(reply(chi, 'nested', top.id), ParentNotFoundError)
})

test('the host can hide a reply: a placeholder of its own, text gone, the branch under it still reachable', async () => {
  const top = await reply(bayo, 'rude words')
  const nested = await reply(chi, 'a fair answer', top.id)
  assert.equal(await service.hideInGist(gist, top.id, true), true)
  const page = await service.gistReplies(dayo, gist, 20, 'newest')
  assert.deepEqual(page.replies.map((r) => ({ id: r.id, unavailable: 'unavailable' in r, hidden: 'hiddenByHost' in r && r.hiddenByHost })), [
    { id: top.id, unavailable: true, hidden: true },
  ])
  assert.equal(JSON.stringify(page).includes('rude words'), false)
  assert.equal((await service.repliesInGist(dayo, gist, top.id, 20, undefined, 'newest'))!.replies[0]!.id, nested.id)
  assert.equal(await service.postInGist(dayo, gist, top.id), null)
  await assert.rejects(reply(dayo, 'under the hidden one', top.id), ParentNotFoundError)
  assert.equal(await service.gistReplyCount(gist), 1)

  assert.equal(await service.hideInGist(gist, top.id, false), true)
  assert.equal((await service.gistReplies(dayo, gist, 20, 'newest')).replies[0]!.id, top.id)
  assert.equal('unavailable' in (await service.gistReplies(dayo, gist, 20, 'newest')).replies[0]!, false)
  assert.equal(await service.hideInGist(randomUUID(), top.id, true), false)
})

test('a reply taken down by a moderator is the ordinary placeholder, apart from hiding', async () => {
  const top = await reply(bayo, 'removed text')
  await reply(chi, 'survivor', top.id)
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, top.id))
  const page = await service.gistReplies(dayo, gist, 20, 'newest')
  assert.equal(page.replies.length, 1)
  assert.equal('unavailable' in page.replies[0]! && page.replies[0].unavailable, true)
  assert.equal('hiddenByHost' in page.replies[0]!, false)
  assert.equal(JSON.stringify(page).includes('removed text'), false)
  assert.equal((await db.select().from(posts).where(eq(posts.id, top.id)))[0]!.hiddenByHostAt, null)
})

test('a poll or a quote cannot be put in a Gist reply, whatever the route', async () => {
  const plain = await service.create(bayo, 'plain')
  const top = await reply(bayo, 'top')
  await assert.rejects(db.insert(posts).values({ authorId: bayo, text: 'quote', gistId: gist, quotePostId: plain.id }))
  await assert.rejects(db.execute(sql`insert into post_polls (post_id) values (${top.id})`))
})

test('a reply to the host is notified as a reply, with the post in the Gist', async () => {
  const top = await reply(bayo, 'hello host')
  const nested = await reply(chi, 'hello bayo', top.id)
  const rows = await db.select().from(notifications)
  assert.deepEqual(
    rows.map((n) => ({ kind: n.kind, recipientId: n.recipientId, actorId: n.actorId, postId: n.postId })).sort((a, b) => a.recipientId.localeCompare(b.recipientId)),
    [
      { kind: 'reply', recipientId: host, actorId: bayo, postId: top.id },
      { kind: 'reply', recipientId: bayo, actorId: chi, postId: nested.id },
    ].sort((a, b) => a.recipientId.localeCompare(b.recipientId)),
  )
})

test('liking a reply in a Gist counts, and unliking takes it back', async () => {
  const top = await reply(bayo, 'like me')
  assert.equal(await service.likeInGist(chi, gist, top.id), true)
  assert.equal((await service.postInGist(chi, gist, top.id))!.likeCount, 1)
  assert.equal((await service.postInGist(chi, gist, top.id))!.viewerLiked, true)
  await service.unlike(chi, top.id)
  assert.equal((await service.postInGist(chi, gist, top.id))!.likeCount, 0)
  assert.equal(await service.likeInGist(chi, randomUUID(), top.id), false)
})
