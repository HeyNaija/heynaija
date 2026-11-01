import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { media, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { GovernanceService } from '../governance/governance.service.js'
import { MembersService } from '../members/members.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { EXPORT_FORMAT, ExportService } from './export.service.js'

const service = new ExportService(db)
const postsService = new PostsService(db)
const membersService = new MembersService(db)
const moderation = new ModerationService(db)
const notificationsService = new NotificationsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada', displayName: 'Ada O.', bio: 'Lagos' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
})
after(() => pool.end())

test('an export holds what the member made and chose, by handle', async () => {
  const kept = await postsService.create(ada, 'kept')
  const gone = await postsService.create(ada, 'deleted later')
  await postsService.remove(ada, gone.id)
  const theirs = await postsService.create(bayo, 'by bayo')
  await postsService.like(ada, theirs.id)
  await postsService.repost(ada, theirs.id)
  const quote = await postsService.create(ada, 'quoting bayo', { quote: theirs.id })
  await postsService.bookmark(ada, theirs.id)
  await membersService.follow(ada, 'bayo')
  await membersService.follow(chi, 'ada')
  await membersService.mute(ada, 'chi')
  await moderation.report(ada, { postId: theirs.id }, 'spam', 'selling followers')

  const data = (await service.export(ada, 'ada@example.test'))!
  assert.equal(data.format, EXPORT_FORMAT)
  assert.deepEqual(
    { handle: data.account.handle, email: data.account.email, name: data.account.displayName, bio: data.account.bio },
    { handle: 'ada', email: 'ada@example.test', name: 'Ada O.', bio: 'Lagos' },
  )
  // Not through the welcome flow yet; once through, when.
  assert.equal(data.account.onboardedAt, null)
  const onboardedAt = new Date('2026-10-18T09:00:00Z')
  await db.update(members).set({ onboardedAt }).where(eq(members.id, ada))
  assert.deepEqual((await service.export(ada, null))!.account.onboardedAt, onboardedAt)
  // The post kept at the top of the profile, once there is one.
  assert.equal(data.account.pinnedPostId, null)
  await postsService.pinToProfile(ada, kept.id)
  assert.equal((await service.export(ada, null))!.account.pinnedPostId, kept.id)
  // Deleted posts are still held, so they are in the export, marked as deleted.
  assert.deepEqual(
    data.posts.map((p) => [p.id, p.text, p.deletedAt !== null, p.quoteOf]),
    [
      [kept.id, 'kept', false, null],
      [gone.id, 'deleted later', true, null],
      [quote.id, 'quoting bayo', false, theirs.id],
    ],
  )
  assert.deepEqual(data.likes.map((l) => l.postId), [theirs.id])
  assert.deepEqual(data.reposts.map((r) => r.postId), [theirs.id])
  assert.deepEqual(data.bookmarks.map((b) => b.postId), [theirs.id])
  assert.deepEqual(data.following.map((f) => f.handle), ['bayo'])
  assert.deepEqual(data.followers.map((f) => f.handle), ['chi'])
  assert.deepEqual(data.muted.map((m) => m.handle), ['chi'])
  assert.deepEqual(
    data.reportsYouMade.map((r) => [r.postId, r.reason, r.details]),
    [[theirs.id, 'spam', 'selling followers']],
  )
})

test('another member’s posts and reports about the member stay out', async () => {
  const theirs = await postsService.create(bayo, 'by bayo')
  const mine = await postsService.create(ada, 'mine')
  await moderation.report(bayo, { postId: mine.id }, 'harassment')

  const data = (await service.export(ada, null))!
  assert.deepEqual(data.posts.map((p) => p.id), [mine.id])
  assert.ok(!JSON.stringify(data).includes(theirs.id))
  assert.equal(data.reportsYouMade.length, 0)
  // Nothing in the export names who reported the member.
  assert.ok(!JSON.stringify(data).includes('bayo'))
})

test('each post lists the members it mentions, once each, by the handle they have now', async () => {
  const { id } = await postsService.create(ada, 'thanks @bayo, @chi and @bayo again')
  const plain = await postsService.create(ada, 'no one in particular')
  await db.update(members).set({ handle: 'bayo_new' }).where(eq(members.id, bayo))
  const data = (await service.export(ada, null))!
  assert.deepEqual(
    data.posts.map((p) => [p.id, p.mentions]),
    [
      [id, ['bayo_new', 'chi']],
      [plain.id, []],
    ],
  )
})

test('an export includes reply boundaries, polls the member created and their public ballots', async () => {
  const created = await postsService.create(ada, 'Choose a route', {
    replyAudience: 'following',
    poll: { multiple: true, options: ['Bus', 'Train', 'Walk'], expiresIn: 'never' },
  })
  const theirs = await postsService.create(bayo, 'Choose a meal', {
    poll: { multiple: false, options: ['Rice', 'Beans'], expiresIn: '7_days' },
  })
  const option = (await postsService.post(ada, theirs.id))!.poll!.options[1]!
  await postsService.votePoll(ada, theirs.id, [option.id])

  const data = (await service.export(ada, null))!
  const post = data.posts.find((row) => row.id === created.id)!
  assert.equal(post.replyAudience, 'following')
  assert.deepEqual(post.poll?.options.map((choice) => choice.text), ['Bus', 'Train', 'Walk'])
  assert.equal(post.poll?.multiple, true)
  assert.equal(post.poll?.expiresAt, null)
  assert.deepEqual(data.pollVotes.map((vote) => [vote.postId, vote.optionId, vote.option]), [[theirs.id, option.id, 'Beans']])
})

test('an export says which kinds of activity the member is notified about', async () => {
  const allOn = { reply: true, like: true, repost: true, quote: true, mention: true, follow: true }
  assert.deepEqual((await service.export(ada, null))!.notificationPreferences, allOn)
  await notificationsService.setPreferences(ada, { like: false, follow: false })
  assert.deepEqual((await service.export(ada, null))!.notificationPreferences, { ...allOn, like: false, follow: false })
  // Only their own choices.
  assert.deepEqual((await service.export(bayo, null))!.notificationPreferences, allOn)
})

test('an export says whether notifications are also emailed', async () => {
  assert.equal((await service.export(ada, null))!.emailNotifications, true)
  await notificationsService.setPreferences(ada, { email: false })
  assert.equal((await service.export(ada, null))!.emailNotifications, false)
  assert.equal((await service.export(bayo, null))!.emailNotifications, true)
})

test('an unknown member has no export', async () => {
  assert.equal(await service.export(randomUUID(), null), null)
})

test('an export includes the age confirmation and verification history, but never the person key', async () => {
  const locked = { NIN_VERIFICATION_ENABLED: false, BINDING_GOVERNANCE_VOTING_ENABLED: false, UNDER_18_ACCOUNTS_ENABLED: false }
  const approved = new GovernanceService(db, { ...locked, NIN_VERIFICATION_ENABLED: true, IDENTITY_KEY_SECRET: 'k'.repeat(32) })

  const before = (await service.export(ada, null))!
  assert.deepEqual(before.age, [])
  assert.deepEqual(before.identityVerifications, [])
  assert.equal(before.votingMembership, null)

  await approved.recordAgeDeclaration(ada)
  await approved.recordVerification(
    ada,
    { provider: 'ninauth', subject: 'person-ada', over18: true, verifiedAt: new Date(), expiresAt: null },
    { version: 'consent-1', at: new Date() },
  )
  const data = (await service.export(ada, null))!
  assert.deepEqual(
    data.age.map((a) => [a.band, a.method]),
    [
      ['18_plus', 'self_declared'],
      ['18_plus', 'identity_provider'],
    ],
  )
  assert.deepEqual(data.identityVerifications.map((v) => v.status), ['verified'])
  const text = JSON.stringify(data)
  assert.equal(text.includes('personKey'), false)
  assert.equal(text.includes('person-ada'), false)
})

test('an export lists a post’s ready video (path and poster); held, unattached and others’ videos stay out', async () => {
  const withVideo = await postsService.create(ada, 'my clip')
  const plain = await postsService.create(ada, 'no clip')
  const other = await postsService.create(bayo, 'theirs')
  const row = (ownerId: string, status: typeof media.$inferInsert['status'], postId: string | null) =>
    db.insert(media).values({ ownerId, kind: 'post_video', status, contentType: 'video/mp4', bytes: 1, postId, position: postId ? 0 : null }).returning({ id: media.id }).then((r) => r[0]!.id)
  const ready = await row(ada, 'ready', withVideo.id)
  await row(ada, 'quarantined', plain.id)
  await row(ada, 'ready', null)
  await row(bayo, 'ready', other.id)

  const data = (await service.export(ada, null))!
  assert.equal(data.format, 'heynaija-export/12')
  const byText = (text: string) => data.posts.find((p) => p.text === text)!
  assert.deepEqual(byText('my clip').videos, [{ url: `/media/videos/${ready}`, poster: `/media/videos/${ready}/poster.webp` }])
  assert.deepEqual(byText('no clip').videos, [])
})
