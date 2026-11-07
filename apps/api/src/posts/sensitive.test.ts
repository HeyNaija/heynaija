import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, follows, members, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { LabelNotAllowedError } from '../governance/adult-content.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { ParentNotFoundError, PostsService, QuotedPostNotFoundError } from './posts.service.js'

// Posts marked sensitive (ADR 0020, the 18+ label) reach only adults and their
// own author: not signed-out visitors, not members with no date of birth, not
// anyone under 18. Every way a post can be read is tried here with a marked post
// beside an unmarked one; a new read path belongs in this file.

const ada = randomUUID() // an adult who posts
const bayo = randomUUID() // an adult reader
const kid = randomUUID() // 15
const unknown = randomUUID() // no date of birth yet
const SECRET = 'sensitive-words-xyz'
const service = () => new PostsService(db)

/** YYYY-MM-DD for someone `years` old today. */
const born = (years: number) => {
  const today = new Date(Date.now() + 60 * 60 * 1000)
  return new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), Math.min(today.getUTCDate(), 28))).toISOString().slice(0, 10)
}

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: kid, handle: 'kid' },
    { id: unknown, handle: 'unknown' },
  ])
  await db.insert(ageAssurances).values([
    { memberId: ada, band: '18_plus', method: 'self_declared', birthDate: born(30) },
    { memberId: bayo, band: '18_plus', method: 'self_declared', birthDate: born(40) },
    { memberId: kid, band: 'under_18', method: 'self_declared', birthDate: born(15) },
  ])
})
after(() => pool.end())

const NOT_ADULTS = [
  ['signed out', null],
  ['no date of birth', unknown],
  ['under 18', kid],
] as const

const ids = (list: { id: string }[]) => list.map((p) => p.id)

/** A marked post and an unmarked one by ada, with a hashtag and a picture-free text search can find. */
async function pair() {
  const plain = await service().create(ada, 'plain needle #topic')
  const marked = await service().create(ada, `${SECRET} needle #topic`, { sensitive: true })
  return { plain: plain.id, marked: marked.id }
}

test('a marked post is in no list, search or page for anyone who is not an adult', async () => {
  const { plain, marked } = await pair()
  await db.insert(follows).values([{ followerId: kid, followeeId: ada }, { followerId: unknown, followeeId: ada }])
  for (const [who, viewer] of NOT_ADULTS) {
    const s = service()
    const lists = {
      feed: (await s.feed(viewer, 20)).posts,
      profile: (await s.byAuthor(viewer, ada, 20)).posts,
      hashtag: (await s.withHashtag(viewer, 'topic', 20)).posts,
      search: await s.search(viewer, 'needle', 20),
      ...(viewer ? { following: (await s.followingFeed(viewer, 20)).posts } : {}),
    }
    for (const [name, list] of Object.entries(lists)) {
      assert.ok(ids(list).includes(plain), `${who}: ${name} has the unmarked post`)
      assert.ok(!ids(list).includes(marked), `${who}: ${name} leaves the marked one out`)
      assert.ok(!JSON.stringify(list).includes(SECRET), `${who}: ${name} sends none of its text`)
    }
    assert.equal(await s.post(viewer, marked), null, `${who}: the post itself`)
    assert.equal(await s.thread(viewer, marked), null, `${who}: its page`)
    assert.equal(await s.replies(viewer, marked), null, `${who}: its replies`)
  }
})

test('an adult sees it with its pictures covered; its author and an adult who chose so see them straight away', async () => {
  const { marked } = await pair()
  const forBayo = await service().post(bayo, marked)
  assert.equal(forBayo?.sensitive, 'author')
  assert.equal(forBayo?.coverMedia, true)
  assert.ok(ids((await service().feed(bayo, 20)).posts).includes(marked))
  assert.equal((await service().post(ada, marked))?.coverMedia, false, 'its author')
  await db.update(members).set({ showSensitiveMedia: true }).where(eq(members.id, bayo))
  assert.equal((await service().post(bayo, marked))?.coverMedia, false, 'Settings say show it')
})

test('a marked reply is left out of a thread for a minor, or is a bare placeholder when replies hang under it', async () => {
  const root = await service().create(bayo, 'root')
  const alone = await service().create(ada, `${SECRET} alone`, { replyTo: root.id, sensitive: true })
  const parent = await service().create(ada, `${SECRET} parent`, { replyTo: root.id, sensitive: true })
  await service().create(bayo, 'under it', { replyTo: parent.id })
  for (const [who, viewer] of NOT_ADULTS) {
    const replies = (await service().thread(viewer, root.id))!.replies
    assert.ok(!ids(replies).includes(alone.id), `${who}: a marked reply on its own is left out`)
    const placeholder = replies.find((r) => r.id === parent.id)
    assert.deepEqual(placeholder && 'unavailable' in placeholder ? placeholder.unavailable : null, true, `${who}: a placeholder`)
    assert.ok(!JSON.stringify(replies).includes(SECRET), who)
  }
  const forAdult = (await service().thread(bayo, root.id))!.replies
  assert.ok(ids(forAdult).includes(alone.id) && ids(forAdult).includes(parent.id))
})

test('above a reply, a marked post is the placeholder a deleted one is; as a quote or a reply preview, it is unavailable', async () => {
  const { marked } = await pair()
  const reply = await service().create(bayo, 'answering', { replyTo: marked })
  const quote = await service().create(bayo, 'quoting', { quote: marked })
  for (const [who, viewer] of NOT_ADULTS) {
    const thread = (await service().thread(viewer, reply.id))!
    assert.equal(thread.ancestors[0]?.deleted, true, `${who}: ancestor`)
    assert.equal(thread.ancestors[0]?.text, '', who)
    const quoting = await service().post(viewer, quote.id)
    assert.deepEqual(quoting?.quote, { unavailable: true }, `${who}: quote`)
    const [listed] = (await service().byAuthor(viewer, bayo, 20, undefined, 'replies')).posts
    assert.deepEqual(listed?.replyTo, { unavailable: true }, `${who}: reply preview`)
  }
  const quoting = await service().post(bayo, quote.id)
  assert.ok(quoting?.quote && !quoting.quote.unavailable && quoting.quote.coverMedia)
})

test('marked posts never trend and are never recommended in Discover, to anyone', async () => {
  const { plain, marked } = await pair()
  for (const id of [plain, marked]) await service().create(bayo, 'reply', { replyTo: id })
  assert.deepEqual(ids(await service().trending(bayo, 10)), [plain])
  const discovered = ids((await service().discover(bayo, 20)).posts)
  assert.ok(discovered.includes(plain) && !discovered.includes(marked))
})

test('a minor is told nothing about a marked post, and cannot reply to it, quote it or like it', async () => {
  const marked = await service().create(ada, `${SECRET} @kid @bayo`, { sensitive: true })
  await service().create(ada, 'plain @kid')
  const notified = async (who: string) => (await new NotificationsService(db).list(who, 20)).notifications
  assert.deepEqual((await notified(kid)).map((n) => n.post?.excerpt), ['plain @kid'])
  assert.equal((await notified(bayo)).length, 1, 'an adult hears about it')
  await assert.rejects(service().create(kid, 'hi', { replyTo: marked.id }), ParentNotFoundError)
  await assert.rejects(service().create(kid, 'hi', { quote: marked.id }), QuotedPostNotFoundError)
  assert.equal(await service().like(kid, marked.id), false)
})

test('only an adult can mark a post; Settings that mark everything win; a moderator\'s mark stays', async () => {
  await assert.rejects(service().create(kid, 'mine', { sensitive: true }), LabelNotAllowedError)
  await assert.rejects(service().create(unknown, 'mine', { sensitive: true }), LabelNotAllowedError)
  const label = async (id: string) => (await db.select({ l: posts.adultLabel }).from(posts).where(eq(posts.id, id)))[0]!.l

  await db.update(members).set({ labelPosts: 'author' }).where(eq(members.id, bayo))
  assert.equal(await label((await service().create(bayo, 'everything')).id), 'author')
  await db.update(members).set({ labelPosts: 'moderator' }).where(eq(members.id, bayo))
  assert.equal(await label((await service().create(bayo, 'everything', { sensitive: true })).id), 'moderator')

  const own = await service().create(ada, 'later')
  assert.equal(await service().setAdultLabel(ada, own.id, true), true)
  assert.equal(await label(own.id), 'author')
  assert.equal(await service().setAdultLabel(bayo, own.id, false), false, 'not theirs')
  assert.equal(await service().setAdultLabel(ada, own.id, false), true)
  assert.equal(await label(own.id), null)
  await db.update(posts).set({ adultLabel: 'moderator' }).where(eq(posts.id, own.id))
  assert.equal(await service().setAdultLabel(ada, own.id, false), false, "a moderator's mark")
  assert.equal(await label(own.id), 'moderator')
  const kids = await service().create(kid, 'mine')
  await assert.rejects(service().setAdultLabel(kid, kids.id, true), LabelNotAllowedError)
})
