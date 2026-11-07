import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, communities, communityMemberships, follows, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { BOARD_COMMUNITY, boardQuery, IdeasService, newIdea } from '../ideas/ideas.service.js'
import { MembersService } from '../members/members.service.js'
import { bornYearsAgo, db, migrate, pool, reset } from '../test-db.js'
import { PostsService } from './posts.service.js'

// A minor's posts are shown to signed-in members only, never to signed-out
// visitors or search engines (ADR 0020, question 7). To a signed-out visitor a
// minor's post is missing, as a deleted one is, with nothing to say why; every
// signed-in member sees it as before: a stranger, someone who follows the minor
// and the minor themselves. Every way a post can be read is tried here, with an
// adult's post beside the minor's; a new read path belongs in this file, as it
// does in sensitive.test.ts.

const kid = randomUUID() // 15, follows pal
const pal = randomUUID() // an adult the kid follows, so may answer the kid
const fan = randomUUID() // an adult who follows the kid
const ada = randomUUID() // an adult stranger to the kid
const bayo = randomUUID() // an adult who posts
const unknown = randomUUID() // no date of birth yet: not treated as a minor
const SECRET = 'kid-words-xyz'
let lagos: string

const posts_ = () => new PostsService(db)

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: kid, handle: 'kid' },
    { id: pal, handle: 'pal' },
    { id: fan, handle: 'fan' },
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: unknown, handle: 'unknown' },
  ])
  await db.insert(ageAssurances).values([
    { memberId: kid, band: 'under_18', method: 'self_declared', birthDate: bornYearsAgo(15) },
    ...[pal, fan, ada, bayo].map((memberId) => ({ memberId, band: '18_plus' as const, method: 'self_declared' as const, birthDate: bornYearsAgo(30) })),
  ])
  await db.insert(follows).values([{ followerId: kid, followeeId: pal }, { followerId: fan, followeeId: kid }])
  const [community] = await db.insert(communities).values({ slug: 'lagos', name: 'Lagos', description: 'Lagos things' }).returning({ id: communities.id })
  lagos = community!.id
  await db.insert(communityMemberships).values([kid, bayo].map((memberId) => ({ communityId: lagos, memberId })))
})
after(() => pool.end())

const SIGNED_IN = [
  ['a stranger', ada],
  ['a follower', fan],
  ['the minor', kid],
] as const

const ids = (list: { id: string }[]) => list.map((p) => p.id)

/** The kid's post and an adult's, alike: a hashtag, a word search finds, in the community. */
async function pair() {
  const minors = await posts_().create(kid, `${SECRET} needle #topic`, { communitySlug: 'lagos' })
  const adults = await posts_().create(bayo, 'plain needle #topic', { communitySlug: 'lagos' })
  return { minors: minors.id, adults: adults.id }
}

/** Every list a post can be read in, as `viewer` sees it. */
async function lists(viewer: string | null) {
  const s = posts_()
  return {
    feed: (await s.feed(viewer, 20)).posts,
    profile: (await s.byAuthor(viewer, kid, 20)).posts.concat((await s.byAuthor(viewer, bayo, 20)).posts),
    hashtag: (await s.withHashtag(viewer, 'topic', 20)).posts,
    search: await s.search(viewer, 'needle', 20),
    community: (await s.inCommunity(viewer, lagos, 20)).posts,
    trending: await s.trending(viewer, 10),
  }
}

test("a minor's posts are in no list, search or page for a signed-out visitor", async () => {
  const { minors, adults } = await pair()
  // Both have a like, so both can trend.
  for (const id of [minors, adults]) await posts_().like(pal, id)
  for (const [name, list] of Object.entries(await lists(null))) {
    assert.ok(ids(list).includes(adults), `${name} has the adult's post`)
    assert.ok(!ids(list).includes(minors), `${name} leaves the minor's out`)
    assert.ok(!JSON.stringify(list).includes(SECRET), `${name} sends none of its text`)
  }
  assert.equal(await posts_().post(null, minors), null, 'the post itself')
  assert.equal(await posts_().thread(null, minors), null, 'its page')
  assert.equal(await posts_().replies(null, minors), null, 'its replies')
  const discover = (await posts_().discover(null, 20)).posts
  assert.ok(!ids(discover).includes(minors), 'Discover')
})

test('every signed-in member sees them as before: a stranger, a follower and the minor', async () => {
  const { minors, adults } = await pair()
  for (const id of [minors, adults]) await posts_().like(pal, id)
  for (const [who, viewer] of SIGNED_IN) {
    for (const [name, list] of Object.entries(await lists(viewer))) {
      assert.ok(ids(list).includes(minors) && ids(list).includes(adults), `${who}: ${name}`)
    }
    assert.equal((await posts_().post(viewer, minors))?.text, `${SECRET} needle #topic`, `${who}: the post`)
    assert.equal((await posts_().thread(viewer, minors))?.post.id, minors, `${who}: its page`)
  }
  for (const [who, viewer] of [['a follower', fan], ['the minor', kid]] as const) {
    assert.ok(ids((await posts_().followingFeed(viewer, 20)).posts).includes(minors), `${who}: Following`)
  }
})

test('a member with no date of birth yet is not treated as a minor', async () => {
  const theirs = await posts_().create(unknown, 'not yet asked #topic')
  assert.equal((await posts_().post(null, theirs.id))?.id, theirs.id)
  assert.ok(ids((await posts_().withHashtag(null, 'topic', 20)).posts).includes(theirs.id))
})

test("in a conversation, a minor's post is the placeholder a deleted one is; as a quote or a reply preview, it is unavailable", async () => {
  const minors = await posts_().create(kid, `${SECRET} root`)
  const answer = await posts_().create(pal, 'answering the kid', { replyTo: minors.id })
  const quote = await posts_().create(bayo, 'quoting the kid', { quote: minors.id })

  const thread = (await posts_().thread(null, answer.id))!
  assert.equal(thread.post.id, answer.id, "an adult's answer is still shown")
  assert.equal(thread.ancestors[0]?.deleted, true, 'above it, a placeholder')
  assert.equal(thread.ancestors[0]?.text, '')
  assert.ok(!JSON.stringify(thread).includes(SECRET))
  assert.deepEqual((await posts_().post(null, quote.id))?.quote, { unavailable: true }, 'quote')
  const [listed] = (await posts_().byAuthor(null, pal, 20, undefined, 'replies')).posts
  assert.deepEqual(listed?.replyTo, { unavailable: true }, 'reply preview')

  for (const [who, viewer] of SIGNED_IN) {
    const theirs = (await posts_().thread(viewer, answer.id))!
    assert.equal(theirs.ancestors[0]?.deleted, false, who)
    assert.equal(theirs.ancestors[0]?.text, `${SECRET} root`, who)
    const quoting = await posts_().post(viewer, quote.id)
    assert.ok(quoting?.quote && !quoting.quote.unavailable, `${who}: quote`)
    const [reply] = (await posts_().byAuthor(viewer, pal, 20, undefined, 'replies')).posts
    assert.ok(reply?.replyTo && !reply.replyTo.unavailable, `${who}: reply preview`)
  }
})

test("a minor's reply in an adult's conversation is left out for a signed-out visitor, or is a bare placeholder when replies hang under it", async () => {
  const root = await posts_().create(bayo, 'an open conversation')
  const alone = await posts_().create(kid, `${SECRET} alone`, { replyTo: root.id })
  const parent = await posts_().create(kid, `${SECRET} parent`, { replyTo: root.id })
  const under = await posts_().create(pal, 'under it', { replyTo: parent.id })

  const replies = (await posts_().thread(null, root.id))!.replies
  assert.ok(!ids(replies).includes(alone.id), 'a reply on its own is left out')
  const placeholder = replies.find((r) => r.id === parent.id)
  assert.ok(placeholder && 'unavailable' in placeholder && placeholder.unavailable, 'a placeholder')
  assert.ok(!JSON.stringify(replies).includes(SECRET))
  assert.ok(!JSON.stringify(replies).includes('"kid"'), 'nor whose it was')
  assert.deepEqual(ids((await posts_().replies(null, parent.id))!.replies), [under.id], 'the replies under it stay in reach')

  for (const [who, viewer] of SIGNED_IN) {
    const theirs = (await posts_().thread(viewer, root.id))!.replies
    assert.ok(ids(theirs).includes(alone.id) && ids(theirs).includes(parent.id), who)
  }
})

test("a minor's pinned post and story are not shown to a signed-out visitor", async () => {
  const { minors } = await pair()
  await posts_().pinToProfile(kid, minors)
  await db.update(communities).set({ pinnedPostId: minors }).where(eq(communities.id, lagos))
  const update = await posts_().create(kid, `${SECRET} update`, { storyOf: minors })

  assert.equal(await posts_().pinnedOnProfile(null, kid), null, 'pinned on their profile')
  assert.equal(await posts_().pinnedInCommunity(null, lagos), null, 'pinned in a community')
  assert.equal(await posts_().storyUpdates(null, minors, 10), null, 'their story')
  assert.equal(await posts_().post(null, update.id), null, 'an update')
  for (const [who, viewer] of SIGNED_IN) {
    assert.equal((await posts_().pinnedOnProfile(viewer, kid))?.id, minors, who)
    assert.equal((await posts_().pinnedInCommunity(viewer, lagos))?.id, minors, who)
    assert.deepEqual(ids((await posts_().storyUpdates(viewer, minors, 10))!.posts), [update.id], who)
  }
})

test("a minor's reposts and poll votes are not shown to a signed-out visitor; the counts keep them", async () => {
  const poll = await posts_().create(bayo, 'Jollof or fried rice?', {
    poll: { multiple: false, options: ['Jollof', 'Fried rice'], expiresIn: 'never' },
  })
  await posts_().repost(kid, poll.id)
  const [jollof] = (await posts_().post(kid, poll.id))!.poll!.options
  await posts_().votePoll(kid, poll.id, [jollof!.id])
  await posts_().votePoll(fan, poll.id, [jollof!.id])

  assert.deepEqual((await posts_().byAuthor(null, kid, 20)).posts, [], "the minor's profile lists nothing")
  const voters = (await posts_().pollVoters(null, poll.id, 10))!.voters
  assert.deepEqual(voters.map((v) => v.member.handle), ['fan'], "a minor's ballot is left out")
  assert.equal((await posts_().post(null, poll.id))!.poll!.options[0]!.voteCount, 2, 'the count keeps it')

  for (const [who, viewer] of SIGNED_IN) {
    const [repost] = (await posts_().byAuthor(viewer, kid, 20)).posts
    assert.equal(repost?.repostedBy?.id, kid, `${who}: the repost`)
    const handles = (await posts_().pollVoters(viewer, poll.id, 10))!.voters.map((v) => v.member.handle)
    assert.deepEqual(handles.sort(), ['fan', 'kid'], `${who}: the ballots`)
  }
})

test("a minor's profile is still found signed out, but counts no posts", async () => {
  await pair()
  await posts_().create(kid, 'another')
  const profile = await new MembersService(db).profile(null, 'kid')
  assert.equal(profile?.handle, 'kid', 'found, as any member is')
  assert.equal(profile?.postCount, 0)
  assert.equal((await new MembersService(db).profile(null, 'bayo'))?.postCount, 1, "an adult's are counted")
  for (const [who, viewer] of SIGNED_IN) {
    assert.equal((await new MembersService(db).profile(viewer, 'kid'))?.postCount, 2, who)
  }
})

test("a minor's idea is not on the board for a signed-out visitor", async () => {
  await db.insert(communities).values({ slug: BOARD_COMMUNITY, name: 'Building HeyNaija', description: 'The app' })
  const ideas = new IdeasService(db, posts_())
  const mine = await ideas.create(kid, newIdea.parse({ kind: 'idea', title: `${SECRET} idea` }))
  const theirs = await ideas.create(bayo, newIdea.parse({ kind: 'idea', title: 'An adult idea' }))
  const board = async (viewer: string | null) => ids((await ideas.board(viewer, boardQuery.parse({}))).ideas)
  assert.deepEqual(await board(null), [theirs.id])
  assert.equal(await ideas.get(null, mine.id), null)
  assert.ok(!ids(await ideas.similar(null, `${SECRET} idea`)).includes(mine.id), 'similar ideas')
  for (const [who, viewer] of SIGNED_IN) {
    assert.deepEqual((await board(viewer)).sort(), [mine.id, theirs.id].sort(), who)
    assert.equal((await ideas.get(viewer, mine.id))?.id, mine.id, who)
  }
})
