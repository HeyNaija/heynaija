import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, follows, members, mutes, posts, reports } from '@heynaija/db'
import { eq, ne, sql } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { DISCOVER_RULES, decodeDiscoverCursor, discoverMoment, encodeDiscoverCursor } from './discover.js'
import { type DiscoverPage, InvalidCursorError, PostsService } from './posts.service.js'

const service = new PostsService(db)
const kemi = randomUUID() // the reader
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const dayo = randomUUID()
const eze = randomUUID()
const femi = randomUUID()
const lagos = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: kemi, handle: 'kemi' },
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo', displayName: 'Bayo A.' },
    { id: chi, handle: 'chi' },
    { id: dayo, handle: 'dayo' },
    { id: eze, handle: 'eze' },
    { id: femi, handle: 'femi' },
  ])
  await db.insert(communities).values({ id: lagos, slug: 'lagos', name: 'Lagos', description: 'Eko' })
})
after(() => pool.end())

const follow = (followerId: string, followeeId: string) => db.insert(follows).values({ followerId, followeeId })

/** A top-level post, `hoursAgo` old. */
async function post(author: string, text: string, hoursAgo = 1, community?: string) {
  const { id } = await service.create(author, text, community ? { communitySlug: community } : {})
  await db.update(posts).set({ createdAt: sql`now() - make_interval(secs => ${hoursAgo * 3600})` }).where(eq(posts.id, id))
  return id
}

const reply = async (author: string, to: string, text = 'reply') => (await service.create(author, text, { replyTo: to })).id

/** Members who exist only to like things. */
async function likers(n: number) {
  const ids = Array.from({ length: n }, () => randomUUID())
  await db.insert(members).values(ids.map((id, i) => ({ id, handle: `liker_${i}` })))
  return ids
}

/**
 * Moves everything a little into the past, so that Discover, which ranks as of
 * the moment it is called, sees all of it however the clocks of this process
 * and the database differ.
 */
async function settle() {
  await db.execute(sql`update posts set created_at = created_at - interval '1 minute'`)
  await db.execute(sql`update likes set created_at = created_at - interval '1 minute'`)
  await db.execute(sql`update reposts set created_at = created_at - interval '1 minute'`)
}

/** Each post as text, with why it is there. */
const entries = (page: DiscoverPage) =>
  page.posts.map((p) =>
    p.reason === 'network'
      ? `${p.text} <- @${p.via!.handle} ${p.via!.action}${p.via!.others ? ` +${p.via!.others}` : ''}`
      : `${p.text} (${p.reason})`,
  )

const discover = async (viewer = kemi, limit = 50) => {
  await settle()
  return entries(await service.discover(viewer, limit))
}

test('busier posts rank higher, and posts lose ground as they age', async () => {
  // 2 people replying (4 points) is above 3 likes (3 points) at the same age.
  const talked = await post(ada, 'talked about', 2)
  await reply(bayo, talked)
  await reply(chi, talked)
  const liked = await post(bayo, 'liked', 2)
  for (const m of [ada, chi, dayo]) await service.like(m, liked)
  // 6 likes 30 hours ago (6 / 32^1.5) is below 1 like an hour ago (1 / 3^1.5).
  const old = await post(chi, 'old but busy', 30)
  for (const m of [ada, bayo, dayo, eze, femi, kemi]) await service.like(m, old)
  const fresh = await post(dayo, 'fresh', 1)
  await service.like(eze, fresh)

  assert.deepEqual(await discover(), ['talked about (active)', 'liked (active)', 'fresh (active)', 'old but busy (active)'])
})

test('a member counts once in a conversation, wherever they reply, and the author not at all', async () => {
  // bayo replies three times and ada, the author, once: 2 points.
  const one = await post(ada, 'one person, many replies', 1)
  const first = await reply(bayo, one)
  await reply(bayo, one)
  await reply(ada, first, 'the author answering')
  await reply(bayo, first, 'deeper down')
  // chi and dayo, dayo deep in the conversation: 4 points.
  const two = await post(eze, 'two people', 1)
  const middle = await reply(chi, two)
  await reply(dayo, middle, 'deep in the conversation still counts')

  assert.deepEqual(await discover(), ['two people (active)', 'one person, many replies (active)'])
})

test('every recent top-level post by others that is still live, a quiet one too, and nothing older', async () => {
  const recent = await post(ada, 'recent', 71)
  await service.like(bayo, recent)
  const tooOld = await post(ada, 'too old', 73)
  await service.like(bayo, tooOld)
  await reply(chi, recent, 'a reply is not shown on its own')
  await post(bayo, 'nobody took part', 1)
  const mine = await post(kemi, 'my own', 1)
  await service.like(bayo, mine)
  const gone = await post(chi, 'deleted', 1)
  await service.like(bayo, gone)
  await service.remove(chi, gone)

  // Nobody took part in bayo's post, but every post starts with a point, so it is seen, and says it is new.
  assert.deepEqual(await discover(), ['nobody took part (recent)', 'recent (active)'])
})

test('each post says why it is there, naming only what is public', async () => {
  await follow(kemi, bayo)
  await follow(kemi, dayo)
  await follow(kemi, chi)
  await db.insert(communityMemberships).values([
    { communityId: lagos, memberId: kemi },
    { communityId: lagos, memberId: femi },
  ])

  const replied = await post(ada, 'bayo replied', 1)
  await reply(bayo, replied)
  // The one named is the latest to act: dayo, after bayo.
  const shared = await post(eze, 'shared by two I follow', 1)
  await service.repost(bayo, shared)
  await service.repost(dayo, shared)
  await db.execute(sql`update reposts set created_at = now() - interval '10 minutes' where member_id = ${bayo}`)
  const quoted = await post(femi, 'dayo quoted', 1)
  await service.create(dayo, 'look at this', { quote: quoted })
  // Who liked a post is not public: bayo's like counts as a like, and is not named.
  const likedByBayo = await post(ada, 'liked by bayo', 1)
  await service.like(bayo, likedByBayo)
  await post(chi, 'by someone I follow', 1)
  await post(femi, 'in Lagos', 1, 'lagos')

  await settle()
  const page = await service.discover(kemi, 50)
  const why = new Map(entries(page).map((e) => [e.replace(/ [(<].*$/, ''), e]))
  assert.equal(why.get('bayo replied'), 'bayo replied <- @bayo replied')
  assert.equal(why.get('shared by two I follow'), 'shared by two I follow <- @dayo reposted +1')
  assert.equal(why.get('dayo quoted'), 'dayo quoted <- @dayo quoted')
  assert.equal(why.get('liked by bayo'), 'liked by bayo (active)')
  assert.equal(why.get('by someone I follow'), 'by someone I follow (following)')
  assert.equal(why.get('in Lagos'), 'in Lagos (community)')
  // A quote is a post of its own, here by someone kemi follows.
  assert.equal(why.get('look at this'), 'look at this (following)')

  const named = page.posts.find((p) => p.text === 'bayo replied')!
  assert.deepEqual(named.via, { id: bayo, handle: 'bayo', displayName: 'Bayo A.', action: 'replied', others: 0 })
  assert.equal(page.posts.find((p) => p.text === 'in Lagos')!.via, undefined)
})

test('people the reader follows add 3 points each when they reply, quote or repost, and 2 as the author', async () => {
  await follow(kemi, bayo)
  await follow(kemi, eze)
  // Both have two people replying (4 points); bayo's reply adds 3 for kemi.
  const plain = await post(ada, 'two strangers replied', 1)
  await reply(chi, plain)
  await reply(dayo, plain)
  const viaBayo = await post(femi, 'bayo and a stranger replied', 1)
  await reply(bayo, viaBayo)
  await reply(chi, viaBayo)
  // eze's quiet post (2 points for following him) is above one like (1 point).
  await post(eze, 'quiet, by eze', 1)
  const oneLike = await post(chi, 'one like', 1)
  await service.like(dayo, oneLike)

  assert.deepEqual(await discover(), [
    'bayo and a stranger replied <- @bayo replied',
    'two strangers replied (active)',
    'quiet, by eze (following)',
    'one like (active)',
  ])
})

test("an author's posts are spread out: their second scores half, their third a quarter", async () => {
  const people = await likers(8)
  const liked = async (author: string, text: string, n: number) => {
    const id = await post(author, text, 2)
    for (const m of people.slice(0, n)) await service.like(m, id)
  }
  await liked(ada, 'ada one', 8)
  await liked(ada, 'ada two', 8)
  await liked(ada, 'ada three', 8)
  await liked(bayo, 'bayo', 5)
  await liked(chi, 'chi', 3)

  await settle()
  const authors = (await service.discover(kemi, 50)).posts.map((p) => p.authorHandle)
  // 8, then 5, then 8 / 2, then 3, then 8 / 4.
  assert.deepEqual(authors, ['ada', 'bayo', 'ada', 'chi', 'ada'])
})

test('blocked and muted authors are left out, and someone the reader muted is not named', async () => {
  await follow(kemi, bayo)
  const blocked = await post(ada, 'by someone I blocked', 1)
  await service.like(chi, blocked)
  await db.insert(blocks).values({ blockerId: kemi, blockedId: ada })
  const muted = await post(dayo, 'by someone I muted', 1)
  await service.like(chi, muted)
  await db.insert(mutes).values({ muterId: kemi, mutedId: dayo })
  const answered = await post(eze, 'answered by bayo', 1)
  await reply(bayo, answered)
  await db.insert(mutes).values({ muterId: kemi, mutedId: bayo })

  // bayo's reply still counts, as it does for everyone, but kemi muted bayo, so it is not why.
  assert.deepEqual(await discover(), ['answered by bayo (active)'])
})

test('a post reported by two members, or by the image scanner, waits out of Discover until a moderator decides', async () => {
  const ids: Record<string, string> = {}
  for (const text of ['two members reported', 'one member twice', 'the scanner reported', 'reports dismissed']) {
    ids[text] = await post(ada, text, 1)
    await service.like(bayo, ids[text]!)
  }
  await db.insert(reports).values([
    { reporterId: bayo, postId: ids['two members reported']!, reason: 'spam' },
    { reporterId: chi, postId: ids['two members reported']!, reason: 'hate' },
    { reporterId: bayo, postId: ids['one member twice']!, reason: 'spam' },
    { reporterId: bayo, postId: ids['one member twice']!, reason: 'scam' },
    { reporterId: null, postId: ids['the scanner reported']!, reason: 'illegal' },
    { reporterId: bayo, postId: ids['reports dismissed']!, reason: 'spam', status: 'dismissed' },
    { reporterId: chi, postId: ids['reports dismissed']!, reason: 'spam', status: 'dismissed' },
  ])

  const shown = (await discover()).map((e) => e.replace(/ \(.*$/, ''))
  assert.deepEqual(new Set(shown), new Set(['one member twice', 'reports dismissed']))
})

test('pages are ranked as of the first one, so what happens meanwhile does not move them', async () => {
  // Same age, different authors; post 1 has 5 likes, post 5 has 1.
  const people = await likers(6)
  const authors = [ada, bayo, chi, dayo, eze]
  for (let i = 1; i <= 5; i++) {
    const id = await post(authors[i - 1]!, `post ${i}`, 1)
    for (const m of people.slice(0, 6 - i)) await service.like(m, id)
  }
  await settle()
  const first = await service.discover(kemi, 2)
  assert.deepEqual(entries(first), ['post 1 (active)', 'post 2 (active)'])
  assert.equal(decodeDiscoverCursor(first.cursor!).asOf, first.asOf)

  // After the first page, everyone likes post 5. It does not jump up the pages still to come.
  const [last] = await db.select({ id: posts.id }).from(posts).where(eq(posts.text, 'post 5'))
  for (const m of [...people, kemi, femi]) await service.like(m, last!.id)
  await db.execute(sql`update likes set created_at = ${first.asOf}::timestamptz + interval '1 millisecond'
    where post_id = ${last!.id} and member_id <> ${people[0]!}`)

  const seen = [...entries(first)]
  let cursor = first.cursor
  while (cursor) {
    const page = await service.discover(kemi, 2, { cursor })
    assert.equal(page.asOf, first.asOf)
    seen.push(...entries(page))
    cursor = page.cursor
  }
  assert.deepEqual(seen, ['post 1 (active)', 'post 2 (active)', 'post 3 (active)', 'post 4 (active)', 'post 5 (active)'])

  // A fresh visit is ranked as of now.
  assert.deepEqual(entries(await service.discover(kemi, 1)), ['post 5 (active)'])
})

test('Discover ends after 100 posts', async () => {
  await db.insert(communityMemberships).values([
    { communityId: lagos, memberId: kemi },
    { communityId: lagos, memberId: ada },
  ])
  await db.insert(posts).values(
    Array.from({ length: DISCOVER_RULES.maxPosts + 5 }, (_, i) => ({
      authorId: ada,
      text: `lagos ${i}`,
      communityId: lagos,
      createdAt: new Date(Date.now() - 3_600_000 - i * 60_000),
    })),
  )
  const first = await service.discover(kemi, 60)
  assert.equal(first.posts.length, 60)
  const second = await service.discover(kemi, 60, { cursor: first.cursor! })
  assert.equal(second.posts.length, DISCOVER_RULES.maxPosts - 60)
  assert.equal(second.cursor, null)
  assert.equal(new Set([...first.posts, ...second.posts].map((p) => p.id)).size, DISCOVER_RULES.maxPosts)
})

test('a suspended member stops counting, and their posts leave Discover', async () => {
  const theirs = await post(ada, 'by ada', 1)
  await service.like(chi, theirs)
  const answered = await post(eze, 'answered by bayo', 1)
  await reply(bayo, answered)
  await db.update(members).set({ active: false }).where(eq(members.id, ada))
  await db.update(members).set({ active: false }).where(eq(members.id, bayo))
  // ada's post is gone; bayo's reply no longer counts, so eze's post is back to its starting point.
  assert.deepEqual(await discover(), ['answered by bayo (recent)'])
  await db.update(members).set({ active: true }).where(ne(members.id, kemi))
  assert.deepEqual(new Set(await discover()), new Set(['by ada (active)', 'answered by bayo (active)']))
})

test("the reader's own posts from the last hour come first, as soon as they are written", async () => {
  const theirs = await post(ada, 'by ada', 1)
  await service.like(bayo, theirs)
  await post(kemi, 'mine, two hours ago', 2)
  await post(kemi, 'mine, half an hour ago', 0.5)
  await settle()
  const first = await service.discover(kemi, 1)
  assert.deepEqual(entries(first), ['mine, half an hour ago (own)', 'by ada (active)'])

  // Loaded again as of the same moment: the ranking stays, and a post written since leads.
  await service.create(kemi, 'just now')
  const again = await service.discover(kemi, 1, { at: first.asOf })
  assert.equal(again.asOf, first.asOf)
  assert.deepEqual(entries(again), ['just now (own)', 'mine, half an hour ago (own)', 'by ada (active)'])

  // Only above the first page.
  await post(bayo, 'by bayo', 1)
  await settle()
  const next = await service.discover(kemi, 1, { cursor: (await service.discover(kemi, 1)).cursor! })
  assert.ok(next.posts.every((p) => p.reason !== 'own'))
})

test('visitors get the ranking every visitor gets, worked out once a minute and shared', async () => {
  await follow(kemi, bayo)
  const liked = await post(ada, 'liked twice', 1)
  await service.like(chi, liked)
  await service.like(dayo, liked)
  const replied = await post(bayo, 'replied to', 1)
  await reply(chi, replied)
  const quiet = await post(chi, 'quiet', 1)
  await settle()

  const visitors = new PostsService(db)
  const first = await visitors.discover(null, 2)
  // Only the points that are the same for everyone: nobody is followed, no community joined.
  assert.deepEqual(entries(first), ['replied to (active)', 'liked twice (active)'])

  // Within the minute every visitor gets the same ranking, whatever happens meanwhile.
  for (const m of [ada, dayo, eze, femi]) await service.like(m, quiet)
  const second = await visitors.discover(null, 2)
  assert.equal(second.asOf, first.asOf)
  assert.deepEqual(entries(second), entries(first))
  const rest = await visitors.discover(null, 2, { cursor: first.cursor! })
  assert.deepEqual(entries(rest), ['quiet (recent)'])
  assert.equal(rest.cursor, null)

  // A later page of a ranking since replaced is ranked again as of its own moment.
  const elsewhere = new PostsService(db)
  assert.deepEqual(entries(await elsewhere.discover(null, 2, { cursor: first.cursor! })), ['quiet (recent)'])
})

test('a page sends the rules it was ranked by', async () => {
  const page = await service.discover(kemi, 10)
  assert.deepEqual(page.rules, DISCOVER_RULES)
  assert.deepEqual(page.posts, [])
  assert.equal(page.cursor, null)
})

test('the moment a first page is ranked as of is kept for an hour when the page is loaded again', () => {
  const now = Date.parse('2026-10-28T12:00:00.000Z')
  assert.equal(discoverMoment(undefined, now), '2026-10-28T12:00:00.000Z')
  assert.equal(discoverMoment('2026-10-28T11:30:00.123Z', now), '2026-10-28T11:30:00.123Z')
  assert.equal(discoverMoment('2026-10-28T10:59:59.000Z', now), '2026-10-28T12:00:00.000Z')
  assert.equal(discoverMoment('2026-10-28T12:00:01.000Z', now), '2026-10-28T12:00:00.000Z')
  assert.equal(discoverMoment('not a time', now), '2026-10-28T12:00:00.000Z')
})

test('a tampered Discover cursor is refused, not executed', async () => {
  const good = { asOf: new Date().toISOString(), score: '0.25', id: randomUUID() }
  assert.deepEqual(decodeDiscoverCursor(encodeDiscoverCursor(good)), good)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const bad = [
    'not base64 json',
    encode([2, good.asOf, good.score, good.id]),
    encode([1, good.asOf, '1; drop table posts', good.id]),
    encode([1, good.asOf, 'e', good.id]),
    encode([1, 'yesterday', good.score, good.id]),
  ]
  for (const cursor of bad) await assert.rejects(service.discover(kemi, 10, { cursor }), InvalidCursorError)
})
