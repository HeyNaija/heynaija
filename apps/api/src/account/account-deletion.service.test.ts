import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import {
  ageAssurances,
  bookmarks,
  communities,
  communityMemberships,
  follows,
  governanceAuditLog,
  ideas,
  ideaVotes,
  inviteRedemptions,
  invites,
  likes,
  media,
  members,
  moderationActions,
  mutes,
  blocks,
  notificationOptOuts,
  notifications,
  postHashtags,
  postMentions,
  posts,
  privacyRequests,
  problemDetails,
  profileBadges,
  pushSubscriptions,
  releasedHandles,
  reports,
  reposts,
} from '@heynaija/db'
import { and, eq, or, type SQL, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { ExportService } from '../export/export.service.js'
import type { MediaJobs } from '../media/media.service.js'
import { MediaService } from '../media/media.service.js'
import type { Bucket, ObjectStore } from '../media/object-store.js'
import { MembersService } from '../members/members.service.js'
import { ModerationService, ModerationTargetError } from '../moderation/moderation.service.js'
import { notify } from '../notifications/notifications.service.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { AccountDeletionError, AccountDeletionService, type DeletionNotices, tombstoneHandle } from './account-deletion.service.js'

// The database is real; Kratos, email addresses and storage are stood in for.
class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>()
  async presignUpload(key: string) {
    return `memory://uploads/${key}`
  }
  async size(bucket: Bucket, key: string) {
    return this.objects.get(`${bucket}/${key}`)?.length ?? null
  }
  async read(bucket: Bucket, key: string) {
    return this.objects.get(`${bucket}/${key}`)!
  }
  async write(bucket: Bucket, key: string, body: Buffer) {
    this.objects.set(`${bucket}/${key}`, body)
  }
  async remove(bucket: Bucket, key: string) {
    this.objects.delete(`${bucket}/${key}`)
  }
  keys(bucket: Bucket) {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/`)).sort()
  }
}

class RecordingJobs implements MediaJobs {
  readonly purged: string[] = []
  async processPostImage() {}
  async purgeCdn(keys: string[]) {
    this.purged.push(...keys)
  }
}

/** Kratos as the deletion sees it: which identities had their sessions ended or were deleted. */
class FakeKratos {
  readonly revoked: string[] = []
  readonly deleted = new Set<string>()
  failing = new Set<'address' | 'sessions' | 'identity'>()
  async revokeAllSessions(memberId: string) {
    if (this.failing.has('sessions')) throw new Error('Kratos is down')
    this.revoked.push(memberId)
  }
  async deleteIdentity(memberId: string) {
    if (this.failing.has('identity')) throw new Error('Kratos is down')
    this.deleted.add(memberId)
  }
  // KratosAddresses: an address while the identity exists.
  async addressFor(memberId: string) {
    if (this.failing.has('address')) throw new Error('Kratos is down')
    return this.deleted.has(memberId) ? null : `${memberId}@example.test`
  }
}

class RecordingNotices implements DeletionNotices {
  readonly scheduledFor: [string, Date][] = []
  readonly erasedTo: string[] = []
  failErased = false
  async scheduled(memberId: string, at: Date) {
    this.scheduledFor.push([memberId, at])
  }
  async erased(email: string) {
    if (this.failErased) throw new Error('SMTP is down')
    this.erasedTo.push(email)
  }
}

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-10-30T09:00:00Z')
const days = (n: number) => new Date(now.getTime() + n * DAY)
const env = { ACCOUNT_DELETION_GRACE_DAYS: 14, PRIVACY_REQUEST_DUE_DAYS: 30 }

let store: MemoryStore
let jobs: RecordingJobs
let kratos: FakeKratos
let notices: RecordingNotices
let failFiles: boolean
let deletion: AccountDeletionService
const postsService = new PostsService(db)
const membersService = new MembersService(db)
const moderation = new ModerationService(db)

const xena = randomUUID() // deletes her account
const yemi = randomUUID()
const zara = randomUUID()
const sam = randomUUID() // site moderator

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: xena, handle: 'xena', displayName: 'Xena Okafor', bio: 'I love jollof', onboardedAt: now, lastSeenAt: now },
    { id: yemi, handle: 'yemi' },
    { id: zara, handle: 'zara' },
    { id: sam, handle: 'sam' },
  ])
  await moderation.setSiteModerator('sam', true)
  store = new MemoryStore()
  jobs = new RecordingJobs()
  kratos = new FakeKratos()
  notices = new RecordingNotices()
  failFiles = false
  const mediaService = new MediaService(db, store, jobs)
  deletion = new AccountDeletionService(
    db,
    env,
    kratos,
    kratos,
    { eraseFilesOf: async (id) => (failFiles ? Promise.reject(new Error('R2 is down')) : mediaService.eraseFilesOf(id)) },
    membersService,
    notices,
  )
})
after(() => pool.end())

const member = async (id: string) => (await db.select().from(members).where(eq(members.id, id)))[0]!
const post = async (id: string) => (await db.select().from(posts).where(eq(posts.id, id)))[0]!
const requestsOf = (id: string) => db.select().from(privacyRequests).where(eq(privacyRequests.memberId, id))
const count = async (table: PgTable, where: SQL | undefined) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where))[0]!.n

/** A ready image of `owner`'s, with its published files in the bucket. */
async function image(owner: string, kind: 'avatar' | 'post_image', postId: string | null = null) {
  const [row] = await db
    .insert(media)
    .values({ ownerId: owner, kind, status: 'ready', contentType: 'image/webp', bytes: 1, postId, position: postId ? 0 : null, readyAt: now })
    .returning({ id: media.id })
  const sizes = kind === 'avatar' ? [96, 256] : [640, 1600]
  for (const px of sizes) store.objects.set(`media/${kind === 'avatar' ? 'avatars' : 'posts'}/${row!.id}/${px}.webp`, Buffer.from('img'))
  return row!.id
}

test('asking takes the account off the site at once, schedules the erase, and is recorded', async () => {
  const { id: hello } = await postsService.create(xena, 'hello everyone')
  assert.ok(await membersService.profile(null, 'xena'))

  assert.deepEqual(await deletion.request(xena, { channel: 'self_service' }, now), { scheduledFor: days(14), alreadyRequested: false })

  const row = await member(xena)
  assert.equal(row.active, false)
  assert.equal(row.status, null, 'a deletion is not a suspension')
  assert.deepEqual([row.deletionRequestedAt, row.deletionScheduledFor, row.deletedAt], [now, days(14), null])
  assert.equal(await membersService.profile(null, 'xena'), null)
  assert.equal(await postsService.post(null, hello), null)
  assert.deepEqual(await deletion.state(xena), { state: 'scheduled', scheduledFor: days(14) })
  assert.deepEqual(kratos.revoked, [xena], 'signed out everywhere')
  assert.deepEqual(notices.scheduledFor, [[xena, days(14)]])

  const [request] = await requestsOf(xena)
  assert.deepEqual(
    [request!.kind, request!.channel, request!.status, request!.receivedAt, request!.dueBy, request!.handledBy, request!.closedAt],
    ['deletion', 'self_service', 'in_progress', now, days(30), null, null],
  )

  // Asking again changes nothing...
  assert.deepEqual(await deletion.request(xena, { channel: 'self_service' }, days(1)), { scheduledFor: days(14), alreadyRequested: true })
  // ...except that an operator may bring the erase forward.
  assert.deepEqual(await deletion.request(xena, { channel: 'email', immediate: true, handledBy: sam }, days(2)), { scheduledFor: days(2), alreadyRequested: true })
  assert.equal((await requestsOf(xena)).length, 1)
  assert.equal(notices.scheduledFor.length, 1)
})

test('if Kratos cannot be reached the account still leaves the site; the erase signs it out', async () => {
  kratos.failing.add('sessions')
  await deletion.request(xena, { channel: 'self_service' }, now)
  assert.equal((await member(xena)).active, false)
  kratos.failing.clear()
  await deletion.erase(xena, days(14))
  assert.deepEqual(kratos.revoked, [xena])
})

test('a site moderator is demoted before deleting their own account; an operator can delete one', async () => {
  await assert.rejects(
    deletion.request(sam, { channel: 'self_service' }, now),
    (err: unknown) => err instanceof AccountDeletionError && err.code === 'site_moderator',
  )
  assert.equal((await member(sam)).active, true)
  await deletion.request(sam, { channel: 'email', immediate: true, handledBy: yemi }, now)
  assert.equal(await deletion.erase(sam, now), 'erased')
  assert.equal((await member(sam)).role, 'member')
  assert.equal((await moderation.scope(sam)).siteWide, false)
})

test('cancelling brings the account back; a suspended one stays suspended', async () => {
  await deletion.request(xena, { channel: 'self_service' }, now)
  assert.equal(await deletion.cancel(xena, days(13)), true)
  const back = await member(xena)
  assert.deepEqual([back.active, back.deletionRequestedAt, back.deletionScheduledFor], [true, null, null])
  assert.deepEqual(await deletion.state(xena), { state: 'none' })
  const [request] = await requestsOf(xena)
  assert.deepEqual([request!.status, request!.closedAt], ['cancelled', days(13)])
  assert.equal(await deletion.cancel(xena, days(13)), false, 'nothing left to cancel')

  await moderation.setSuspended(sam, 'yemi', true)
  await deletion.request(yemi, { channel: 'self_service' }, now)
  await deletion.cancel(yemi, days(1))
  const suspended = await member(yemi)
  assert.deepEqual([suspended.active, suspended.status], [false, 'suspended'])
})

test('once the erase is due it is too late to cancel, and an erase is refused before then', async () => {
  await deletion.request(xena, { channel: 'self_service' }, now)
  await assert.rejects(deletion.erase(xena, days(13)), (err: unknown) => err instanceof AccountDeletionError && err.code === 'not_due')
  await assert.rejects(deletion.cancel(xena, days(14)), (err: unknown) => err instanceof AccountDeletionError && err.code === 'too_late')
  assert.equal(await deletion.erase(xena, days(14)), 'erased')
  await assert.rejects(deletion.request(xena, { channel: 'email' }, days(15)), (err: unknown) => err instanceof AccountDeletionError && err.code === 'erased')
})

test('a cancelled deletion is never erased', async () => {
  await deletion.request(xena, { channel: 'self_service' }, now)
  await deletion.cancel(xena, days(1))
  assert.equal(await deletion.erase(xena, days(20)), 'cancelled')
  assert.equal((await member(xena)).handle, 'xena')
  assert.equal(kratos.deleted.size, 0)
})

test('a deletion asked for by email completes the request recorded when it arrived', async () => {
  const [recorded] = await db
    .insert(privacyRequests)
    .values({ memberId: null, kind: 'deletion', channel: 'email', status: 'received', receivedAt: days(-3), dueBy: days(27) })
    .returning()
  await deletion.request(xena, { channel: 'email', handledBy: sam, requestId: recorded!.id }, now)
  const linked = await requestsOf(xena)
  assert.deepEqual(
    linked.map((r) => [r.id, r.status, r.receivedAt, r.dueBy, r.handledBy]),
    [[recorded!.id, 'in_progress', days(-3), days(27), sam]],
    'one request, still due from when it arrived',
  )
  await deletion.erase(xena, days(14))
  assert.equal((await requestsOf(xena))[0]!.status, 'completed')

  // Another member's request is not this account's to complete, and nothing changes.
  const [yemis] = await db
    .insert(privacyRequests)
    .values({ memberId: yemi, kind: 'deletion', channel: 'email', status: 'received', receivedAt: now, dueBy: days(30) })
    .returning()
  await assert.rejects(
    deletion.request(zara, { channel: 'email', requestId: yemis!.id }, now),
    (err: unknown) => err instanceof AccountDeletionError && err.code === 'no_request',
  )
  assert.equal((await member(zara)).active, true)
})

test('the erases due are the accounts past their time and not yet erased, longest waiting first', async () => {
  await deletion.request(xena, { channel: 'self_service' }, now)
  await deletion.request(yemi, { channel: 'email', immediate: true, handledBy: sam }, days(1))
  await deletion.request(zara, { channel: 'self_service' }, now)
  await deletion.cancel(zara, days(1))
  assert.deepEqual(await deletion.due(days(13)), [yemi])
  assert.deepEqual(await deletion.due(days(14)), [yemi, xena])
  await deletion.erase(yemi, days(14))
  assert.deepEqual(await deletion.due(days(14)), [xena])
})

test('reinstating a member waiting for deletion lifts the suspension but keeps them off the site', async () => {
  // Both ways of reinstating: a decided appeal, and directly.
  await moderation.setSuspended(sam, 'xena', true)
  await moderation.appeal(xena, 'it was a joke')
  await deletion.request(xena, { channel: 'self_service' }, now)
  const [appeal] = await db.select().from(reports).where(eq(reports.reason, 'appeal'))
  await moderation.resolve(sam, appeal!.id, 'reinstate_member')
  let row = await member(xena)
  assert.deepEqual([row.active, row.status], [false, null])

  await moderation.setSuspended(sam, 'yemi', true)
  await deletion.request(yemi, { channel: 'self_service' }, now)
  await moderation.setSuspended(sam, 'yemi', false)
  row = await member(yemi)
  assert.deepEqual([row.active, row.status], [false, null])

  // Cancelling then brings them back, as nothing else holds them off.
  await deletion.cancel(yemi, days(1))
  assert.equal((await member(yemi)).active, true)
})

test('a member waiting for deletion cannot appeal, but can still be suspended', async () => {
  await moderation.setSuspended(sam, 'xena', true)
  await deletion.request(xena, { channel: 'self_service' }, now)
  await assert.rejects(moderation.appeal(xena, 'please'), (err: unknown) => err instanceof ModerationTargetError && /waiting to be deleted/.test(err.message))

  await deletion.request(yemi, { channel: 'self_service' }, now)
  await moderation.setSuspended(sam, 'yemi', true)
  await deletion.cancel(yemi, days(1))
  const row = await member(yemi)
  assert.deepEqual([row.active, row.status], [false, 'suspended'])
})

test('like, reply and repost counts leave with the request, come back on a cancel, and stay right after the erase', async () => {
  const { id: target } = await postsService.create(zara, 'who wants suya?')
  await postsService.like(xena, target)
  await postsService.like(yemi, target)
  await postsService.create(xena, 'me!', { replyTo: target })
  await postsService.repost(xena, target)
  const counts = async () => {
    const p = await post(target)
    return [p.likeCount, p.replyCount, p.repostCount]
  }
  assert.deepEqual(await counts(), [2, 1, 1])
  await deletion.request(xena, { channel: 'self_service' }, now)
  assert.deepEqual(await counts(), [1, 0, 0])
  await deletion.cancel(xena, days(1))
  assert.deepEqual(await counts(), [2, 1, 1])
  await deletion.request(xena, { channel: 'self_service' }, days(1))
  await deletion.erase(xena, days(15))
  assert.deepEqual(await counts(), [1, 0, 0])
  // And what readers are shown agrees.
  assert.equal((await postsService.post(null, target))!.likeCount, 1)
})

test('the erase removes what is personal and keeps what is evidence', async () => {
  // Xena's life on HeyNaija, then a suspension, an appeal and a deletion.
  const [lagos] = await db.insert(communities).values({ slug: 'lagos', name: 'Lagos', description: '' }).returning()
  await moderation.setCommunityModerator('xena', 'lagos', true)
  const { id: zPost } = await postsService.create(zara, 'jollof or fried rice?')
  const { id: yPost } = await postsService.create(yemi, 'thanks @xena for the recipe')
  const { id: ordinary } = await postsService.create(xena, 'hello @yemi #jollof see https://example.com/page', { communitySlug: 'lagos' })
  const { id: quoted } = await postsService.create(xena, 'this one', { quote: zPost })
  const { id: reply } = await postsService.create(xena, 'jollof, obviously', { replyTo: zPost })
  const { id: reported } = await postsService.create(xena, 'you are all wrong')
  const { id: removed } = await postsService.create(xena, 'something awful')
  const { id: idea } = await postsService.create(xena, 'Dark mode\n\nplease')
  await db.insert(ideas).values([{ postId: idea, kind: 'problem', title: 'Dark mode' }, { postId: yPost, kind: 'idea', title: 'thanks' }])
  await db.insert(problemDetails).values({ postId: idea, page: '/settings', browser: 'Firefox', appVersion: 'abc123' })
  await db.insert(ideaVotes).values([{ postId: idea, memberId: yemi }, { postId: yPost, memberId: xena }])

  const ordinaryImage = await image(xena, 'post_image', ordinary)
  const evidenceImage = await image(xena, 'post_image', reported)
  const unused = await image(xena, 'post_image')
  const avatar = await image(xena, 'avatar')
  await db.update(members).set({ avatarMediaId: avatar }).where(eq(members.id, xena))
  const [pending] = await db.insert(media).values({ ownerId: xena, kind: 'post_image', status: 'pending', contentType: 'image/jpeg', bytes: 9 }).returning()
  store.objects.set(`uploads/posts/${pending!.id}`, Buffer.from('raw'))

  await postsService.like(xena, zPost)
  await postsService.repost(xena, zPost)
  await postsService.bookmark(xena, zPost)
  await postsService.like(yemi, ordinary)
  await membersService.follow(xena, 'yemi')
  await membersService.follow(yemi, 'xena')
  await membersService.block(xena, 'zara')
  await membersService.mute(sam, 'xena')
  await postsService.pinToProfile(xena, ordinary)
  await postsService.pinInCommunity(sam, ordinary)
  await db.insert(notificationOptOuts).values({ memberId: xena, kind: 'like' })
  await db.insert(pushSubscriptions).values({ memberId: xena, endpoint: 'https://push.example/x', p256dh: 'k', auth: 'a' })
  await membersService.setFounder('xena', true)
  await db.insert(releasedHandles).values([
    { handle: 'xena_old', memberId: xena, releasedAt: days(-5) },
    { handle: 'xena_older', memberId: xena, releasedAt: days(-60) },
  ])
  await db.insert(invites).values({ codeHash: 'hash', note: 'for xena' })
  await db.insert(inviteRedemptions).values({ identityId: xena, codeHash: 'hash' })
  await db.insert(ageAssurances).values({ memberId: xena, band: '18_plus', method: 'self_declared' })
  await db.insert(governanceAuditLog).values({ subjectId: xena, event: 'age_declared', reason: '18_plus' })

  await moderation.report(yemi, { postId: reported }, 'harassment', 'she was rude to me')
  await moderation.report(zara, { postId: removed }, 'hate')
  const [removal] = await db.select().from(reports).where(eq(reports.postId, removed))
  await moderation.resolve(sam, removal!.id, 'remove_post')
  await moderation.report(xena, { postId: yPost }, 'spam', 'he keeps posting this')
  await moderation.setSuspended(sam, 'xena', true)
  await moderation.appeal(xena, 'I was provoked')

  await deletion.request(xena, { channel: 'self_service' }, now)
  assert.equal(await deletion.erase(xena, days(14)), 'erased')

  // The tombstone.
  const x = await member(xena)
  assert.deepEqual(
    [x.handle, x.displayName, x.bio, x.avatarMediaId, x.role, x.active, x.lastSeenAt, x.onboardedAt, x.emailNotifications, x.pinnedPostId, x.deletedAt],
    [tombstoneHandle(xena), null, '', null, 'member', false, null, null, false, null, days(14)],
  )
  assert.equal(x.status, 'suspended', 'the suspension stays on the record')

  // What she wrote: blanked, except what moderators looked at.
  for (const id of [ordinary, quoted, reply, idea]) {
    const p = await post(id)
    assert.deepEqual([p.text, p.linkUrl, p.quotePostId, p.deletedAt !== null], ['', null, null, true], id)
  }
  assert.equal((await post(reported)).text, 'you are all wrong')
  assert.equal((await post(removed)).text, 'something awful')
  assert.ok((await post(reported)).deletedAt && (await post(removed)).deletedAt)
  assert.equal(await count(postMentions, or(eq(postMentions.memberId, xena), eq(postMentions.postId, ordinary))), 0)
  assert.equal(await count(postHashtags, eq(postHashtags.postId, ordinary)), 0)
  assert.equal((await db.select().from(ideas).where(eq(ideas.postId, idea)))[0]!.title, '')
  assert.equal(await count(problemDetails, eq(problemDetails.postId, idea)), 0)
  assert.equal((await db.select().from(communities).where(eq(communities.id, lagos!.id)))[0]!.pinnedPostId, null)
  // Others' words about her stay as they wrote them.
  assert.equal((await post(yPost)).text, 'thanks @xena for the recipe')

  // What she did, and who she knew: gone. What others did is theirs.
  for (const [table, column] of [[likes, likes.memberId], [reposts, reposts.memberId], [bookmarks, bookmarks.memberId], [ideaVotes, ideaVotes.memberId]] as const) {
    assert.equal(await count(table, eq(column, xena)), 0)
  }
  assert.equal(await count(likes, eq(likes.memberId, yemi)), 1)
  assert.equal(await count(ideaVotes, eq(ideaVotes.memberId, yemi)), 1)
  assert.equal(await count(follows, or(eq(follows.followerId, xena), eq(follows.followeeId, xena))), 0)
  assert.equal(await count(blocks, or(eq(blocks.blockerId, xena), eq(blocks.blockedId, xena))), 0)
  assert.equal(await count(mutes, or(eq(mutes.muterId, xena), eq(mutes.mutedId, xena))), 0)
  assert.equal(await count(communityMemberships, eq(communityMemberships.memberId, xena)), 0)
  assert.equal(await count(notifications, or(eq(notifications.recipientId, xena), eq(notifications.actorId, xena))), 0)
  assert.equal(await count(notificationOptOuts, eq(notificationOptOuts.memberId, xena)), 0)
  assert.equal(await count(pushSubscriptions, eq(pushSubscriptions.memberId, xena)), 0)
  assert.equal(await count(profileBadges, eq(profileBadges.memberId, xena)), 0)
  assert.equal(await count(inviteRedemptions, eq(inviteRedemptions.identityId, xena)), 0)
  assert.equal(await count(invites, eq(invites.codeHash, 'hash')), 1, 'the invite itself is the operator’s record')
  assert.equal(await count(ageAssurances, eq(ageAssurances.memberId, xena)), 0)
  assert.equal(await count(governanceAuditLog, and(eq(governanceAuditLog.subjectId, xena), eq(governanceAuditLog.event, 'age_declared'))), 1)

  // Handles: her own held, an old hold still running kept, one that ran out gone.
  const held = await db.select({ handle: releasedHandles.handle }).from(releasedHandles).where(eq(releasedHandles.memberId, xena))
  assert.deepEqual(held.map((h) => h.handle).sort(), ['xena', 'xena_old'])

  // Moderation records: all kept. Her report stays open and hers; her appeal is closed.
  const hers = await db.select().from(reports).where(eq(reports.reporterId, xena))
  assert.deepEqual(hers.map((r) => [r.reason, r.status, r.details, r.resolvedBy]).sort(), [
    ['appeal', 'dismissed', 'I was provoked', null],
    ['spam', 'open', 'he keeps posting this', null],
  ])
  assert.equal(await count(reports, eq(reports.postId, reported)), 1)
  assert.equal(await count(moderationActions, or(eq(moderationActions.memberId, xena), eq(moderationActions.postId, removed))), 2)

  // Images: evidence kept privately, everything else deleted and purged from the CDN.
  const statuses = Object.fromEntries((await db.select().from(media).where(eq(media.ownerId, xena))).map((m) => [m.id, m.status]))
  assert.deepEqual(statuses, { [ordinaryImage]: 'deleted', [evidenceImage]: 'quarantined', [unused]: 'deleted', [avatar]: 'deleted', [pending!.id]: 'deleted' })
  assert.deepEqual(store.keys('media'), [])
  assert.deepEqual(store.keys('uploads'), [`uploads/quarantine/posts/${evidenceImage}/1600.webp`, `uploads/quarantine/posts/${evidenceImage}/640.webp`])
  for (const id of [ordinaryImage, unused, evidenceImage]) assert.ok(jobs.purged.includes(`posts/${id}/640.webp`), id)
  assert.ok(jobs.purged.includes(`avatars/${avatar}/256.webp`))

  // Kratos, the request and the last email.
  assert.ok(kratos.deleted.has(xena))
  const [request] = await requestsOf(xena)
  assert.deepEqual([request!.status, request!.closedAt], ['completed', days(14)])
  assert.deepEqual(notices.erasedTo, [`${xena}@example.test`])
  assert.deepEqual(await deletion.state(xena), { state: 'erased' })
})

test('a photo is kept privately while a report about the account is still open', async () => {
  const avatar = await image(xena, 'avatar')
  await db.update(members).set({ avatarMediaId: avatar }).where(eq(members.id, xena))
  await moderation.report(yemi, { handle: 'xena' }, 'harassment', 'look at her photo')
  await deletion.request(xena, { channel: 'self_service' }, now)
  await deletion.erase(xena, days(14))
  assert.equal((await db.select().from(media).where(eq(media.id, avatar)))[0]!.status, 'quarantined')
  assert.deepEqual(store.keys('media'), [])
  assert.equal((await member(xena)).avatarMediaId, null)
})

test('the handle is held for 30 days and leads nowhere; the tombstone cannot be found', async () => {
  await deletion.request(xena, { channel: 'self_service' }, now)
  await deletion.erase(xena, days(14))
  assert.equal(await membersService.handleHeld('xena', null), true, 'nobody can sign up with it')
  assert.equal(await membersService.handleHeld('xena', yemi), true, 'nor rename to it')
  assert.equal(await membersService.movedTo(null, 'xena'), null)
  assert.equal(await membersService.profile(null, 'xena'), null)
  assert.equal(await membersService.profile(null, tombstoneHandle(xena)), null)
  assert.deepEqual(await membersService.search('deleted', 10), [])
  assert.match(tombstoneHandle(xena), /^deleted-[0-9a-f]{8}$/)
})

test('other people’s conversations keep their place around an erased account’s posts', async () => {
  const { id: root } = await postsService.create(zara, 'favourite street food?')
  const { id: hers } = await postsService.create(xena, 'boli and fish', { replyTo: root })
  const { id: answer } = await postsService.create(yemi, 'with groundnut!', { replyTo: hers })
  await postsService.create(xena, 'also suya', { replyTo: root })

  // Waiting for deletion she is hidden like a suspended member, branch and all.
  await deletion.request(xena, { channel: 'self_service' }, now)
  assert.deepEqual((await postsService.thread(zara, root))!.replies.map((r) => r.id), [])

  // Erased, her reply with an answer under it is a placeholder; the other is gone.
  await deletion.erase(xena, days(14))
  const replies = (await postsService.thread(zara, root))!.replies
  assert.deepEqual(replies.map((r) => [r.id, r.unavailable === true]), [[hers, true]])
  const thread = (await postsService.thread(null, answer))!
  assert.deepEqual(thread.ancestors.map((p) => [p.id, p.deleted, p.text]), [[root, false, 'favourite street food?'], [hers, true, '']])
  assert.equal(thread.post.text, 'with groundnut!')
  assert.equal(await postsService.thread(null, hers), null)
})

test('another member’s export still works and holds nothing of the erased account', async () => {
  const { id: hers } = await postsService.create(xena, 'my secret recipe')
  await db.update(members).set({ displayName: 'Xena Okafor' }).where(eq(members.id, xena))
  await postsService.create(yemi, 'thanks @xena')
  await postsService.like(yemi, hers)
  await membersService.follow(yemi, 'xena')
  await membersService.follow(xena, 'yemi')
  await membersService.mute(yemi, 'xena')
  await deletion.request(xena, { channel: 'self_service' }, now)
  await deletion.erase(xena, days(14))

  const exported = (await new ExportService(db).export(yemi, 'yemi@example.test'))!
  assert.deepEqual(exported.posts.map((p) => [p.text, p.mentions]), [['thanks @xena', []]])
  assert.deepEqual(exported.likes.map((l) => l.postId), [hers])
  assert.deepEqual([exported.following, exported.followers, exported.muted], [[], [], []])
  const json = JSON.stringify(exported)
  for (const trace of ['Xena Okafor', 'I love jollof', 'my secret recipe', tombstoneHandle(xena)]) assert.ok(!json.includes(trace), trace)
})

test('the erase is safe to repeat after a failure at any step', async () => {
  for (const failure of ['address', 'sessions', 'files', 'email', 'identity'] as const) {
    const id = randomUUID()
    await db.insert(members).values({ id, handle: `m_${failure}` })
    const { id: postId } = await postsService.create(id, `post by ${failure}`)
    const picture = await image(id, 'post_image', postId)
    await deletion.request(id, { channel: 'self_service' }, now)

    if (failure === 'files') failFiles = true
    else if (failure === 'email') notices.failErased = true
    else kratos.failing.add(failure)
    await assert.rejects(deletion.erase(id, days(14)), failure)
    assert.equal((await member(id)).deletedAt, null, failure)
    assert.equal((await requestsOf(id))[0]!.status, 'in_progress', failure)

    failFiles = false
    notices.failErased = false
    kratos.failing.clear()
    assert.equal(await deletion.erase(id, days(14)), 'erased', failure)
    assert.equal(await deletion.erase(id, days(15)), 'already_erased', failure)

    const row = await member(id)
    assert.deepEqual([row.handle, row.deletedAt], [tombstoneHandle(id), days(14)], failure)
    assert.equal((await post(postId)).text, '', failure)
    assert.equal(store.keys('media').some((k) => k.includes(picture)), false, failure)
    assert.ok(kratos.deleted.has(id), failure)
    assert.equal((await requestsOf(id))[0]!.status, 'completed', failure)
    // Held once, whichever attempt got that far.
    assert.deepEqual((await db.select().from(releasedHandles).where(eq(releasedHandles.memberId, id))).map((h) => h.handle), [`m_${failure}`])
    // The last email went out, perhaps twice if the failure came after it.
    assert.ok(notices.erasedTo.includes(`${id}@example.test`), failure)
  }
})

test('an erased account is notified of nothing', async () => {
  await deletion.request(xena, { channel: 'self_service' }, now)
  await deletion.erase(xena, days(14))
  await notify(db, [
    { recipientId: xena, kind: 'report_resolved', detail: 'actioned' },
    { recipientId: yemi, kind: 'report_resolved', detail: 'actioned' },
  ])
  const told = await db.select({ recipientId: notifications.recipientId }).from(notifications)
  assert.deepEqual(told.map((n) => n.recipientId), [yemi])
})
