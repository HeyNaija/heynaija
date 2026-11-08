import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, communities, communityMemberships, media, members, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { LabelNotAllowedError } from '../governance/adult-content.js'
import type { PlacementJobs } from '../media/media.service.js'
import { MembersService } from '../members/members.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { OnboardingService } from '../onboarding/onboarding.service.js'
import { CommunityNotFoundError, NotACommunityModeratorError, PostsService } from '../posts/posts.service.js'
import { bornYearsAgo, db, migrate, pool, reset } from '../test-db.js'
import { CommunitiesService } from './communities.service.js'

// A whole community marked sensitive (ADR 0020, question 8): by its moderators or
// a site moderator, as long as they count as adults. Every post in it carries the
// 'community' mark, so the rules for posts marked sensitive apply to each one
// (sensitive.test.ts tries every read path), and the community itself is not
// there for anyone who is not an adult: not listed, found, shown, joined or
// posted in.

const mod = randomUUID() // an adult who moderates Lagos Nights
const site = randomUUID() // an adult site moderator
const ada = randomUUID() // an adult member of it
const bayo = randomUUID() // an adult who is not a member
const kid = randomUUID() // 15, a member from before it was marked
const kidMod = randomUUID() // 16, a moderator of it
const unknown = randomUUID() // no date of birth yet
let nights: string

/** The posts whose files were queued to move, in order. */
const placed: string[] = []
const placement: PlacementJobs = { placePostMedia: async (postId) => void placed.push(postId) }
const communities_ = () => new CommunitiesService(db, placement)
const posts_ = () => new PostsService(db)
const label = async (id: string) => (await db.select({ l: posts.adultLabel }).from(posts).where(eq(posts.id, id)))[0]!.l
/** A ready picture on `postId`, as if ada had attached it. */
const picture = (postId: string) =>
  db.insert(media).values({ ownerId: ada, kind: 'post_image', status: 'ready', contentType: 'image/webp', bytes: 100, width: 300, height: 200, postId, position: 0 })

before(migrate)
beforeEach(async () => {
  await reset()
  placed.length = 0
  await db.insert(members).values([
    { id: mod, handle: 'mod' },
    { id: site, handle: 'site', role: 'moderator' },
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: kid, handle: 'kid' },
    { id: kidMod, handle: 'kidmod' },
    { id: unknown, handle: 'unknown' },
  ])
  await db.insert(ageAssurances).values([
    ...[mod, site, ada, bayo].map((memberId) => ({ memberId, band: '18_plus' as const, method: 'self_declared' as const, birthDate: bornYearsAgo(30) })),
    { memberId: kid, band: 'under_18', method: 'self_declared', birthDate: bornYearsAgo(15) },
    { memberId: kidMod, band: 'under_18', method: 'self_declared', birthDate: bornYearsAgo(16) },
  ])
  const [community] = await db
    .insert(communities)
    .values({ slug: 'lagos-nights', name: 'Lagos Nights', description: 'After dark in Lagos' })
    .returning({ id: communities.id })
  nights = community!.id
  await db.insert(communityMemberships).values([
    { communityId: nights, memberId: mod, role: 'moderator' },
    { communityId: nights, memberId: kidMod, role: 'moderator' },
    { communityId: nights, memberId: ada },
    { communityId: nights, memberId: kid },
    { communityId: nights, memberId: unknown },
  ])
})
after(() => pool.end())

const NOT_ADULTS = [
  ['signed out', null],
  ['no date of birth', unknown],
  ['under 18', kid],
] as const

test('only its moderators and site moderators mark it, and only those who count as adults', async () => {
  await assert.rejects(communities_().setSensitive(ada, 'lagos-nights', true), NotACommunityModeratorError)
  await assert.rejects(communities_().setSensitive(kidMod, 'lagos-nights', true), LabelNotAllowedError)
  assert.equal(await communities_().setSensitive(mod, 'nowhere', true), false)
  assert.equal(await communities_().setSensitive(mod, 'lagos-nights', true), true)
  assert.equal((await communities_().detail(ada, 'lagos-nights'))?.sensitive, true)
  assert.equal(await communities_().setSensitive(site, 'lagos-nights', false), true, 'a site moderator')
  assert.equal((await communities_().detail(ada, 'lagos-nights'))?.sensitive, false)

  assert.equal((await communities_().detail(mod, 'lagos-nights'))?.viewerCanMarkSensitive, true)
  assert.equal((await communities_().detail(site, 'lagos-nights'))?.viewerCanMarkSensitive, true)
  assert.equal((await communities_().detail(ada, 'lagos-nights'))?.viewerCanMarkSensitive, false, 'a member')
  assert.equal((await communities_().detail(kidMod, 'lagos-nights'))?.viewerCanMarkSensitive, false, 'a moderator under 18')
})

test('marked, every post in it carries the mark, old and new, and their files move', async () => {
  const before = await posts_().create(ada, 'from before', { communitySlug: 'lagos-nights' })
  const own = await posts_().create(ada, 'marked by me', { communitySlug: 'lagos-nights', sensitive: true })
  const elsewhere = await posts_().create(ada, 'not in it')
  await picture(before.id)

  await communities_().setSensitive(mod, 'lagos-nights', true)
  assert.equal(await label(before.id), 'community')
  assert.equal(await label(own.id), 'author', 'its own mark stays')
  assert.equal(await label(elsewhere.id), null)
  assert.deepEqual(placed, [before.id], 'only a post with files, whose mark changed')

  const top = await posts_().create(ada, 'after', { communitySlug: 'lagos-nights' })
  const reply = await posts_().create(bayo, 'a reply', { replyTo: top.id })
  const update = await posts_().create(ada, 'an update', { storyOf: top.id })
  for (const id of [top.id, reply.id, update.id]) assert.equal(await label(id), 'community', id)
})

test('it is not there for anyone who is not an adult: not listed, found, shown, joined or posted in', async () => {
  const post = await posts_().create(ada, 'after dark', { communitySlug: 'lagos-nights' })
  await communities_().setSensitive(mod, 'lagos-nights', true)
  for (const [who, viewer] of NOT_ADULTS) {
    assert.ok(!(await communities_().list(viewer)).some((c) => c.slug === 'lagos-nights'), `${who}: list`)
    assert.deepEqual(await communities_().search(viewer, 'Lagos', 5), [], `${who}: search`)
    assert.equal(await communities_().detail(viewer, 'lagos-nights'), null, `${who}: its page`)
    assert.equal(await posts_().post(viewer, post.id), null, `${who}: its post`)
    assert.ok(!(await posts_().feed(viewer, 20)).posts.some((p) => p.id === post.id), `${who}: Latest`)
    if (viewer) {
      assert.equal(await communities_().join(viewer, 'lagos-nights'), false, `${who}: joining`)
      await assert.rejects(posts_().create(viewer, 'hi', { communitySlug: 'lagos-nights' }), CommunityNotFoundError, `${who}: posting`)
    }
  }
  // A member under 18 can still leave it.
  assert.equal(await communities_().leave(kid, 'lagos-nights'), true)

  // An adult who is not a member finds it, joins it and sees its posts, pictures covered.
  assert.ok((await communities_().list(bayo)).some((c) => c.slug === 'lagos-nights'))
  assert.equal(await communities_().join(bayo, 'lagos-nights'), true)
  const seen = await posts_().post(bayo, post.id)
  assert.equal(seen?.sensitive, 'community')
  assert.equal(seen?.coverMedia, true)
})

test("the community's mark is not the author's to take off, nor lost when a moderator's comes off", async () => {
  await communities_().setSensitive(mod, 'lagos-nights', true)
  const post = await posts_().create(ada, 'after dark', { communitySlug: 'lagos-nights' })
  assert.equal(await posts_().setAdultLabel(ada, post.id, false), false, 'taking it off')
  assert.equal(await label(post.id), 'community')

  // Their own mark on top, then off again, leaves the community's.
  await db.update(posts).set({ adultLabel: 'author' }).where(eq(posts.id, post.id))
  assert.equal(await posts_().setAdultLabel(ada, post.id, false), true)
  assert.equal(await label(post.id), 'community')

  // A moderator's mark, taken off on appeal, leaves the community's too.
  await db.update(posts).set({ adultLabel: 'moderator' }).where(eq(posts.id, post.id))
  await new ModerationService(db).unlabelPost(site, post.id, 'on appeal')
  assert.equal(await label(post.id), 'community')
})

test('unmarked, posts keep only their own or a moderator\'s mark, and everyone finds it again', async () => {
  await communities_().setSensitive(mod, 'lagos-nights', true)
  const plain = await posts_().create(ada, 'plain', { communitySlug: 'lagos-nights' })
  const own = await posts_().create(ada, 'mine', { communitySlug: 'lagos-nights', sensitive: true })
  const moderated = await posts_().create(ada, 'moderated', { communitySlug: 'lagos-nights' })
  await db.update(posts).set({ adultLabel: 'moderator' }).where(eq(posts.id, moderated.id))
  await picture(plain.id)
  placed.length = 0

  assert.equal(await communities_().setSensitive(mod, 'lagos-nights', false), true)
  assert.equal(await label(plain.id), null)
  assert.equal(await label(own.id), 'author')
  assert.equal(await label(moderated.id), 'moderator')
  assert.deepEqual(placed, [plain.id])
  for (const [who, viewer] of NOT_ADULTS) {
    assert.equal((await communities_().detail(viewer, 'lagos-nights'))?.slug, 'lagos-nights', who)
    assert.equal((await posts_().post(viewer, plain.id))?.id, plain.id, who)
  }
})

test('the welcome flow suggests no one from it to someone who is not an adult', async () => {
  await posts_().create(ada, 'after dark', { communitySlug: 'lagos-nights' })
  await communities_().setSensitive(mod, 'lagos-nights', true)
  const onboarding = new OnboardingService(db, communities_(), new MembersService(db))
  const fromIt = async (viewer: string) =>
    (await onboarding.suggestions(viewer, ['lagos-nights'])).filter((s) => s.reason.community?.slug === 'lagos-nights').map((s) => s.handle)
  assert.deepEqual(await fromIt(kid), [])
  assert.deepEqual((await fromIt(bayo)).sort(), ['ada', 'mod'])
})
