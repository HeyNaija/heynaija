import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { communities, communityMemberships, gists, members, moderationActions, notifications, posts, reports } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { CommunitiesService } from '../communities/communities.service.js'
import { FakeRoomService } from '../gists/fake-room-service.js'
import { GistsService } from '../gists/gists.service.js'
import { PostsService } from '../posts/posts.service.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { ModerationService, ModerationTargetError, NotAModeratorError } from './moderation.service.js'
import type { SafetyAlerts } from './safety-alerts.js'

// Alerts are recorded rather than emailed.
const alerts: { subject: string; lines: string[] }[] = []
const recordingAlerts: SafetyAlerts = { alert: async (subject, lines) => void alerts.push({ subject, lines }) }
const service = new ModerationService(db, undefined, recordingAlerts)
const postsService = new PostsService(db)
const communitiesService = new CommunitiesService(db)

const ada = randomUUID() // ordinary member
const bayo = randomUUID() // ordinary member
const sam = randomUUID() // site moderator
const lola = randomUUID() // moderator of the Lagos community only

before(migrate)
beforeEach(async () => {
  await reset()
  alerts.length = 0
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: sam, handle: 'sam' },
    { id: lola, handle: 'lola' },
  ])
  await db.insert(communities).values([
    { slug: 'lagos', name: 'Lagos', description: '' },
    { slug: 'abuja', name: 'Abuja', description: '' },
  ])
  await service.setSiteModerator('sam', true)
  await service.setCommunityModerator('lola', 'lagos', true)
})
after(() => pool.end())

const feedTexts = async () => (await postsService.feed(null, 50)).posts.map((p) => p.text)
const openReports = async () => (await db.select().from(reports).where(eq(reports.status, 'open'))).length

test('roles: site-wide, one community, or none', async () => {
  assert.deepEqual(await service.scope(sam), { siteWide: true, communityIds: [] })
  const lolaScope = await service.scope(lola)
  assert.equal(lolaScope.siteWide, false)
  assert.equal(lolaScope.communityIds.length, 1)
  assert.deepEqual(await service.scope(ada), { siteWide: false, communityIds: [] })

  // Granting a community role also joins the community, and it shows on the page.
  assert.deepEqual((await communitiesService.detail(null, 'lagos'))!.moderators, ['lola'])
  await service.setCommunityModerator('lola', 'lagos', false)
  assert.deepEqual((await service.scope(lola)).communityIds, [])
  await assert.rejects(service.setSiteModerator('nobody', true), ModerationTargetError)
})

test('ordinary members cannot see the queue, the log, or resolve anything', async () => {
  const { id } = await postsService.create(bayo, 'spam')
  await service.report(ada, { postId: id }, 'spam')
  const [report] = await db.select().from(reports)
  await assert.rejects(service.queue(ada), NotAModeratorError)
  await assert.rejects(service.log(ada), NotAModeratorError)
  await assert.rejects(service.resolve(ada, report!.id, 'remove_post'), NotAModeratorError)
  await assert.rejects(service.restorePost(ada, id), NotAModeratorError)
  await assert.rejects(service.setSuspended(ada, 'bayo', true), NotAModeratorError)
  assert.deepEqual(await feedTexts(), ['spam'])
})

test('reporting: no duplicates, not your own, not something that is gone', async () => {
  const { id } = await postsService.create(bayo, 'rude')
  await service.report(ada, { postId: id }, 'harassment', 'called me names')
  await service.report(ada, { postId: id }, 'spam')
  assert.equal(await openReports(), 1)

  await assert.rejects(service.report(bayo, { postId: id }, 'spam'), ModerationTargetError)
  await assert.rejects(service.report(ada, { handle: 'ada' }, 'spam'), ModerationTargetError)
  await assert.rejects(service.report(ada, { postId: randomUUID() }, 'spam'), ModerationTargetError)
  await assert.rejects(service.report(ada, { handle: 'ghost' }, 'spam'), ModerationTargetError)

  await service.report(ada, { handle: 'bayo' }, 'harassment')
  assert.equal(await openReports(), 2)
})

test('the queue shows what was reported, by whom, and how many times', async () => {
  const { id } = await postsService.create(bayo, 'buy my coin')
  await service.report(ada, { postId: id }, 'scam', 'crypto scam')
  await service.report(lola, { postId: id }, 'spam')

  const queue = await service.queue(sam)
  assert.equal(queue.length, 2)
  assert.deepEqual(
    { reason: queue[0]!.reason, details: queue[0]!.details, by: queue[0]!.reporterHandle, count: queue[0]!.reportCount },
    { reason: 'scam', details: 'crypto scam', by: 'ada', count: 2 },
  )
  assert.deepEqual(queue[0]!.post, { id, text: 'buy my coin', images: [], authorHandle: 'bayo', communityName: null })
})

test('removing a post hides it everywhere, closes every report on it, and is logged', async () => {
  const { id } = await postsService.create(bayo, 'bad post')
  const reply = await postsService.create(ada, 'reply to it', { replyTo: id })
  await service.report(ada, { postId: id }, 'hate')
  await service.report(lola, { postId: id }, 'hate')
  const [first] = await service.queue(sam)

  await service.resolve(sam, first!.id, 'remove_post', 'hate speech')

  assert.deepEqual(await feedTexts(), [])
  assert.equal(await postsService.thread(null, id), null)
  assert.equal((await postsService.search(null, 'bad', 10)).length, 0)
  const thread = (await postsService.thread(null, reply.id))!
  assert.equal(thread.ancestors[0]!.deleted, true)
  assert.equal(thread.ancestors[0]!.text, '')
  await assert.rejects(postsService.create(ada, 'x', { replyTo: id }))

  assert.equal(await openReports(), 0)
  assert.deepEqual((await db.select().from(reports)).map((r) => [r.status, r.resolvedBy]), [
    ['actioned', sam],
    ['actioned', sam],
  ])
  const [entry] = await service.log(sam)
  assert.deepEqual(
    { action: entry!.action, note: entry!.note, actor: entry!.actorHandle, postId: entry!.postId, member: entry!.memberHandle },
    { action: 'remove_post', note: 'hate speech', actor: 'sam', postId: id, member: 'bayo' },
  )

  // Already resolved: a second moderator clicking the same report gets a clear refusal.
  await assert.rejects(service.resolve(sam, first!.id, 'dismiss'), ModerationTargetError)

  await service.restorePost(sam, id, 'on reflection, fine')
  assert.deepEqual(await feedTexts(), ['bad post'])
  await assert.rejects(service.restorePost(sam, id), ModerationTargetError)
})

test('dismissing leaves the post alone', async () => {
  const { id } = await postsService.create(bayo, 'fine post')
  await service.report(ada, { postId: id }, 'other')
  const [item] = await service.queue(sam)
  await service.resolve(sam, item!.id, 'dismiss', 'nothing wrong')
  assert.deepEqual(await feedTexts(), ['fine post'])
  assert.equal((await db.select().from(reports))[0]!.status, 'dismissed')
  assert.equal((await service.log(sam))[0]!.action, 'dismiss_report')
})

test('a community moderator only handles posts in their own community', async () => {
  await communitiesService.join(bayo, 'lagos')
  await communitiesService.join(bayo, 'abuja')
  const inLagos = await postsService.create(bayo, 'lagos post', { communitySlug: 'lagos' })
  const inAbuja = await postsService.create(bayo, 'abuja post', { communitySlug: 'abuja' })
  const nowhere = await postsService.create(bayo, 'general post')
  for (const post of [inLagos, inAbuja, nowhere]) await service.report(ada, { postId: post.id }, 'spam')
  await service.report(ada, { handle: 'bayo' }, 'spam')

  const lolaQueue = await service.queue(lola)
  assert.deepEqual(lolaQueue.map((r) => r.post?.text), ['lagos post'])
  assert.equal((await service.queue(sam)).length, 4)

  const all = await db.select().from(reports)
  const reportFor = (postId: string) => all.find((r) => r.postId === postId)!.id
  await assert.rejects(service.resolve(lola, reportFor(inAbuja.id), 'remove_post'), NotAModeratorError)
  await assert.rejects(service.resolve(lola, reportFor(nowhere.id), 'dismiss'), NotAModeratorError)
  // In scope, but suspending accounts is for site moderators.
  await assert.rejects(service.resolve(lola, reportFor(inLagos.id), 'suspend_member'), NotAModeratorError)
  await assert.rejects(service.restorePost(lola, inLagos.id), NotAModeratorError)

  await service.resolve(lola, reportFor(inLagos.id), 'remove_post')
  assert.deepEqual((await feedTexts()).sort(), ['abuja post', 'general post'])
  // Community moderators see their own decisions in the log, not everyone's.
  assert.equal((await service.log(lola)).length, 1)
})

test('suspending an account hides its posts; reinstating brings them back', async () => {
  const { id } = await postsService.create(bayo, 'from bayo')
  await service.report(ada, { postId: id }, 'harassment')
  const [item] = await service.queue(sam)

  await service.resolve(sam, item!.id, 'suspend_member', 'repeated harassment')
  const [suspended] = await db.select().from(members).where(eq(members.id, bayo))
  assert.deepEqual([suspended!.active, suspended!.status], [false, 'suspended'])
  assert.deepEqual(await feedTexts(), [])

  await service.setSuspended(sam, 'bayo', false, 'appeal upheld')
  assert.deepEqual(await feedTexts(), ['from bayo'])
  assert.deepEqual((await service.log(sam)).map((e) => e.action), ['reinstate_member', 'suspend_member'])
})

test('moderators cannot suspend themselves or another site moderator', async () => {
  await assert.rejects(service.setSuspended(sam, 'sam', true), ModerationTargetError)
  await db.insert(members).values({ id: randomUUID(), handle: 'tolu', role: 'moderator' })
  await assert.rejects(service.setSuspended(sam, 'tolu', true), ModerationTargetError)

  const { id } = await postsService.create(sam, 'by a moderator')
  await service.report(ada, { postId: id }, 'other')
  const [item] = await service.queue(sam)
  await assert.rejects(service.resolve(sam, item!.id, 'suspend_member'), ModerationTargetError)
  // A refused action must leave no trace.
  assert.equal(await openReports(), 1)
  assert.equal((await db.select().from(moderationActions)).length, 0)
})

test('appeals: only when suspended, one at a time, and they can be granted', async () => {
  await assert.rejects(service.appeal(bayo, 'I did nothing wrong'), ModerationTargetError)

  await service.setSuspended(sam, 'bayo', true, 'spam')
  await service.appeal(bayo, 'That was not spam, it was a community notice.')
  await service.appeal(bayo, 'Hello? Please look again.')
  const queue = await service.queue(sam)
  assert.equal(queue.length, 1)
  assert.deepEqual(
    { reason: queue[0]!.reason, by: queue[0]!.reporterHandle, member: queue[0]!.member },
    { reason: 'appeal', by: 'bayo', member: { handle: 'bayo', active: false, displayName: null, bio: '', avatar: null } },
  )

  await service.resolve(sam, queue[0]!.id, 'reinstate_member', 'fair point')
  assert.equal((await db.select().from(members).where(eq(members.id, bayo)))[0]!.active, true)
  assert.equal(await openReports(), 0)
})

test('an author deleting a reported post does not break the queue', async () => {
  const { id } = await postsService.create(bayo, 'regret')
  await service.report(ada, { postId: id }, 'other')
  await postsService.remove(bayo, id)
  const [item] = await service.queue(sam)
  assert.equal(item!.post!.text, 'regret')
  await service.resolve(sam, item!.id, 'dismiss')
  assert.equal((await db.select().from(posts))[0]!.removedAt, null)
})

test('a site moderator assigns community moderators in the app; it is logged and the member told', async () => {
  await service.assignCommunityModerator(sam, 'ada', 'abuja', true, 'knows the city')
  assert.equal((await service.scope(ada)).communityIds.length, 1)
  assert.deepEqual(
    (await service.moderatorRoster(sam)).map((c) => [c.slug, c.moderators.map((m) => m.handle)]),
    [
      ['abuja', ['ada']],
      ['lagos', ['lola']],
    ],
  )

  const [entry] = await service.log(sam)
  assert.deepEqual([entry!.action, entry!.memberHandle, entry!.communityName, entry!.note], [
    'grant_community_moderator',
    'ada',
    'Abuja',
    'knows the city',
  ])
  const [told] = await db.select().from(notifications).where(eq(notifications.recipientId, ada))
  assert.equal(told!.kind, 'moderator_granted')

  await assert.rejects(service.assignCommunityModerator(sam, 'ada', 'abuja', true), /already moderates/)
  await service.assignCommunityModerator(sam, 'ada', 'abuja', false)
  assert.deepEqual((await service.scope(ada)).communityIds, [])
  await assert.rejects(service.assignCommunityModerator(sam, 'ada', 'abuja', false), /does not moderate/)
})

test('only site moderators assign roles, and never to a suspended account', async () => {
  await assert.rejects(service.assignCommunityModerator(lola, 'ada', 'lagos', true), NotAModeratorError)
  await assert.rejects(service.assignCommunityModerator(ada, 'bayo', 'lagos', true), NotAModeratorError)
  await assert.rejects(service.moderatorRoster(lola), NotAModeratorError)
  await assert.rejects(service.assignCommunityModerator(sam, 'ada', 'nowhere', true), /no community/)

  await service.setSuspended(sam, 'bayo', true)
  await assert.rejects(service.assignCommunityModerator(sam, 'bayo', 'lagos', true), /suspended/)
})

test('reports of illegal content come first in the queue, and alert whoever handles safety', async () => {
  const spam = await postsService.create(bayo, 'buy followers')
  const other = await postsService.create(bayo, 'something odd')
  const illegal = await postsService.create(bayo, 'something illegal')
  await service.report(ada, { postId: spam.id }, 'spam')
  await service.report(ada, { postId: other.id }, 'other')
  assert.equal(alerts.length, 0)
  await service.report(ada, { postId: illegal.id }, 'illegal')

  assert.deepEqual((await service.queue(sam)).map((i) => i.post!.text), ['something illegal', 'buy followers', 'something odd'])
  assert.equal(alerts.length, 1)
  assert.match(alerts[0]!.lines.join(' '), new RegExp(illegal.id))
  // The alert names what to look at, never the content.
  assert.doesNotMatch(alerts[0]!.lines.join(' '), /something illegal/)
})

test('a report the upload scanner filed has no reporter, and closing it tells nobody', async () => {
  await db.insert(reports).values({ reporterId: null, memberId: bayo, reason: 'illegal', details: 'matched' })
  const [item] = await service.queue(sam)
  assert.equal(item!.reporterHandle, null)
  assert.equal(item!.member!.handle, 'bayo')

  await service.resolve(sam, item!.id, 'suspend_member')
  assert.equal((await db.select().from(members).where(eq(members.id, bayo)))[0]!.active, false)
  assert.deepEqual(await db.select().from(notifications), [])
})

// ---- Gists (docs/adr/0017) ------------------------------------------------------

const rooms = new FakeRoomService()
const gistsService = new GistsService(
  db,
  rooms,
  { callsMembers: ['ada', 'bayo', 'sam', 'lola'], maxCohosts: 2, maxSpeakers: 2, listenerCap: 10, livekitUrl: 'wss://livekit.test' },
  new MemoryRateLimiter(),
)
// With a way to end Gists, as the app has.
const withGists = new ModerationService(db, undefined, recordingAlerts, gistsService)
const as = (id: string, handle: string) => ({ id, handle })
const gistQueueItem = async (moderator: string) => (await withGists.queue(moderator)).find((item) => item.gist)

test('a Gist is reported by someone who has been in it, not its host, once, with who was there', async () => {
  const gist = (await gistsService.create(as(ada, 'ada'), { title: 'Jollof wars' })).id
  await gistsService.join(as(ada, 'ada'), gist)
  await gistsService.join(as(bayo, 'bayo'), gist)

  await assert.rejects(withGists.report(lola, { gistId: gist }, 'harassment'), /only report a Gist you have been in/)
  await assert.rejects(withGists.report(ada, { gistId: gist }, 'harassment'), /your own Gist/)
  await assert.rejects(withGists.report(bayo, { gistId: randomUUID() }, 'harassment'), /only report a Gist you have been in/)
  await withGists.report(bayo, { gistId: gist }, 'harassment', 'shouting abuse')
  await withGists.report(bayo, { gistId: gist }, 'harassment')
  assert.equal(await openReports(), 1)

  const item = await gistQueueItem(sam)
  assert.ok(item)
  assert.equal(item.details, 'shouting abuse')
  assert.equal(item.post, null)
  assert.equal(item.member, null)
  assert.deepEqual(
    { title: item.gist!.title, status: item.gist!.status, host: item.gist!.hostHandle, participants: item.gist!.participants },
    { title: 'Jollof wars', status: 'live', host: 'ada', participants: [{ handle: 'ada', role: 'host' }, { handle: 'bayo', role: 'listener' }] },
  )
  // A later report records who is there then: bayo has left, sam came in.
  await gistsService.leave(as(bayo, 'bayo'), gist)
  await gistsService.join(as(sam, 'sam'), gist)
  await withGists.report(sam, { gistId: gist }, 'other')
  const records = (await withGists.queue(sam)).filter((i) => i.gist).map((i) => i.gist!.participants.map((p) => p.handle))
  assert.deepEqual(records, [['ada', 'bayo'], ['ada', 'sam']])
})

test('a moderator ends a reported Gist: room gone, reports closed, logged, and the reporter told', async () => {
  const gist = (await gistsService.create(as(ada, 'ada'), { title: 'Jollof wars' })).id
  await gistsService.join(as(bayo, 'bayo'), gist)
  await withGists.report(bayo, { gistId: gist }, 'harassment')
  const item = await gistQueueItem(sam)
  // A Gist outside any community is for site moderators only.
  assert.equal(await gistQueueItem(lola), undefined)
  await assert.rejects(withGists.resolve(lola, item!.id, 'end_gist'), NotAModeratorError)

  await withGists.resolve(sam, item!.id, 'end_gist', 'abuse on the mic')
  assert.equal((await db.select({ status: gists.status }).from(gists).where(eq(gists.id, gist)))[0]!.status, 'ended')
  assert.ok(rooms.deleted.includes(gist), 'everyone is disconnected')
  assert.equal(await openReports(), 0)
  const told = await db.select().from(notifications).where(eq(notifications.recipientId, bayo))
  assert.deepEqual(told.map((n) => [n.kind, n.detail]), [['report_resolved', 'gist_actioned']])
  const [entry] = await withGists.log(sam)
  assert.deepEqual({ action: entry!.action, gist: entry!.gistTitle, note: entry!.note }, { action: 'end_gist', gist: 'Jollof wars', note: 'abuse on the mic' })
  await assert.rejects(withGists.resolve(sam, item!.id, 'end_gist'), /already resolved/)
})

test('a community Gist goes to that community’s moderators too; dismissing leaves it live and says so', async () => {
  const [lagos] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, 'lagos'))
  await db.insert(communityMemberships).values([
    { communityId: lagos!.id, memberId: ada },
    { communityId: lagos!.id, memberId: bayo },
  ])
  const gist = (await gistsService.create(as(ada, 'ada'), { title: 'Lagos gist', communityId: lagos!.id })).id
  await gistsService.join(as(bayo, 'bayo'), gist)
  await withGists.report(bayo, { gistId: gist }, 'spam')
  const item = await gistQueueItem(lola)
  assert.equal(item?.gist?.communityName, 'Lagos')
  await assert.rejects(withGists.resolve(ada, item!.id, 'dismiss'), NotAModeratorError)

  await withGists.resolve(lola, item!.id, 'dismiss')
  assert.equal((await db.select({ status: gists.status }).from(gists).where(eq(gists.id, gist)))[0]!.status, 'live')
  const told = await db.select().from(notifications).where(eq(notifications.recipientId, bayo))
  assert.deepEqual(told.map((n) => n.detail), ['gist_dismissed'])
})

test('End the Gist is only for a report about a Gist, and a LiveKit failure leaves the report open', async () => {
  const post = await postsService.create(ada, 'a post')
  await withGists.report(bayo, { postId: post.id }, 'spam')
  const [postReport] = await withGists.queue(sam)
  await assert.rejects(withGists.resolve(sam, postReport!.id, 'end_gist'), /not about a Gist/)

  const gist = (await gistsService.create(as(ada, 'ada'), { title: 'Jollof wars' })).id
  await gistsService.join(as(bayo, 'bayo'), gist)
  await withGists.report(bayo, { gistId: gist }, 'harassment')
  const item = await gistQueueItem(sam)
  const failing = new ModerationService(db, undefined, recordingAlerts, {
    endNow: async () => {
      throw new Error('LiveKit is down')
    },
  })
  await assert.rejects(failing.resolve(sam, item!.id, 'end_gist'), /LiveKit is down/)
  assert.ok((await gistQueueItem(sam))?.id === item!.id, 'the report is still open to try again')
})
