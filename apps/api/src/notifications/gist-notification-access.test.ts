import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, gistMembers, gists, members, notifications } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'
import type { EmailAddresses } from '../email/addresses.js'
import { type EmailJobs, EmailNotificationsService, type EmailSettings } from '../email/email-notifications.service.js'
import type { Mail, Mailer } from '../email/mailer.js'
import { unsubscribeKey } from '../email/unsubscribe-token.js'
import type { GistsGate } from '../gists/gists-enabled.guard.js'
import { PostsService } from '../posts/posts.service.js'
import { type PushJobs, PushNotificationsService } from '../push/push-notifications.service.js'
import type { PushMessage, PushSender, PushTarget } from '../push/push-sender.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { NotificationsService } from './notifications.service.js'

const people = ['ada', 'bayo', 'chi', 'dayo', 'eli', 'fay', 'gus'] as const
type Person = (typeof people)[number]
const id = Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>

let flagOff = new Set<string>()
const gate: Pick<GistsGate, 'access'> = { access: async () => ({ member: (memberId) => !flagOff.has(memberId), anyone: true }) }

class PushJobsLog implements PushJobs {
  async push() {}
}
class Browser implements PushSender {
  readonly publicKey = `B${'k'.repeat(86)}`
  sent: PushMessage[] = []
  async send(_target: PushTarget, message: PushMessage) {
    this.sent.push(message)
  }
}
class EmailJobsLog implements EmailJobs {
  async sendDigest() {}
}
class Outbox implements Mailer {
  sent: Mail[] = []
  async send(mail: Mail) {
    this.sent.push(mail)
  }
}
const directory: EmailAddresses = { addressFor: async (memberId) => `${memberId}@example.test` }
const settings: EmailSettings = { webUrl: 'https://heynaija.test', unsubscribeKey: unsubscribeKey('s'.repeat(32)), delayS: 300, gapS: 1800, waitForPush: false }

const posts = new PostsService(db)
let list: NotificationsService
let browser: Browser
let push: PushNotificationsService
let outbox: Outbox
let email: EmailNotificationsService
let room: string
let reply: string

before(migrate)
beforeEach(async () => {
  await reset()
  flagOff = new Set()
  await db.insert(members).values(people.map((p) => ({ id: id[p], handle: p })))
  const [community] = await db.insert(communities).values({ slug: 'lagos', name: 'Lagos', description: 'Eko' }).returning({ id: communities.id })
  await db.insert(communityMemberships).values(['ada', 'bayo', 'chi', 'eli', 'fay', 'gus'].map((p) => ({ communityId: community!.id, memberId: id[p as Person] })))
  const [gist] = await db.insert(gists).values({ hostId: id.ada, title: 'Lagos only', communityId: community!.id }).returning({ id: gists.id })
  room = gist!.id
  await db.insert(gistMembers).values([
    { gistId: room, memberId: id.ada, role: 'host' },
    { gistId: room, memberId: id.eli, role: 'listener', removedAt: new Date() },
  ])
  await db.insert(blocks).values({ blockerId: id.fay, blockedId: id.ada })
  flagOff.add(id.gus)
  list = new NotificationsService(db, gate)
  browser = new Browser()
  push = new PushNotificationsService(db, new PushJobsLog(), browser, gate)
  outbox = new Outbox()
  email = new EmailNotificationsService(db, new EmailJobsLog(), settings, outbox, directory, gate)
  reply = (await posts.create(id.bayo, 'secret Lagos talk', { gist: room })).id
  await db.delete(notifications)
  for (const p of people) {
    await db.insert(notifications).values({ recipientId: id[p], kind: 'mention', actorId: id.bayo, postId: reply })
    await push.subscribe(id[p], { endpoint: `https://push.test/${p}`, p256dh: 'k', auth: 'a' })
  }
  await db.execute(sql`update notifications set created_at = created_at - interval '6 minutes'`)
})
after(() => pool.end())

const cannot: Person[] = ['dayo', 'eli', 'fay', 'gus']
const can: Person[] = ['ada', 'bayo', 'chi']

test('a notification about a Gist reply is listed only to someone who can open the Gist', async () => {
  for (const p of can) assert.equal((await list.list(id[p], 20)).notifications.length, 1, p)
  for (const p of cannot) {
    assert.equal((await list.list(id[p], 20)).notifications.length, 0, p)
    assert.equal(await list.unreadCount(id[p]), 0, p)
  }
})

test('it is pushed only to someone who can open the Gist', async () => {
  await push.sweep()
  for (const p of people) await push.send(id[p])
  const sent = browser.sent.filter((m) => m.body.includes('secret'))
  assert.equal(sent.length, can.length)
  for (const message of sent) {
    assert.equal(message.url, `/gists/${room}?reply=${reply}#post-${reply}`)
    assert.match(message.title, /in a Gist/)
  }
})

test('it reaches the email digest only for someone who can open the Gist', async () => {
  await email.sweep()
  for (const p of people) await email.sendDigest(id[p])
  const texts = outbox.sent.filter((m) => m.text.includes('secret'))
  assert.deepEqual(texts.map((m) => m.to).sort(), can.map((p) => `${id[p]}@example.test`).sort())
  for (const mail of texts) {
    assert.ok(mail.text.includes(`/gists/${room}?reply=${reply}#post-${reply}`))
    assert.ok(!mail.text.includes(`/p/${reply}`))
  }
  assert.equal(outbox.sent.filter((m) => cannot.some((p) => m.to === `${id[p]}@example.test`)).length, 0)
})

const eraseHost = () => db.update(members).set({ deletedAt: new Date() }).where(eq(members.id, id.ada))

test('when the host erases their account, the list withholds replies in the Gist from everyone who could open it', async () => {
  await eraseHost()
  assert.equal((await list.list(id.chi, 20)).notifications.length, 0)
  assert.equal(await list.unreadCount(id.chi), 0)
})

test('when the host erases their account, no push is sent about replies in the Gist', async () => {
  await eraseHost()
  await push.sweep()
  await push.send(id.chi)
  assert.equal(browser.sent.filter((m) => m.body.includes('secret')).length, 0)
})

test('when the host erases their account, the email digest leaves out replies in the Gist', async () => {
  await eraseHost()
  await email.sweep()
  await email.sendDigest(id.chi)
  assert.equal(outbox.sent.filter((m) => m.text.includes('secret')).length, 0)
})

test('a member who is removed from the Gist later stops seeing the old notification', async () => {
  await db.insert(gistMembers).values({ gistId: room, memberId: id.chi, role: 'listener', removedAt: new Date() })
  assert.equal((await list.list(id.chi, 20)).notifications.length, 0)
})

test('a moderation decision about your own Gist reply shows even after you can no longer open the Gist', async () => {
  const { id: own } = await posts.create(id.chi, 'my own words', { gist: room })
  await db.insert(gistMembers).values({ gistId: room, memberId: id.chi, role: 'listener', removedAt: new Date() })
  await db.delete(notifications)
  await db.insert(notifications).values({ recipientId: id.chi, kind: 'post_removed', postId: own, detail: 'harassment' })
  const [item] = (await list.list(id.chi, 20)).notifications
  assert.equal(item?.kind, 'post_removed')
  assert.equal(item?.post?.excerpt, 'my own words')
  assert.equal(await list.unreadCount(id.chi), 1)
})

test('a reporter who can no longer open the Gist still hears the outcome, without the reply or a way to it', async () => {
  await db.delete(notifications)
  await db.insert(notifications).values({ recipientId: id.dayo, kind: 'report_resolved', postId: reply, detail: 'actioned' })
  await db.execute(sql`update notifications set created_at = created_at - interval '6 minutes'`)
  const [item] = (await list.list(id.dayo, 20)).notifications
  assert.equal(item?.kind, 'report_resolved')
  assert.equal(item?.post, null)
  assert.equal(await list.unreadCount(id.dayo), 1)
  await push.sweep()
  await push.send(id.dayo)
  await email.sweep()
  await email.sendDigest(id.dayo)
  assert.equal(browser.sent.filter((m) => JSON.stringify(m).includes(room) || JSON.stringify(m).includes('secret')).length, 0)
  assert.equal(outbox.sent.filter((m) => m.text.includes(room) || m.text.includes('secret')).length, 0)
})
