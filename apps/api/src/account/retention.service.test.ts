import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { governanceAuditLog, ideas, members, pollOptions, pollVotes, postHashtags, postMentions, postPolls, posts, privacyRequests, problemDetails, releasedHandles, reports } from '@heynaija/db'
import { asc, eq, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { ModerationService } from '../moderation/moderation.service.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { RetentionService } from './retention.service.js'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-10-30T09:00:00Z')
const days = (n: number) => new Date(now.getTime() + n * DAY)

const postsService = new PostsService(db)
const moderation = new ModerationService(db)
// The defaults /privacy#keep states: 90 days for deleted posts, two years for the rest.
const sweep = (retentionDays = 90) =>
  new RetentionService(db, { DELETED_CONTENT_RETENTION_DAYS: retentionDays, ERASED_AGE_RECORD_RETENTION_DAYS: 730, PRIVACY_REQUEST_RETENTION_DAYS: 730 }).sweep(now)
const nothingElse = { handles: 0, ageRecords: 0, requests: 0 }

const ada = randomUUID()
const bola = randomUUID()
const erased = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bola, handle: 'bola' },
    { id: erased, handle: 'deleted-0a1b2c3d', active: false, deletionRequestedAt: days(-100), deletionScheduledFor: days(-86), deletedAt: days(-86) },
  ])
})
after(() => pool.end())

const post = async (id: string) => (await db.select().from(posts).where(eq(posts.id, id)))[0]!
const deletedDaysAgo = (id: string, n: number) => db.update(posts).set({ deletedAt: days(-n) }).where(eq(posts.id, id))
const countFor = async (table: PgTable, column: PgColumn, id: string) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(column, id)))[0]!.n

test('a deleted post keeps its text for the whole period, 90 days by default', async () => {
  const { id } = await postsService.create(ada, 'old news #lagos')
  await deletedDaysAgo(id, 89)
  assert.deepEqual(await sweep(), { posts: 0, ...nothingElse })
  assert.equal((await post(id)).text, 'old news #lagos')
  assert.equal(await countFor(postHashtags, postHashtags.postId, id), 1)
})

test('once the period is over a deleted post is blanked, unless a report about it is still open', async () => {
  const { id: original } = await postsService.create(bola, 'the original')
  const { id: old } = await postsService.create(ada, 'hi @bola #jollof see https://example.com/x', { quote: original })
  const { id: idea } = await postsService.create(ada, 'Dark mode\n\nplease')
  await db.insert(ideas).values({ postId: idea, kind: 'problem', title: 'Dark mode' })
  await db.insert(problemDetails).values({ postId: idea, page: '/settings', browser: 'Firefox', appVersion: 'abc123' })
  const { id: recent } = await postsService.create(ada, 'deleted last week')
  const { id: live } = await postsService.create(ada, 'still up')
  const { id: underReview } = await postsService.create(ada, 'reported, not decided')
  const { id: settled } = await postsService.create(ada, 'reported, dismissed')
  await moderation.report(bola, { postId: underReview }, 'spam')
  await moderation.report(bola, { postId: settled }, 'spam')
  await db.update(reports).set({ status: 'dismissed', resolvedAt: days(-32) }).where(eq(reports.postId, settled))
  for (const id of [old, idea, underReview, settled]) await deletedDaysAgo(id, 31)
  await deletedDaysAgo(recent, 7)
  assert.deepEqual([await countFor(postMentions, postMentions.postId, old), await countFor(postHashtags, postHashtags.postId, old)], [1, 1])

  assert.deepEqual(await sweep(30), { posts: 3, ...nothingElse })

  const blanked = await post(old)
  assert.deepEqual([blanked.text, blanked.linkUrl, blanked.quotePostId], ['', null, null])
  assert.deepEqual([await countFor(postMentions, postMentions.postId, old), await countFor(postHashtags, postHashtags.postId, old)], [0, 0])
  assert.equal((await post(idea)).text, '')
  assert.equal((await db.select().from(ideas).where(eq(ideas.postId, idea)))[0]!.title, '')
  assert.equal(await countFor(problemDetails, problemDetails.postId, idea), 0)
  assert.equal((await post(settled)).text, '')
  // Kept: a report about it is open, it was deleted too lately, or it was not deleted.
  assert.equal((await post(underReview)).text, 'reported, not decided')
  assert.equal((await post(recent)).text, 'deleted last week')
  assert.equal((await post(live)).text, 'still up')
  assert.equal((await post(original)).text, 'the original')

  assert.deepEqual(await sweep(30), { posts: 0, ...nothingElse }, 'nothing is left to blank')
})

test("an erased account's handles are let go once their hold is over; other members' are left alone", async () => {
  await db.insert(releasedHandles).values([
    { handle: 'was_erased', memberId: erased, releasedAt: days(-31) },
    { handle: 'still_held', memberId: erased, releasedAt: days(-29) },
    { handle: 'ada_before', memberId: ada, releasedAt: days(-400) },
  ])
  assert.deepEqual(await sweep(), { posts: 0, ...nothingElse, handles: 1 })
  const left = await db.select({ handle: releasedHandles.handle }).from(releasedHandles).orderBy(asc(releasedHandles.handle))
  assert.deepEqual(left.map((r) => r.handle), ['ada_before', 'still_held'])
})

test('the poll of an expired deleted post goes with its text, unless a report about the post is open', async () => {
  const withPoll = async (text: string) => {
    const { id } = await postsService.create(ada, text)
    await db.insert(postPolls).values({ postId: id })
    const [option] = await db.insert(pollOptions).values({ postId: id, position: 0, text: 'yes' }).returning({ id: pollOptions.id })
    await db.insert(pollVotes).values({ postId: id, optionId: option!.id, memberId: bola })
    return id
  }
  const expired = await withPoll('which one?')
  const underReview = await withPoll('which one, reported?')
  const recent = await withPoll('which one, lately?')
  await moderation.report(bola, { postId: underReview }, 'spam')
  await deletedDaysAgo(expired, 31)
  await deletedDaysAgo(underReview, 31)
  await deletedDaysAgo(recent, 7)

  await sweep(30)

  assert.deepEqual([await countFor(postPolls, postPolls.postId, expired), await countFor(pollOptions, pollOptions.postId, expired), await countFor(pollVotes, pollVotes.postId, expired)], [0, 0, 0])
  for (const id of [underReview, recent]) {
    assert.deepEqual([await countFor(postPolls, postPolls.postId, id), await countFor(pollOptions, pollOptions.postId, id), await countFor(pollVotes, pollVotes.postId, id)], [1, 1, 1], id)
  }
})

test("an erased account's age audit trail is kept two years after the erase, then deleted; a live member's stays", async () => {
  const longAgo = randomUUID()
  await db.insert(members).values({
    id: longAgo,
    handle: 'deleted-9f8e7d6c',
    active: false,
    deletionRequestedAt: days(-750),
    deletionScheduledFor: days(-736),
    deletedAt: days(-731),
  })
  await db.insert(governanceAuditLog).values([
    { subjectId: longAgo, event: 'age_declared', reason: '18_plus', createdAt: days(-900) },
    { subjectId: erased, event: 'age_declared', reason: '18_plus', createdAt: days(-400) },
    { subjectId: ada, event: 'age_declared', reason: '18_plus', createdAt: days(-2000) },
  ])
  assert.deepEqual(await sweep(), { posts: 0, ...nothingElse, ageRecords: 1 })
  const left = await db.select({ subjectId: governanceAuditLog.subjectId }).from(governanceAuditLog)
  assert.deepEqual(left.map((r) => r.subjectId).sort(), [ada, erased].sort())
})

test('a privacy request is kept two years after it was closed; open ones stay however old', async () => {
  const request = (status: 'completed' | 'refused' | 'in_progress', closedDaysAgo: number | null) => ({
    memberId: ada,
    kind: 'access' as const,
    channel: 'email' as const,
    status,
    receivedAt: days(-1000),
    dueBy: days(-970),
    closedAt: closedDaysAgo === null ? null : days(-closedDaysAgo),
  })
  await db.insert(privacyRequests).values([request('completed', 731), request('refused', 729), request('in_progress', null)])
  assert.deepEqual(await sweep(), { posts: 0, ...nothingElse, requests: 1 })
  const left = await db.select({ status: privacyRequests.status }).from(privacyRequests)
  assert.deepEqual(left.map((r) => r.status).sort(), ['in_progress', 'refused'])
})
