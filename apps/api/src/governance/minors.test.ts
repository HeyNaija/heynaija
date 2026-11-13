import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, follows, members, notifications, postMentions, posts } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { AuthController } from '../auth/auth.controller.js'
import type { AuthedRequest } from '../auth/session.guard.js'
import { CommunitiesService } from '../communities/communities.service.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { GistsGate } from '../gists/gists-enabled.guard.js'
import { MembersService } from '../members/members.service.js'
import { OnboardingService } from '../onboarding/onboarding.service.js'
import { PostsService, ReplyNotAllowedError } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { ReplyAudienceNotAllowedError } from './minors.js'

// The contact and discovery protections a member under 18 has from the start
// (ADR 0020, section 4, "Contact"). Each is tried with a minor, an adult in the
// same place, and the people around them: someone the minor follows (their
// circle), an adult stranger, a stranger who is a minor too (a viewer's own age
// opens nothing), a member with no date of birth yet, and a signed-out visitor.

const kid = randomUUID() // 15, follows pal
const pal = randomUUID() // an adult the kid follows
const ada = randomUUID() // an adult the kid does not follow: a stranger to them
const teen = randomUUID() // 16, whom the kid does not follow: a stranger too
const bayo = randomUUID() // an adult, beside the kid to show adults keep what they had
const unknown = randomUUID() // no date of birth yet: not treated as a minor

const posts_ = () => new PostsService(db)
const members_ = () => new MembersService(db)

/** YYYY-MM-DD for someone `years` old today. */
const born = (years: number) => {
  const today = new Date(Date.now() + 60 * 60 * 1000)
  return new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), Math.min(today.getUTCDate(), 28))).toISOString().slice(0, 10)
}

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: kid, handle: 'kid' },
    { id: pal, handle: 'pal' },
    { id: ada, handle: 'ada' },
    { id: teen, handle: 'teen' },
    { id: bayo, handle: 'bayo' },
    { id: unknown, handle: 'unknown' },
  ])
  await db.insert(ageAssurances).values([
    { memberId: kid, band: 'under_18', method: 'self_declared', birthDate: born(15) },
    { memberId: pal, band: '18_plus', method: 'self_declared', birthDate: born(30) },
    { memberId: ada, band: '18_plus', method: 'self_declared', birthDate: born(35) },
    { memberId: teen, band: 'under_18', method: 'self_declared', birthDate: born(16) },
    { memberId: bayo, band: '18_plus', method: 'self_declared', birthDate: born(40) },
  ])
  await db.insert(follows).values({ followerId: kid, followeeId: pal })
})
after(() => pool.end())

const STRANGERS = [
  ['an adult stranger', ada],
  ['a minor stranger', teen],
  ['a member with no date of birth', unknown],
] as const

const refused = (run: Promise<unknown>, error: new (...args: never[]) => Error) =>
  assert.rejects(run, (err) => err instanceof error)

// Replies

test("a minor's conversation is open to people they follow only, whatever they ask for", async () => {
  const mine = await posts_().create(kid, 'my first post')
  const adults = await posts_().create(bayo, 'an adult post')
  const [row] = await db.select({ audience: posts.replyAudience }).from(posts).where(eq(posts.id, mine.id))
  assert.equal(row!.audience, 'following', 'stored as following')
  assert.equal((await posts_().post(ada, mine.id))!.replyAudience, 'following')
  assert.equal((await posts_().post(ada, adults.id))!.replyAudience, 'everyone', "an adult's stays open")

  assert.equal((await posts_().post(pal, mine.id))!.viewerCanReply, true, 'someone they follow')
  await posts_().create(pal, 'hello', { replyTo: mine.id })
  for (const [who, stranger] of STRANGERS) {
    assert.equal((await posts_().post(stranger, mine.id))!.viewerCanReply, false, who)
    await refused(posts_().create(stranger, 'hi', { replyTo: mine.id }), ReplyNotAllowedError)
    assert.equal((await posts_().post(stranger, adults.id))!.viewerCanReply, true, `${who}, to an adult`)
  }
  // Signed out, it is not there at all (question 7, minor-posts.test.ts).
  assert.equal(await posts_().post(null, mine.id), null, 'signed out')
})

test('a minor can narrow who replies, but never open it to everyone', async () => {
  const mine = await posts_().create(kid, 'only @ada', { replyAudience: 'mentioned' })
  assert.equal((await posts_().post(kid, mine.id))!.replyAudience, 'mentioned')
  assert.equal((await posts_().post(pal, mine.id))!.viewerCanReply, false, 'not mentioned')
  assert.equal((await posts_().post(ada, mine.id))!.viewerCanReply, true, 'mentioned by them')

  await refused(posts_().setReplyAudience(kid, mine.id, 'everyone'), ReplyAudienceNotAllowedError)
  assert.equal(await posts_().setReplyAudience(kid, mine.id, 'following'), true)
  const adults = await posts_().create(bayo, 'closed', { replyAudience: 'following' })
  assert.equal(await posts_().setReplyAudience(bayo, adults.id, 'everyone'), true, 'an adult can')
})

test("a minor's update to their story is limited like the story, even one written before they were known to be under 18", async () => {
  const [old] = await db.insert(posts).values({ authorId: kid, text: 'the start', replyAudience: 'everyone' }).returning({ id: posts.id })
  for (const asked of [undefined, 'everyone'] as const) {
    const update = await posts_().create(kid, 'what happened next', { storyOf: old!.id, replyAudience: asked })
    const [row] = await db.select({ audience: posts.replyAudience }).from(posts).where(eq(posts.id, update.id))
    assert.equal(row!.audience, 'following', `asked for ${asked ?? 'nothing'}`)
    await refused(posts_().create(ada, 'hi', { replyTo: update.id }), ReplyNotAllowedError)
  }
})

test('a post a minor wrote before they were known to be under 18 is limited too', async () => {
  const [old] = await db.insert(posts).values({ authorId: kid, text: 'from before', replyAudience: 'everyone' }).returning({ id: posts.id })
  assert.equal((await posts_().post(ada, old!.id))!.replyAudience, 'following')
  await refused(posts_().create(ada, 'hi', { replyTo: old!.id }), ReplyNotAllowedError)
  await posts_().create(pal, 'hi', { replyTo: old!.id })
})

test("answering a minor's reply in someone else's open conversation needs them to follow you", async () => {
  const root = await posts_().create(bayo, 'open to all')
  const kids = await posts_().create(kid, 'me too, @bayo', { replyTo: root.id })
  const adults = await posts_().create(pal, 'same here', { replyTo: root.id })

  for (const [who, stranger] of STRANGERS) {
    assert.equal((await posts_().post(stranger, kids.id))!.viewerCanReply, false, who)
    await refused(posts_().create(stranger, 'hey kid', { replyTo: kids.id }), ReplyNotAllowedError)
    // The rest of the conversation stays as its author left it.
    await posts_().create(stranger, 'to the root', { replyTo: root.id })
    await posts_().create(stranger, 'to an adult', { replyTo: adults.id })
  }
  await posts_().create(pal, 'hi kid', { replyTo: kids.id })
  await posts_().create(bayo, 'you named me', { replyTo: kids.id })
})

// Mentions

const mentionNotices = (recipient: string) =>
  db.select().from(notifications).where(and(eq(notifications.recipientId, recipient), eq(notifications.kind, 'mention')))

test("a stranger's @mention of a minor is plain text and tells them nothing", async () => {
  for (const [who, stranger] of STRANGERS) {
    const post = await posts_().create(stranger, `hey @kid and @bayo, from ${who}`)
    const view = (await posts_().post(pal, post.id))!
    assert.deepEqual(view.mentions.map((m) => m.handle), ['bayo'], `${who}: only the adult is linked`)
  }
  assert.equal((await mentionNotices(kid)).length, 0)
  assert.equal((await mentionNotices(bayo)).length, STRANGERS.length, 'an adult is told every time')

  const friendly = await posts_().create(pal, 'hey @kid')
  assert.deepEqual((await posts_().post(ada, friendly.id))!.mentions.map((m) => m.handle), ['kid'], 'someone they follow')
  assert.equal((await mentionNotices(kid)).length, 1)
})

test("a stranger's mention from before the member was known to be under 18 no longer links", async () => {
  const post = await posts_().create(ada, 'hey @kid')
  // As if written while the kid's age was not on record.
  await db.insert(postMentions).values({ postId: post.id, memberId: kid, start: 4, length: 4 })
  assert.deepEqual((await posts_().post(bayo, post.id))!.mentions, [])
})

// Discovery

test('member search finds a minor only for the people they follow', async () => {
  const found = async (viewer: string | null, q: string) => (await members_().search(viewer, q, 10)).map((m) => m.handle)
  assert.deepEqual(await found(pal, 'kid'), ['kid'])
  assert.deepEqual(await found(kid, 'kid'), ['kid'], 'themselves')
  for (const [who, stranger] of STRANGERS) assert.deepEqual(await found(stranger, 'kid'), [], who)
  assert.deepEqual(await found(null, 'kid'), [], 'signed out')
  assert.deepEqual(await found(null, 'bayo'), ['bayo'], 'an adult')
  assert.deepEqual(await found(ada, 'unknown'), ['unknown'], 'no date of birth')
})

test('@mention suggestions offer a minor only to the people they follow', async () => {
  const offered = async (viewer: string) => (await members_().suggestMentions(viewer, 'k')).members.map((m) => m.handle)
  assert.deepEqual(await offered(pal), ['kid'])
  for (const [who, stranger] of STRANGERS) assert.deepEqual(await offered(stranger), [], who)
  assert.deepEqual((await members_().suggestMentions(ada, 'b')).members.map((m) => m.handle), ['bayo'], 'an adult')
})

test('the welcome flow suggests a minor only to people they follow', async () => {
  await posts_().create(kid, 'posting lately')
  await posts_().create(bayo, 'posting lately too')
  const onboarding = new OnboardingService(db, new CommunitiesService(db), members_())
  const suggested = async (viewer: string) => (await onboarding.suggestions(viewer, [])).map((s) => s.handle)
  assert.ok((await suggested(pal)).includes('kid'))
  for (const [who, stranger] of STRANGERS) {
    assert.ok(!(await suggested(stranger)).includes('kid'), who)
    assert.ok((await suggested(stranger)).includes('bayo'), `${who}: an adult`)
  }
})

test('Discover shows a minor’s posts only to the people they follow', async () => {
  const mine = await posts_().create(kid, 'a kid post')
  const adults = await posts_().create(bayo, 'an adult post')
  const discovered = async (viewer: string | null) => (await posts_().discover(viewer, 50)).posts.map((p) => p.id)
  assert.ok((await discovered(pal)).includes(mine.id))
  for (const [who, viewer] of [...STRANGERS, ['signed out', null] as const]) {
    const list = await discovered(viewer)
    assert.ok(!list.includes(mine.id), who)
    assert.ok(list.includes(adults.id), `${who}: an adult's`)
  }
})

// Profile

test("a minor's profile says no more than anyone's: no age, no location, no lists of people", async () => {
  await db.insert(follows).values([{ followerId: ada, followeeId: kid }, { followerId: kid, followeeId: bayo }])
  const kids = (await members_().profile(ada, 'kid'))!
  const adults = (await members_().profile(ada, 'bayo'))!
  // A new field here is a decision for ADR 0020 first: a minor's profile stays minimal.
  // `automatedBadge` (ADR 0028) says only that an account is HeyNaija's own, which no person's is.
  const FIELDS = [
    'automatedBadge', 'avatar', 'bio', 'displayName', 'followerCount', 'followingCount', 'founderBadge', 'handle', 'id', 'identityBadge',
    'isSelf', 'joinedAt', 'postCount', 'viewerBlocks', 'viewerFollows', 'viewerMutes',
  ]
  assert.deepEqual(Object.keys(kids).sort(), FIELDS)
  assert.deepEqual(Object.keys(adults).sort(), FIELDS)
  const sent = JSON.stringify(kids)
  for (const word of ['under_18', '18_plus', born(15), 'location', 'pal', 'bayo']) assert.ok(!sent.includes(word), word)
})

// What the apps are told

test('the apps offer a minor only the reply choices they have', async () => {
  const flags = new FeatureFlags(db, 'development')
  const auth = new AuthController(
    {} as never,
    { scope: async () => ({ siteWide: false, communityIds: [] }) } as never,
    { unreadCount: async () => 0 } as never,
    {} as never,
    {} as never,
    db,
    {} as never,
    {} as never,
    { birthDateNeeded: async () => false } as never,
    flags,
    { effective: (on: boolean) => on },
    new GistsGate(flags, { LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 's'.repeat(32) }),
  )
  const me = (id: string, handle: string) => auth.me({ member: { id, handle } } as AuthedRequest)
  assert.deepEqual((await me(kid, 'kid')).replyAudiences, ['following', 'mentioned'])
  assert.deepEqual((await me(bayo, 'bayo')).replyAudiences, ['everyone', 'following', 'mentioned'])
  assert.deepEqual((await me(unknown, 'unknown')).replyAudiences, ['everyone', 'following', 'mentioned'])
})
