import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, follows, members, mutes, notifications, posts } from '@heynaija/db'
import { BadRequestException, type ExecutionContext } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { AuthController } from '../auth/auth.controller.js'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { CommunitiesService } from '../communities/communities.service.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { InvitesService } from '../invites/invites.service.js'
import { MembersService } from '../members/members.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import type { LimitKind, RateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { OnboardingController } from './onboarding.controller.js'
import { OnboardingService, SUGGESTION_LIMIT } from './onboarding.service.js'

const communitiesService = new CommunitiesService(db)
const membersService = new MembersService(db)
const service = new OnboardingService(db, communitiesService, membersService)

const me = randomUUID()
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const dayo = randomUUID()
let lagos: string
let abuja: string

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000)
const DAY = 24 * 60

const say = (authorId: string, minutesAgo: number, communityId: string | null = null, extra: Partial<typeof posts.$inferInsert> = {}) =>
  db.insert(posts).values({ authorId, text: 'hello', communityId, createdAt: ago(minutesAgo), ...extra })

const onboardedAt = async (id: string) =>
  (await db.select({ at: members.onboardedAt }).from(members).where(eq(members.id, id)))[0]!.at

before(migrate)
beforeEach(async () => {
  await reset()
  // As the session guard creates them for newcomers: not onboarded yet.
  await db.insert(members).values([
    { id: me, handle: 'newbie' },
    { id: ada, handle: 'ada', displayName: 'Ada Obi', bio: 'Lagos born' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
    { id: dayo, handle: 'dayo' },
  ])
  const rows = await db
    .insert(communities)
    .values([
      { slug: 'lagos', name: 'Lagos', description: 'Lagos things' },
      { slug: 'abuja', name: 'Abuja', description: 'Abuja things' },
    ])
    .returning({ id: communities.id, slug: communities.slug })
  lagos = rows.find((r) => r.slug === 'lagos')!.id
  abuja = rows.find((r) => r.slug === 'abuja')!.id
})
after(() => pool.end())

test('suggestions: who moderates the chosen communities, then who posts in them, then who posts anywhere', async () => {
  await db.insert(communityMemberships).values({ communityId: lagos, memberId: chi, role: 'moderator' })
  await say(ada, 60, lagos)
  await say(bayo, 5, lagos)
  await say(dayo, 1, abuja)

  const people = await service.suggestions(me, ['lagos'])
  assert.deepEqual(
    people.map((p) => [p.handle, p.reason.kind, p.reason.community?.slug ?? null]),
    [
      ['chi', 'moderator', 'lagos'],
      ['bayo', 'community', 'lagos'],
      ['ada', 'community', 'lagos'],
      // Not in a chosen community: fills the list as someone posting lately.
      ['dayo', 'recent', null],
    ],
  )
  const first = people.find((p) => p.handle === 'ada')!
  assert.equal(first.displayName, 'Ada Obi')
  assert.equal(first.bio, 'Lagos born')
  assert.equal(first.avatar, null)
})

test('with no communities chosen (or unknown ones), people posting anywhere lately are suggested, newest first', async () => {
  await say(ada, 30, lagos)
  await say(bayo, 2)
  for (const slugs of [[], ['nowhere']]) {
    const people = await service.suggestions(me, slugs)
    assert.deepEqual(people.map((p) => [p.handle, p.reason.kind]), [['bayo', 'recent'], ['ada', 'recent']])
  }
})

test('never suggests yourself, suspended members, blocks either way, or people already followed or muted', async () => {
  const eve = randomUUID()
  const femi = randomUUID()
  await db.insert(members).values([
    { id: eve, handle: 'eve' },
    { id: femi, handle: 'femi', active: false },
  ])
  for (const id of [me, ada, bayo, chi, dayo, eve, femi]) await say(id, 10, lagos)
  await db.insert(communityMemberships).values({ communityId: lagos, memberId: femi, role: 'moderator' })
  await db.insert(blocks).values([
    { blockerId: me, blockedId: ada },
    { blockerId: bayo, blockedId: me },
  ])
  await db.insert(follows).values({ followerId: me, followeeId: chi })
  await db.insert(mutes).values({ muterId: me, mutedId: dayo })

  assert.deepEqual((await service.suggestions(me, ['lagos'])).map((p) => p.handle), ['eve'])
  // The block hides the newcomer from the other side too.
  assert.ok(!(await service.suggestions(bayo, ['lagos'])).some((p) => p.handle === 'newbie'))
})

test('only live, recent posts count as activity', async () => {
  await say(ada, 10, lagos, { deletedAt: new Date() })
  await say(bayo, 10, lagos, { removedAt: new Date() })
  await say(chi, 31 * DAY, lagos)
  await say(dayo, 29 * DAY, lagos)
  assert.deepEqual((await service.suggestions(me, ['lagos'])).map((p) => p.handle), ['dayo'])
})

test(`at most ${SUGGESTION_LIMIT} people are suggested`, async () => {
  const crowd = Array.from({ length: SUGGESTION_LIMIT + 3 }, (_, i) => ({ id: randomUUID(), handle: `crowd${i}` }))
  await db.insert(members).values(crowd)
  for (const [i, m] of crowd.entries()) await say(m.id, i)
  const people = await service.suggestions(me, [])
  assert.equal(people.length, SUGGESTION_LIMIT)
  assert.equal(people[0]!.handle, 'crowd0')
})

test('completing joins and follows through the usual paths, passing over what it cannot, and ends the flow', async () => {
  await db.insert(blocks).values({ blockerId: dayo, blockedId: me })
  const done = await service.complete(me, {
    communities: ['lagos', 'abuja', 'lagos', 'gone'],
    follow: ['ada', 'bayo', 'newbie', 'dayo', 'nobody'],
  })
  assert.deepEqual(done, { joined: ['lagos', 'abuja'], followed: ['ada', 'bayo'] })

  // Counts and notifications as if each had been done on its own.
  const listed = await communitiesService.list(me)
  assert.deepEqual(listed.map((c) => [c.slug, c.memberCount, c.viewerIsMember]), [['abuja', 1, true], ['lagos', 1, true]])
  assert.equal((await membersService.profile(me, 'ada'))!.followerCount, 1)
  assert.equal((await membersService.profile(me, 'ada'))!.viewerFollows, true)
  const told = await db
    .select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(and(eq(notifications.kind, 'follow'), eq(notifications.actorId, me)))
  assert.deepEqual(told.map((n) => n.recipientId).sort(), [ada, bayo].sort())
  assert.ok(await onboardedAt(me))
})

test('completing is all or nothing', async () => {
  const failing = new OnboardingService(db, communitiesService, {
    follow: async () => {
      throw new Error('database went away')
    },
  } as unknown as MembersService)
  await assert.rejects(failing.complete(me, { communities: ['lagos'], follow: ['ada'] }), /database went away/)
  assert.equal((await db.select().from(communityMemberships).where(eq(communityMemberships.memberId, me))).length, 0)
  assert.equal(await onboardedAt(me), null)
})

test('skipping ends the flow without joining or following anyone; going through again keeps the first time', async () => {
  assert.equal(await onboardedAt(me), null)
  await service.skip(me)
  const first = await onboardedAt(me)
  assert.ok(first)
  assert.equal((await db.select().from(follows).where(eq(follows.followerId, me))).length, 0)
  assert.equal((await db.select().from(communityMemberships).where(eq(communityMemberships.memberId, me))).length, 0)

  await service.complete(me, { communities: ['lagos'], follow: ['ada'] })
  assert.deepEqual(await onboardedAt(me), first)
  await service.skip(me)
  assert.deepEqual(await onboardedAt(me), first)
})

test('completing an empty choice ends the flow too', async () => {
  assert.deepEqual(await service.complete(me, { communities: [], follow: [] }), { joined: [], followed: [] })
  assert.ok(await onboardedAt(me))
})

// --- Who is sent to /welcome: the web app asks /v1/me for `onboarded`. ---

const invites = new InvitesService(db)
const auth = new AuthController(
  invites,
  new ModerationService(db),
  new NotificationsService(db),
  {} as never,
  {} as never,
  db,
  {} as never,
  membersService,
  {} as never,
  new FeatureFlags(db, 'development'),
  { effective: (on: boolean) => on },
)
const meFor = (id: string, handle: string) => auth.me({ member: { id, handle } } as AuthedRequest)

test('members from before the welcome flow are not sent to it; newcomers are, until they finish or skip', async () => {
  // Migration 0019's backfill, run against members who were already here.
  const sql = await readFile(new URL('../drizzle/0019_onboarding.sql', import.meta.resolve('@heynaija/db')), 'utf8')
  const backfill = sql.split('--> statement-breakpoint').find((s) => /^\s*UPDATE/m.test(s))
  assert.ok(backfill, '0019 backfills onboarded_at')
  await pool.query(backfill)
  for (const [id, handle] of [[ada, 'ada'], [me, 'newbie']] as const) {
    assert.equal((await meFor(id, handle)).onboarded, true)
  }

  // Someone invited afterwards, seen for the first time by the session guard.
  const newcomer = { id: randomUUID(), handle: 'newcomer' }
  assert.equal(await invites.redeem(await invites.create(), newcomer.id), true)
  const guard = new SessionGuard({ identityForRequest: async () => newcomer }, { WEB_PUBLIC_URL: 'http://127.0.0.1:3000' }, db, invites)
  const req = { method: 'GET', headers: {}, cookies: { hn_session: 'good' } }
  assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext), true)
  assert.equal((await meFor(newcomer.id, newcomer.handle)).onboarded, false)

  await service.skip(newcomer.id)
  assert.equal((await meFor(newcomer.id, newcomer.handle)).onboarded, true)
})

// --- The endpoints: same guard and budget as other member writes. ---

test('completing draws one action from the shared budget per join and follow', async () => {
  const hits: LimitKind[] = []
  const limits = { hit: async (kind: LimitKind) => void hits.push(kind) } as RateLimiter
  const controller = new OnboardingController(service, limits)
  const req = { member: { id: me, handle: 'newbie' } } as AuthedRequest

  assert.deepEqual(await controller.complete(req, { communities: ['lagos'], follow: ['ada', 'bayo'] }), {
    joined: ['lagos'],
    followed: ['ada', 'bayo'],
  })
  assert.deepEqual(hits, ['action', 'action', 'action'])

  hits.length = 0
  await controller.skip(req)
  assert.deepEqual(hits, ['action'])

  await assert.rejects(controller.complete(req, { follow: ['Not A Handle'] }), BadRequestException)
  await assert.rejects(controller.complete(req, { communities: Array(51).fill('lagos') }), BadRequestException)
  assert.throws(() => controller.suggestions(req, { communities: 'lagos,../etc' }), BadRequestException)
  assert.deepEqual(await controller.suggestions(req, { communities: 'lagos,abuja' }), [])
})
