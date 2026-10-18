import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members, notifications, posts, reports } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { MembersService } from '../members/members.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { MENTIONS_NOTIFIED_MAX } from '../posts/mentions.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { NotificationsService } from './notifications.service.js'

const service = new NotificationsService(db)
const postsService = new PostsService(db)
const membersService = new MembersService(db)
const moderation = new ModerationService(db)

const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const sam = randomUUID() // site moderator

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada', displayName: 'Ada Obi' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
    { id: sam, handle: 'sam' },
  ])
  await moderation.setSiteModerator('sam', true)
})
after(() => pool.end())

const kinds = async (who: string) => (await service.list(who, 50)).notifications.map((n) => `${n.kind}:${n.actor?.handle ?? '-'}`)

test('replies, likes and follows notify the person they are about, newest first', async () => {
  const { id: post } = await postsService.create(ada, 'Jollof or fried rice?')
  await postsService.like(bayo, post)
  const { id: reply } = await postsService.create(bayo, 'Jollof, obviously', { replyTo: post })
  await membersService.follow(chi, 'ada')

  const page = await service.list(ada, 50)
  assert.deepEqual(
    page.notifications.map((n) => n.kind),
    ['follow', 'reply', 'like'],
  )
  const [follow, replied, liked] = page.notifications
  assert.deepEqual(follow!.actor, { handle: 'chi', displayName: null, avatar: null })
  assert.deepEqual(replied!.post, { id: reply, excerpt: 'Jollof, obviously' })
  assert.deepEqual(liked!.post, { id: post, excerpt: 'Jollof or fried rice?' })
  assert.equal(await service.unreadCount(ada), 3)
  // Nothing for the people who acted.
  assert.equal(await service.unreadCount(bayo), 0)
})

test('nobody is notified about their own likes and replies', async () => {
  const { id: post } = await postsService.create(ada, 'talking to myself')
  await postsService.like(ada, post)
  await postsService.create(ada, 'still me', { replyTo: post })
  assert.deepEqual(await kinds(ada), [])
})

test('liking again, or following again, notifies only once; taking it back hides it', async () => {
  const { id: post } = await postsService.create(ada, 'hello')
  await postsService.like(bayo, post)
  await postsService.unlike(bayo, post)
  assert.deepEqual(await kinds(ada), [])
  await postsService.like(bayo, post)
  await membersService.follow(bayo, 'ada')
  await membersService.unfollow(bayo, 'ada')
  await membersService.follow(bayo, 'ada')

  assert.deepEqual(await kinds(ada), ['follow:bayo', 'like:bayo'])
  assert.equal((await db.select().from(notifications)).length, 2)
})

test('reposting again notifies only once; taking the repost back hides it', async () => {
  const { id: post } = await postsService.create(ada, 'repost me')
  await postsService.repost(bayo, post)
  await postsService.unrepost(bayo, post)
  assert.deepEqual(await kinds(ada), [])
  await postsService.repost(bayo, post)
  await postsService.repost(bayo, post)
  await postsService.unrepost(bayo, post)
  await postsService.repost(bayo, post)
  await postsService.repost(ada, post)

  const [reposted] = (await service.list(ada, 50)).notifications
  assert.deepEqual(await kinds(ada), ['repost:bayo'])
  // Like a like: the excerpt is of your own post.
  assert.deepEqual(reposted!.post, { id: post, excerpt: 'repost me' })
  assert.equal((await db.select().from(notifications)).length, 1)

  // Gone with the post.
  await postsService.remove(ada, post)
  assert.deepEqual(await kinds(ada), [])
})

test('a quote notifies the quoted author with the quote itself, once even when it is also a reply', async () => {
  const { id: post } = await postsService.create(ada, 'quote me')
  const { id: quote } = await postsService.create(bayo, 'what she said', { quote: post })
  const [quoted] = (await service.list(ada, 50)).notifications
  assert.equal(quoted!.kind, 'quote')
  assert.deepEqual(quoted!.post, { id: quote, excerpt: 'what she said' })

  // Quoting the post you are replying to is one reply, not a reply and a quote.
  await postsService.create(chi, 'replying with it', { replyTo: post, quote: post })
  // Quoting yourself notifies nobody.
  await postsService.create(ada, 'me again', { quote: post })
  assert.deepEqual(await kinds(ada), ['reply:chi', 'quote:bayo'])

  // A deleted quote takes its notification with it; a muted quoter's is hidden.
  await postsService.remove(bayo, quote)
  assert.deepEqual(await kinds(ada), ['reply:chi'])
  await membersService.mute(ada, 'chi')
  assert.deepEqual(await kinds(ada), [])
})

test('notifications from someone blocked, muted or suspended disappear, and so do deleted replies', async () => {
  const { id: post } = await postsService.create(ada, 'hello')
  await postsService.like(bayo, post)
  await postsService.like(chi, post)
  const { id: reply } = await postsService.create(chi, 'hi', { replyTo: post })
  await membersService.follow(sam, 'ada')
  assert.equal(await service.unreadCount(ada), 4)

  await membersService.block(ada, 'bayo')
  await membersService.mute(ada, 'sam')
  await postsService.remove(chi, reply)
  assert.deepEqual(await kinds(ada), ['like:chi'])

  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.deepEqual(await kinds(ada), [])
  assert.equal(await service.unreadCount(ada), 0)
})

test('reading marks only what was seen; later ones stay unread', async () => {
  const { id: post } = await postsService.create(ada, 'hello')
  await postsService.like(bayo, post)
  const seen = (await service.list(ada, 50)).notifications[0]!.id
  await postsService.like(chi, post)

  await service.markRead(ada, seen)
  const page = await service.list(ada, 50)
  assert.deepEqual(
    page.notifications.map((n) => [n.actor!.handle, n.read]),
    [
      ['chi', false],
      ['bayo', true],
    ],
  )
  assert.equal(await service.unreadCount(ada), 1)
})

test('notifications page newest first with a cursor', async () => {
  const { id: post } = await postsService.create(ada, 'hello')
  for (const who of [bayo, chi, sam]) await postsService.like(who, post)
  const first = await service.list(ada, 2)
  assert.equal(first.notifications.length, 2)
  const second = await service.list(ada, 2, first.cursor!)
  assert.deepEqual(
    [...first.notifications, ...second.notifications].map((n) => n.actor!.handle),
    ['sam', 'chi', 'bayo'],
  )
  assert.equal(second.cursor, null)
})

test('a removed post tells its author why; the reporters hear the outcome; a restore is announced', async () => {
  const { id: post } = await postsService.create(bayo, 'buy my coin')
  await moderation.report(ada, { postId: post }, 'scam')
  await moderation.report(chi, { postId: post }, 'spam')
  const [report] = await db.select().from(reports).limit(1)
  await moderation.resolve(sam, report!.id, 'remove_post')

  const [removed] = (await service.list(bayo, 50)).notifications
  assert.equal(removed!.kind, 'post_removed')
  assert.equal(removed!.actor, null)
  assert.equal(removed!.post!.excerpt, 'buy my coin')
  assert.ok(['scam', 'spam'].includes(removed!.detail!))
  for (const reporter of [ada, chi]) {
    const [outcome] = (await service.list(reporter, 50)).notifications
    assert.deepEqual([outcome!.kind, outcome!.detail], ['report_resolved', 'actioned'])
  }

  await moderation.restorePost(sam, post)
  assert.deepEqual(await kinds(bayo), ['post_restored:-', 'post_removed:-'])
})

test('a dismissed report about an account says so; an accepted appeal reinstates with a notification', async () => {
  await moderation.report(ada, { handle: 'bayo' }, 'harassment')
  const [report] = await db.select().from(reports)
  await moderation.resolve(sam, report!.id, 'dismiss')
  const [outcome] = (await service.list(ada, 50)).notifications
  assert.deepEqual([outcome!.kind, outcome!.detail, outcome!.subjectHandle], ['report_resolved', 'dismissed', 'bayo'])

  await moderation.setSuspended(sam, 'bayo', true)
  assert.equal(await moderation.latestAppeal(bayo), null)
  await moderation.appeal(bayo, 'I was only joking with a friend')
  assert.equal((await moderation.latestAppeal(bayo))!.status, 'open')

  const [appeal] = await db.select().from(reports).where(eq(reports.reason, 'appeal'))
  await moderation.resolve(sam, appeal!.id, 'reinstate_member')
  assert.equal((await moderation.latestAppeal(bayo))!.status, 'actioned')
  // The appellant is told they are back, not that "their report" was handled.
  assert.deepEqual(await kinds(bayo), ['account_reinstated:-'])
})

test('a rejected appeal shows on the suspended account, not as a notification', async () => {
  await moderation.setSuspended(sam, 'bayo', true)
  await moderation.appeal(bayo, 'Please look again at this')
  const [appeal] = await db.select().from(reports).where(eq(reports.reason, 'appeal'))
  await moderation.resolve(sam, appeal!.id, 'dismiss')

  const latest = (await moderation.latestAppeal(bayo))!
  assert.equal(latest.status, 'dismissed')
  assert.ok(latest.resolvedAt)
  assert.deepEqual(await kinds(bayo), [])
})

test('a mention notifies the person mentioned once, with the post that mentions them', async () => {
  const { id } = await postsService.create(ada, 'Ask @bayo, @bayo knows suya')
  const [mention] = (await service.list(bayo, 50)).notifications
  assert.equal(mention!.kind, 'mention')
  assert.deepEqual(mention!.actor, { handle: 'ada', displayName: 'Ada Obi', avatar: null })
  assert.deepEqual(mention!.post, { id, excerpt: 'Ask @bayo, @bayo knows suya' })
  assert.deepEqual(await kinds(bayo), ['mention:ada'])
  assert.equal(await service.unreadCount(bayo), 1)
  // Nothing for the author, nor for a handle nobody has.
  assert.deepEqual(await kinds(ada), [])
})

test('mentioning yourself notifies nobody', async () => {
  await postsService.create(ada, 'note to self, @ada')
  assert.deepEqual(await kinds(ada), [])
  assert.equal((await db.select().from(notifications)).length, 0)
})

test('someone told of a reply or a quote is not told again that it mentions them', async () => {
  const { id: post } = await postsService.create(ada, 'Jollof or fried rice?')
  // A reply to ada that names ada and chi: ada hears of the reply, chi of the mention.
  await postsService.create(bayo, '@ada jollof, and @chi agrees', { replyTo: post })
  assert.deepEqual(await kinds(ada), ['reply:bayo'])
  assert.deepEqual(await kinds(chi), ['mention:bayo'])
  // A quote of ada's post that names her: one quote notification.
  await postsService.create(chi, '@ada asked the real question', { quote: post })
  assert.deepEqual(await kinds(ada), ['quote:chi', 'reply:bayo'])
})

test('blocking either way stops mention notifications; muting hides them', async () => {
  await membersService.block(bayo, 'ada')
  await membersService.block(ada, 'chi')
  await postsService.create(ada, 'hello @bayo and @chi and @sam')
  assert.deepEqual(await kinds(bayo), [])
  assert.deepEqual(await kinds(chi), [])
  assert.deepEqual(await kinds(sam), ['mention:ada'])
  // Not written at all, so lifting the block does not bring them back.
  await membersService.unblock(bayo, 'ada')
  assert.deepEqual(await kinds(bayo), [])

  await membersService.mute(sam, 'ada')
  assert.deepEqual(await kinds(sam), [])
  await membersService.unmute(sam, 'ada')
  assert.deepEqual(await kinds(sam), ['mention:ada'])
})

test('a mention in a post that is deleted or taken down disappears', async () => {
  const { id: deleted } = await postsService.create(ada, 'hi @bayo')
  const { id: removed } = await postsService.create(chi, 'hey @bayo')
  assert.deepEqual(await kinds(bayo), ['mention:chi', 'mention:ada'])
  await postsService.remove(ada, deleted)
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, removed))
  assert.deepEqual(await kinds(bayo), [])
  assert.equal(await service.unreadCount(bayo), 0)
})

test(`only the first ${MENTIONS_NOTIFIED_MAX} members a post names are notified; the rest are only linked`, async () => {
  const many = Array.from({ length: MENTIONS_NOTIFIED_MAX + 2 }, (_, i) => ({ id: randomUUID(), handle: `m${String(i).padStart(2, '0')}` }))
  await db.insert(members).values(many)
  // The author first, who does not count against the limit.
  const { id } = await postsService.create(ada, ['@ada', ...many.map((m) => `@${m.handle}`)].join(' '))
  const told = (await db.select().from(notifications)).map((n) => n.recipientId)
  assert.deepEqual(told.sort(), many.slice(0, MENTIONS_NOTIFIED_MAX).map((m) => m.id).sort())
  assert.equal((await postsService.post(null, id))!.mentions.length, many.length + 1)
})
