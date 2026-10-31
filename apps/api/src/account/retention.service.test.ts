import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ideas, members, pollOptions, pollVotes, postHashtags, postMentions, postPolls, posts, problemDetails, releasedHandles, reports } from '@heynaija/db'
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
const sweep = (retentionDays?: number) => new RetentionService(db, { DELETED_CONTENT_RETENTION_DAYS: retentionDays }).sweep(now)

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

test('with no period set, a deleted post keeps its text however old it is', async () => {
  const { id } = await postsService.create(ada, 'old news #lagos')
  await deletedDaysAgo(id, 1000)
  assert.deepEqual(await sweep(undefined), { posts: 0, handles: 0 })
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

  assert.deepEqual(await sweep(30), { posts: 3, handles: 0 })

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

  assert.deepEqual(await sweep(30), { posts: 0, handles: 0 }, 'nothing is left to blank')
})

test("an erased account's handles are let go once their hold is over; other members' are left alone", async () => {
  await db.insert(releasedHandles).values([
    { handle: 'was_erased', memberId: erased, releasedAt: days(-31) },
    { handle: 'still_held', memberId: erased, releasedAt: days(-29) },
    { handle: 'ada_before', memberId: ada, releasedAt: days(-400) },
  ])
  assert.deepEqual(await sweep(undefined), { posts: 0, handles: 1 })
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
