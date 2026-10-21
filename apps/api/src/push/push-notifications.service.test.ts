import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members, notifications, pushSubscriptions, reports } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'
import { MembersService } from '../members/members.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { type PushJobs, PushNotificationsService } from './push-notifications.service.js'
import { PermanentPushError, type PushMessage, type PushSender, type PushTarget, SubscriptionGoneError } from './push-sender.js'

class Jobs implements PushJobs {
  queued: string[] = []
  async push(memberId: string) {
    this.queued.push(memberId)
  }
}

/** Push services that keep what they are sent, or fail for the addresses told to. */
class PushServices implements PushSender {
  readonly publicKey = `B${'k'.repeat(86)}`
  sent: { endpoint: string; message: PushMessage }[] = []
  failing = new Map<string, Error>()
  async send(target: PushTarget, message: PushMessage) {
    const error = this.failing.get(target.endpoint)
    if (error) throw error
    this.sent.push({ endpoint: target.endpoint, message })
  }
  /** What one browser was sent. */
  to(endpoint: string) {
    return this.sent.filter((s) => s.endpoint === endpoint).map((s) => s.message)
  }
}

let jobs: Jobs
let services: PushServices
let push: PushNotificationsService
const notificationsService = new NotificationsService(db)
const postsService = new PostsService(db)
const membersService = new MembersService(db)
const moderation = new ModerationService(db)

const [ada, bayo, chi, dayo, sam] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const handles = new Map<string, string>([[ada, 'ada'], [bayo, 'bayo'], [chi, 'chi'], [dayo, 'dayo'], [sam, 'sam']])

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([...handles].map(([id, handle]) => ({ id, handle })))
  await moderation.setSiteModerator('sam', true)
  jobs = new Jobs()
  services = new PushServices()
  push = new PushNotificationsService(db, jobs, services)
})
after(() => pool.end())

/** A browser of `memberId`'s, subscribed. Returns its address. */
async function browser(memberId: string, name = 'phone') {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${handles.get(memberId) ?? memberId}-${name}`
  await push.subscribe(memberId, { endpoint, p256dh: `p256dh-${name}`, auth: `auth-${name}` })
  return endpoint
}

/** What a sweep a few seconds later, and the jobs it queues, do. */
async function deliver() {
  jobs.queued = []
  await push.sweep()
  for (const id of [...jobs.queued]) await push.send(id)
}

const state = async (memberId: string) =>
  (
    await db
      .select({ settled: notifications.pushSettledAt, pushed: notifications.pushedAt })
      .from(notifications)
      .where(eq(notifications.recipientId, memberId))
  ).map((r) => (r.pushed ? 'pushed' : r.settled ? 'passed over' : 'waiting'))

const age = (memberId: string, minutes: number) =>
  db.execute(sql`update notifications set created_at = created_at - make_interval(mins => ${minutes}) where recipient_id = ${memberId}`)

test('a reply is pushed at once to each of the member’s browsers, in the email’s words, and only once', async () => {
  const phone = await browser(ada)
  const laptop = await browser(ada, 'laptop')
  const { id: post } = await postsService.create(ada, 'Jollof or fried rice?')
  const { id: reply } = await postsService.create(bayo, 'Jollof, obviously', { replyTo: post })

  // No waiting for company, as email does.
  await deliver()
  const expected = { title: '@bayo replied to your post', body: '“Jollof, obviously”', url: `/p/${reply}`, tag: `reply:${reply}` }
  assert.deepEqual(services.to(phone), [expected])
  assert.deepEqual(services.to(laptop), [expected])
  // Nobody else has a browser, or anything waiting.
  assert.deepEqual(jobs.queued, [ada])
  assert.deepEqual(await state(ada), ['pushed'])
  const [row] = await db.select({ at: pushSubscriptions.lastPushedAt }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, phone))
  assert.ok(row?.at)

  await deliver()
  assert.equal(services.sent.length, 2)
  assert.deepEqual(jobs.queued, [])
})

test('a member with no browser is passed over at once, so that email need not wait for them', async () => {
  await browser(ada)
  await membersService.follow(bayo, 'chi')
  await deliver()
  assert.deepEqual(jobs.queued, [])
  assert.equal(services.sent.length, 0)
  assert.deepEqual(await state(chi), ['passed over'])
})

test('a like is counted in with the likes already pushed, and replaces that notification on the device', async () => {
  const phone = await browser(ada)
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await deliver()
  await postsService.like(chi, post)
  await deliver()
  assert.deepEqual(
    services.to(phone).map((m) => [m.title, m.tag]),
    [
      ['@bayo liked your post', `like:${post}`],
      ['@chi and @bayo liked your post', `like:${post}`],
    ],
  )
  // A like already read is not counted in again.
  const [newest] = (await notificationsService.list(ada, 10)).notifications
  await notificationsService.markRead(ada, newest!.id)
  await postsService.like(dayo, post)
  await deliver()
  assert.equal(services.to(phone).at(-1)!.title, '@dayo liked your post')
})

test('several things at once are a push each, oldest first; more than three are one push that says how many', async () => {
  const phone = await browser(ada)
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.create(bayo, 'first', { replyTo: post })
  await membersService.follow(chi, 'ada')
  await deliver()
  assert.deepEqual(services.to(phone).map((m) => m.title), ['@bayo replied to your post', '@chi followed you'])
  assert.equal(services.to(phone)[1]!.url, '/u/chi')

  services.sent = []
  await postsService.create(chi, 'second', { replyTo: post })
  await postsService.create(dayo, 'Have you seen this, @ada?')
  await postsService.like(bayo, post)
  await postsService.create(dayo, 'third', { replyTo: post })
  await deliver()
  assert.deepEqual(services.to(phone), [{ title: '4 new notifications', body: 'See them in HeyNaija.', url: '/notifications', tag: 'many' }])
  // All four were told about, so none of them is emailed.
  assert.ok((await state(ada)).every((s) => s === 'pushed'))
})

test('moderator decisions are pushed in general words, with no post text and no reason', async () => {
  const phone = await browser(bayo)
  const { id: post } = await postsService.create(bayo, 'buy my coin')
  await moderation.report(ada, { postId: post }, 'scam')
  const [report] = await db.select().from(reports)
  await moderation.resolve(sam, report!.id, 'remove_post')
  await deliver()
  assert.deepEqual(services.to(phone), [
    { title: 'A moderator removed one of your posts', body: '', url: '/notifications', tag: 'post_removed' },
  ])
})

test('what is read, from someone blocked or muted, or about a post taken down is not pushed; the rest is', async () => {
  const phone = await browser(ada)
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.create(bayo, 'words from someone I will block', { replyTo: post })
  await postsService.create(chi, 'words from someone I will mute', { replyTo: post })
  const { id: gone } = await postsService.create(dayo, 'words I took back', { replyTo: post })
  await postsService.remove(dayo, gone)
  await membersService.block(ada, 'bayo')
  await membersService.mute(ada, 'chi')
  await deliver()
  assert.equal(services.sent.length, 0)
  assert.deepEqual(await state(ada), ['passed over', 'passed over', 'passed over'])

  await postsService.like(dayo, post)
  const [seen] = (await notificationsService.list(ada, 10)).notifications
  await notificationsService.markRead(ada, seen!.id)
  await postsService.create(dayo, 'words that stand', { replyTo: post })
  await deliver()
  assert.deepEqual(services.to(phone).map((m) => m.title), ['@dayo replied to your post'])
})

test('a suspended member is not pushed to', async () => {
  await browser(ada)
  const { id: post } = await postsService.create(ada, 'my post')
  await moderation.setSuspended(sam, 'ada', true)
  await postsService.like(bayo, post)
  await deliver()
  assert.equal(services.sent.length, 0)
  assert.ok((await state(ada)).every((s) => s === 'passed over'))
})

test('a notification that could not go out within ten minutes is left to email', async () => {
  await browser(ada)
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada, 11)
  await deliver()
  assert.equal(services.sent.length, 0)
  assert.deepEqual(jobs.queued, [])
  assert.deepEqual(await state(ada), ['passed over'])
})

test('a browser its push service no longer knows is forgotten, and the member’s other browsers still get the push', async () => {
  const phone = await browser(ada)
  const old = await browser(ada, 'old')
  services.failing.set(old, new SubscriptionGoneError('push service answered 410'))
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await deliver()
  assert.equal(services.to(phone).length, 1)
  assert.deepEqual(
    (await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions)).map((r) => r.endpoint),
    [phone],
  )
  assert.deepEqual(await state(ada), ['pushed'])
})

test('a push service that is briefly away means a retry; one that refuses for good means email instead', async () => {
  const phone = await browser(ada)
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)

  services.failing.set(phone, new Error('push service answered 503'))
  jobs.queued = []
  await push.sweep()
  await assert.rejects(push.send(ada), /503/)
  assert.deepEqual(await state(ada), ['waiting'])
  services.failing.delete(phone)
  await push.send(ada)
  assert.equal(services.to(phone).length, 1)
  assert.deepEqual(await state(ada), ['pushed'])

  services.failing.set(phone, new PermanentPushError('push service answered 403'))
  await postsService.like(chi, post)
  await deliver()
  assert.equal(services.to(phone).length, 1)
  assert.deepEqual((await state(ada)).sort(), ['passed over', 'pushed'])
  // Refusing is not the same as not knowing the browser: it is kept.
  assert.equal((await db.select().from(pushSubscriptions)).length, 1)
})

test('without push keys nothing is pushed, nothing is settled, and browsers are not offered it', async () => {
  const off = new PushNotificationsService(db, jobs)
  assert.equal(off.enabled, false)
  assert.equal(off.publicKey, null)
  await browser(ada)
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  assert.equal(await off.send(ada), 0)
  assert.deepEqual(await state(ada), ['waiting'])
  assert.equal(push.publicKey, services.publicKey)
})

test('a browser has one subscription, which moves to whoever turns push on in it', async () => {
  const shared = 'https://fcm.googleapis.com/fcm/send/shared-phone'
  const first = await push.subscribe(ada, { endpoint: shared, p256dh: 'a', auth: 'a' })
  assert.equal(await push.isSubscribed(ada, shared), true)
  const second = await push.subscribe(bayo, { endpoint: shared, p256dh: 'b', auth: 'b' })
  assert.equal(second, first)
  assert.equal(await push.isSubscribed(bayo, shared), true)

  // ada's notifications no longer go there; bayo's do.
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(chi, post)
  const { id: theirs } = await postsService.create(bayo, 'their post')
  await postsService.like(chi, theirs)
  await deliver()
  assert.deepEqual(services.to(shared).map((m) => m.tag), [`like:${theirs}`])
})

test('a browser signed in as someone else stops getting the earlier member’s pushes as soon as it checks', async () => {
  const shared = await browser(ada, 'shared')
  // ada's session ran out without signing out, and bayo signed in here.
  assert.equal(await push.isSubscribed(bayo, shared), false)
  assert.equal(await push.isSubscribed(ada, shared), false)
  assert.equal((await db.select().from(pushSubscriptions)).length, 0)
})

test('signing out removes that browser’s subscription, and only if it is still the member’s', async () => {
  const id = await push.subscribe(ada, { endpoint: 'https://web.push.apple.com/ada-iphone', p256dh: 'a', auth: 'a' })
  await push.remove(bayo, id)
  assert.equal((await db.select().from(pushSubscriptions)).length, 1)
  await push.remove(ada, id)
  assert.equal((await db.select().from(pushSubscriptions)).length, 0)
  // Turning it off in Settings goes by the address.
  const other = await browser(ada, 'firefox')
  await push.unsubscribe(other)
  assert.equal(await push.isSubscribed(ada, other), false)
})

test('a browser given a new address keeps its subscription, and its ID, under the new one', async () => {
  const before = await push.subscribe(ada, { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/old', p256dh: 'a', auth: 'a' })
  const fresh = 'https://updates.push.services.mozilla.com/wpush/v2/new'
  const after = await push.subscribe(ada, { endpoint: fresh, p256dh: 'b', auth: 'b' }, 'https://updates.push.services.mozilla.com/wpush/v2/old')
  assert.equal(after, before)
  const rows = await db.select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh }).from(pushSubscriptions)
  assert.deepEqual(rows, [{ endpoint: fresh, p256dh: 'b' }])
})
