import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members, notifications, reports } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'
import { MembersService } from '../members/members.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import type { EmailAddresses } from './addresses.js'
import { EmailNotificationsService, type EmailJobs, type EmailSettings } from './email-notifications.service.js'
import { type Mail, type Mailer, PermanentMailError } from './mailer.js'
import { unsubscribeKey } from './unsubscribe-token.js'

const settings: EmailSettings = {
  webUrl: 'https://heynaija.test',
  unsubscribeKey: unsubscribeKey('s'.repeat(32)),
  delayS: 300,
  gapS: 1800,
  waitForPush: false,
}

class Jobs implements EmailJobs {
  queued: string[] = []
  async sendDigest(memberId: string) {
    this.queued.push(memberId)
  }
}

class Outbox implements Mailer {
  sent: Mail[] = []
  failWith: Error | null = null
  async send(mail: Mail) {
    if (this.failWith) throw this.failWith
    this.sent.push(mail)
  }
}

class Directory implements EmailAddresses {
  byId = new Map<string, string | null>()
  failWith: Error | null = null
  async addressFor(memberId: string) {
    if (this.failWith) throw this.failWith
    return this.byId.get(memberId) ?? null
  }
}

let jobs: Jobs
let outbox: Outbox
let directory: Directory
let email: EmailNotificationsService
const notificationsService = new NotificationsService(db)
const postsService = new PostsService(db)
const membersService = new MembersService(db)
const moderation = new ModerationService(db)

const [ada, bayo, chi, dayo, sam] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const handles = new Map([[ada, 'ada'], [bayo, 'bayo'], [chi, 'chi'], [dayo, 'dayo'], [sam, 'sam']])

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([...handles].map(([id, handle]) => ({ id, handle })))
  await moderation.setSiteModerator('sam', true)
  jobs = new Jobs()
  outbox = new Outbox()
  directory = new Directory()
  for (const [id, handle] of handles) directory.byId.set(id, `${handle}@example.test`)
  email = new EmailNotificationsService(db, jobs, settings, outbox, directory)
})
after(() => pool.end())

/** Makes what has happened so far old enough to be emailed. */
const age = (memberId: string, minutes = 10) =>
  db.execute(sql`update notifications set created_at = created_at - make_interval(mins => ${minutes}) where recipient_id = ${memberId}`)

/** What a minute's sweep and the jobs it queues do. */
async function deliver() {
  jobs.queued = []
  await email.sweep()
  for (const id of [...jobs.queued]) await email.sendDigest(id)
}

const settled = async (memberId: string) =>
  (await db.select({ at: notifications.emailSettledAt }).from(notifications).where(eq(notifications.recipientId, memberId))).map((r) => r.at !== null)

const newMember = async (handle: string) => {
  const id = randomUUID()
  await db.insert(members).values({ id, handle })
  directory.byId.set(id, `${handle}@example.test`)
  return id
}

test('a reply is emailed once it has waited, to that member and nobody else, and only once', async () => {
  const { id: post } = await postsService.create(ada, 'Jollof or fried rice?')
  const { id: reply } = await postsService.create(bayo, 'Jollof, obviously', { replyTo: post })

  // Nothing yet: it may be followed by more.
  await deliver()
  assert.equal(outbox.sent.length, 0)

  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 1)
  const [mail] = outbox.sent
  assert.equal(mail!.to, 'ada@example.test')
  assert.equal(mail!.subject, '@bayo replied to your post')
  assert.match(mail!.text, /“Jollof, obviously”/)
  assert.ok(mail!.text.includes(`https://heynaija.test/p/${reply}`))
  assert.match(mail!.unsubscribeUrl, /^https:\/\/heynaija\.test\/api\/v1\/email\/unsubscribe\/[0-9a-f-]{36}\.[\w-]+$/)
  assert.ok(mail!.text.includes(mail!.unsubscribeUrl))
  assert.ok(mail!.html.includes(mail!.unsubscribeUrl))
  // Nobody else has anything waiting, so nobody else is written to.
  assert.deepEqual(jobs.queued, [ada])

  // What was sent is settled and not sent again, and the time is noted.
  assert.deepEqual(await settled(ada), [true])
  await deliver()
  assert.equal(outbox.sent.length, 1)
  const [row] = await db.select({ at: members.lastNotificationEmailAt }).from(members).where(eq(members.id, ada))
  assert.ok(row!.at)
})

test('the notification itself never waits on email: it is in the app straight away', async () => {
  const { id: post } = await postsService.create(ada, 'hello')
  await postsService.like(bayo, post)
  assert.equal(await notificationsService.unreadCount(ada), 1)
  assert.equal(outbox.sent.length, 0)
})

test('a burst of likes is one email, with the likers rolled into one line', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  for (let i = 0; i < 30; i++) await postsService.like(await newMember(`fan${i}`), post)
  await age(ada)
  await deliver()

  assert.equal(outbox.sent.length, 1)
  const [mail] = outbox.sent
  assert.equal(mail!.subject, '30 new notifications on HeyNaija')
  assert.equal(mail!.text.match(/liked your post/g)?.length, 1)
  assert.match(mail!.text, / and 28 others liked your post/)
  assert.ok((await settled(ada)).every(Boolean))
  assert.equal((await settled(ada)).length, 30)
})

test('everything waiting when the email is written goes in it, even what arrived after it was asked for', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada)
  await email.sweep()
  await postsService.like(chi, post)
  await email.sendDigest(ada)
  assert.equal(outbox.sent.length, 1)
  assert.match(outbox.sent[0]!.text, /@chi and @bayo liked your post/)
  assert.deepEqual(await settled(ada), [true, true])
})

test('at least a while passes between two emails to the same member', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 1)

  await postsService.like(chi, post)
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 1, 'too soon after the last one')
  assert.deepEqual(await settled(ada), [true, false])

  await db.update(members).set({ lastNotificationEmailAt: new Date(Date.now() - 31 * 60_000) }).where(eq(members.id, ada))
  await deliver()
  assert.equal(outbox.sent.length, 2)
  assert.equal(outbox.sent[1]!.subject, '@chi liked your post')
})

test('a member with email off is not emailed, and turning it on later does not send what was missed', async () => {
  await notificationsService.setPreferences(ada, { email: false })
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(jobs.queued, [])
  // The in-app notification is untouched.
  assert.equal(await notificationsService.unreadCount(ada), 1)

  await notificationsService.setPreferences(ada, { email: true })
  await deliver()
  assert.equal(outbox.sent.length, 0, 'only what happens from now on')
  await postsService.like(chi, post)
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 1)
  assert.equal(outbox.sent[0]!.subject, '@chi liked your post')
})

test('email turned off after the notification, before the email, still wins', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada)
  await email.sweep()
  await notificationsService.setPreferences(ada, { email: false })
  await email.sendDigest(ada)
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(await settled(ada), [true])
})

test('a kind switched off means no notification and so no email; one switched off after the fact is not emailed either', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await notificationsService.setPreferences(ada, { like: false })
  await postsService.like(bayo, post)
  await postsService.create(chi, 'a reply', { replyTo: post })
  await postsService.create(dayo, 'another reply', { replyTo: post })
  await age(ada)
  // Turned off between the notification and the email.
  await email.sweep()
  await notificationsService.setPreferences(ada, { reply: false })
  await email.sendDigest(ada)
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(await settled(ada), [true, true])
})

test('someone blocked, muted or suspended, a taken-back like and a removed post are left out; the rest is emailed', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  const eve = await newMember('eve')
  const fay = await newMember('fay')
  await postsService.create(bayo, 'words from someone I will block', { replyTo: post })
  await postsService.create(chi, 'words from someone I will mute', { replyTo: post })
  await postsService.like(dayo, post)
  await postsService.like(eve, post)
  await postsService.unlike(eve, post)
  const { id: gone } = await postsService.create(fay, 'words I took back', { replyTo: post })
  await postsService.remove(fay, gone)
  const hank = await newMember('hank')
  const { id: taken } = await postsService.create(hank, 'words a moderator removed', { replyTo: post })
  await moderation.report(chi, { postId: taken }, 'spam')
  const [report] = await db.select().from(reports).where(eq(reports.postId, taken))
  await moderation.resolve(sam, report!.id, 'remove_post')
  await postsService.create(await newMember('gus'), 'words that stand', { replyTo: post })

  await membersService.block(ada, 'bayo')
  await membersService.mute(ada, 'chi')
  await db.update(members).set({ active: false }).where(eq(members.id, dayo))
  await age(ada)
  await deliver()

  assert.equal(outbox.sent.length, 1)
  const [mail] = outbox.sent
  assert.equal(mail!.subject, '@gus replied to your post')
  const everything = mail!.text + mail!.html
  for (const hidden of ['@bayo', '@chi', '@dayo', '@eve', '@fay', '@hank', 'someone I will block', 'someone I will mute', 'took back', 'moderator removed']) {
    assert.ok(!everything.includes(hidden), `${hidden} is not in the email`)
  }
  assert.ok((await settled(ada)).every(Boolean))
})

test('when nothing is left worth saying, no email goes out at all', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await postsService.create(chi, 'hello', { replyTo: post })
  await membersService.block(ada, 'bayo')
  await membersService.block(ada, 'chi')
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(await settled(ada), [true, true])
})

test('a suspended member is not emailed, and being reinstated does not send what was missed', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await moderation.setSuspended(sam, 'ada', true)
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 0)
  await moderation.setSuspended(sam, 'ada', false)
  await deliver()
  // The reinstatement notice itself is for them; the like they missed is not sent.
  assert.equal(outbox.sent.length, 0)
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 1)
  assert.equal(outbox.sent[0]!.subject, 'Your account has been reinstated')
})

test('what the member has read in the app is not emailed', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada, 4)
  const [seen] = (await notificationsService.list(ada, 10)).notifications
  await postsService.like(chi, post)
  await notificationsService.markRead(ada, seen!.id)
  await age(ada, 10)
  await deliver()
  // bayo's like was read; chi's came after.
  assert.equal(outbox.sent.length, 1)
  assert.equal(outbox.sent[0]!.subject, '@chi liked your post')
})

test('a notification older than a day is never emailed', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada, 25 * 60)
  await deliver()
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(jobs.queued, [])
  assert.deepEqual(await settled(ada), [true])
})

test('moderator decisions are emailed, always, in general words; email off still stops them', async () => {
  const { id: post } = await postsService.create(bayo, 'buy my coin')
  await moderation.report(ada, { postId: post }, 'scam')
  const [report] = await db.select().from(reports)
  await moderation.resolve(sam, report!.id, 'remove_post')

  // No kind can be turned off for these, so nothing stands in the way of the email.
  await notificationsService.setPreferences(bayo, { reply: false, like: false, repost: false, quote: false, mention: false, follow: false })
  await age(bayo)
  await age(ada)
  await deliver()
  const byAddress = new Map(outbox.sent.map((m) => [m.to, m]))
  const removed = byAddress.get('bayo@example.test')!
  assert.equal(removed.subject, 'A moderator removed one of your posts')
  assert.ok(!(removed.text + removed.html + removed.subject).includes('buy my coin'))
  assert.ok(!/scam/i.test(removed.text + removed.html), 'no reason is given')
  assert.equal(byAddress.get('ada@example.test')!.subject, 'A moderator reviewed a report you made')

  // With email off, a member is still told in the app, and not by email.
  outbox.sent = []
  await notificationsService.setPreferences(bayo, { email: false })
  await moderation.restorePost(sam, post)
  await age(bayo)
  await deliver()
  assert.equal(outbox.sent.length, 0)
  assert.equal((await notificationsService.list(bayo, 10)).notifications[0]!.kind, 'post_restored')
})

test('a member whose address Kratos does not give is passed over', async () => {
  directory.byId.set(ada, null)
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(await settled(ada), [true])
})

test('trouble reaching the mail server or Kratos leaves everything waiting, and a retry sends it', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada)
  await email.sweep()

  outbox.failWith = new Error('connection refused')
  await assert.rejects(email.sendDigest(ada), /connection refused/)
  directory.failWith = new Error('Kratos answered 503')
  outbox.failWith = null
  await assert.rejects(email.sendDigest(ada), /Kratos answered 503/)
  assert.deepEqual(await settled(ada), [false])
  const [before] = await db.select({ at: members.lastNotificationEmailAt }).from(members).where(eq(members.id, ada))
  assert.equal(before!.at, null)

  directory.failWith = null
  assert.equal(await email.sendDigest(ada), true)
  assert.equal(outbox.sent.length, 1)
  assert.deepEqual(await settled(ada), [true])
})

test('a refusal for good is given up on, not retried for ever', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada)
  outbox.failWith = new PermanentMailError('550 no such mailbox')
  await deliver()
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(await settled(ada), [true])
  outbox.failWith = null
  await deliver()
  assert.equal(outbox.sent.length, 0)
})

test('without a mail server nothing is sent and nothing is settled', async () => {
  const off = new EmailNotificationsService(db, jobs, settings, null, null)
  assert.equal(off.enabled, false)
  assert.equal(email.enabled, true)
  const { id: post } = await postsService.create(ada, 'my post')
  await postsService.like(bayo, post)
  await age(ada)
  assert.equal(await off.sendDigest(ada), false)
  assert.deepEqual(await settled(ada), [false])
})

test('a member who is not there, or has nothing waiting, is a quiet no', async () => {
  assert.equal(await email.sendDigest(randomUUID()), false)
  assert.equal(await email.sendDigest(ada), false)
  assert.equal(outbox.sent.length, 0)
})

test('the link in an email turns email off for that member and changes nothing else', async () => {
  const { id: post } = await postsService.create(ada, 'my post')
  await notificationsService.setPreferences(ada, { follow: false })
  await notificationsService.setPreferences(bayo, { like: false })
  await postsService.like(bayo, post)
  await postsService.like(chi, post)
  const before = await notificationsService.list(ada, 10)

  const token = email.unsubscribeUrl(ada).split('/').pop()!
  assert.equal(await email.unsubscribe(token), true)

  // Email is off for ada, and only for ada.
  assert.deepEqual(await notificationsService.preferences(ada), {
    email: false,
    reply: true, like: true, repost: true, quote: true, mention: true, follow: false,
  })
  assert.equal((await notificationsService.preferences(bayo)).email, true)
  assert.equal((await notificationsService.preferences(bayo)).like, false)
  // Their notifications are as they were, and they are still notified of new activity.
  assert.deepEqual(await notificationsService.list(ada, 10), before)
  await postsService.like(dayo, post)
  assert.equal(await notificationsService.unreadCount(ada), 3)
  // Doing it again is harmless.
  assert.equal(await email.unsubscribe(token), true)
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 0)
})

test('a link that is not one of ours changes nothing', async () => {
  const token = email.unsubscribeUrl(ada).split('/').pop()!
  const [id, signature] = token.split('.')
  const other = new EmailNotificationsService(db, jobs, { ...settings, unsubscribeKey: unsubscribeKey('x'.repeat(32)) }, outbox, directory)
  for (const bad of ['', 'garbage', `${bayo}.${signature}`, `${id}.${signature!.slice(1)}`, `${id}`, `${token}.extra`, other.unsubscribeUrl(ada).split('/').pop()!]) {
    assert.equal(await email.unsubscribe(bad), false, bad)
  }
  const all = await db.select({ id: members.id, on: members.emailNotifications }).from(members)
  assert.ok(all.every((m) => m.on))
})

test('the unsubscribe link is on the web app’s own address, which the web app passes to the API', () => {
  const url = email.unsubscribeUrl(ada)
  assert.ok(url.startsWith(`https://heynaija.test/api/v1/email/unsubscribe/${ada}.`))
})

// With push on, a notification is emailed only once the push side is done with
// it, and not at all if a browser took it (docs/adr/0010).
test('with push on, email waits for the push side, and leaves out whatever was pushed', async () => {
  const withPush = new EmailNotificationsService(db, jobs, { ...settings, waitForPush: true }, outbox, directory)
  const send = async () => {
    jobs.queued = []
    await withPush.sweep()
    for (const id of [...jobs.queued]) await withPush.sendDigest(id)
  }
  const { id: post } = await postsService.create(ada, 'Who is coming to the meetup?')
  const { id: reply } = await postsService.create(bayo, 'Count me in', { replyTo: post })
  await postsService.like(chi, post)
  await age(ada)

  // Old enough to email, but the push side has not looked at either yet.
  await send()
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(jobs.queued, [])

  // It pushed the reply to a browser, and found nothing to push the like to.
  await db.execute(sql`update notifications set push_settled_at = now(), pushed_at = case when post_id = ${reply} then now() end
    where recipient_id = ${ada}`)
  await send()
  assert.equal(outbox.sent.length, 1)
  assert.equal(outbox.sent[0]!.subject, '@chi liked your post')
  assert.doesNotMatch(outbox.sent[0]!.text, /Count me in|replied/)
  assert.deepEqual(await settled(ada), [true, true])
})

test('with push on, a member with only pushed notifications gets no email at all', async () => {
  const withPush = new EmailNotificationsService(db, jobs, { ...settings, waitForPush: true }, outbox, directory)
  const { id: post } = await postsService.create(ada, 'Suya spots in Abuja?')
  await postsService.create(bayo, 'Wuse market, evenings', { replyTo: post })
  await age(ada)
  await db.execute(sql`update notifications set push_settled_at = now(), pushed_at = now() where recipient_id = ${ada}`)
  jobs.queued = []
  await withPush.sweep()
  assert.deepEqual(jobs.queued, [])
  // A digest asked for anyway (queued before the push went out) sends nothing.
  assert.equal(await withPush.sendDigest(ada), false)
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(await settled(ada), [true])
})

test('with push off, email does not wait for a push side that is not there', async () => {
  const { id: post } = await postsService.create(ada, 'Owambe this weekend')
  await postsService.create(bayo, 'I will bring the chin chin', { replyTo: post })
  await age(ada)
  await deliver()
  assert.equal(outbox.sent.length, 1)
})
