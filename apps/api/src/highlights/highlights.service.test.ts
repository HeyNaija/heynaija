import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, follows, members, mutes, notifications, posts, reports } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'
import type { EmailAddresses } from '../email/addresses.js'
import { type Mail, type Mailer, PermanentMailError } from '../email/mailer.js'
import { unsubscribeKey, unsubscribeToken } from '../email/unsubscribe-token.js'
import { PostsService } from '../posts/posts.service.js'
import type { PushMessage } from '../push/push-sender.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { type HighlightsJobs, HighlightsService, type HighlightsSettings } from './highlights.service.js'
import { reasonLine } from './highlights-email.js'
import { HIGHLIGHTS_RULES } from './rules.js'

const key = unsubscribeKey('s'.repeat(32))
const webUrl = 'https://heynaija.test'
/** A run that opened at the start of this hour. */
const openNow = (): HighlightsSettings => ({ webUrl, unsubscribeKey: key, weekday: new Date().getUTCDay(), hourUtc: new Date().getUTCHours() })
/** A run that opened three days ago and has long closed. */
const closed = (): HighlightsSettings => ({ ...openNow(), weekday: (new Date().getUTCDay() + 4) % 7 })

class Jobs implements HighlightsJobs {
  queued: string[] = []
  async send(memberId: string) {
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
  async addressFor(memberId: string) {
    return this.byId.get(memberId) ?? null
  }
}

/** Stands in for the push service: `takes` says whether one of the member's devices took it. */
class Pusher {
  enabled = true
  takes = false
  failWith: Error | null = null
  sent: { memberId: string; messages: PushMessage[] }[] = []
  async sendTo(memberId: string, messages: PushMessage[]) {
    if (this.failWith) throw this.failWith
    if (this.takes) this.sent.push({ memberId, messages })
    return this.takes
  }
}

/** The weeklyHighlights flag: on for everyone, off for everyone, or on for a list. */
class Flag {
  on = true
  list: Set<string> | null = null
  async reading() {
    return { isEnabled: (id: string | null) => (this.list ? id !== null && this.list.has(id) : this.on), listed: this.list !== null }
  }
}

const postsService = new PostsService(db)
let jobs: Jobs
let outbox: Outbox
let directory: Directory
let pusher: Pusher
let flag: Flag
let highlights: HighlightsService

const kemi = randomUUID() // the member who has been away
const [ada, bayo, chi, dayo, eze, femi, gbenga] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const handles = new Map([[kemi, 'kemi'], [ada, 'ada'], [bayo, 'bayo'], [chi, 'chi'], [dayo, 'dayo'], [eze, 'eze'], [femi, 'femi'], [gbenga, 'gbenga']])
const lagos = randomUUID()

const daysAgo = (days: number) => sql`now() - make_interval(secs => ${Math.round(days * 86_400)})`
const lastSeen = (memberId: string, days: number) => db.update(members).set({ lastSeenAt: daysAgo(days) }).where(eq(members.id, memberId))
const service = (settings = openNow(), push: Pusher | null = pusher) => new HighlightsService(db, jobs, settings, flag, push, outbox, directory)

before(migrate)
beforeEach(async () => {
  await reset()
  // Everyone was here an hour ago, except kemi, who has been away four days.
  await db.insert(members).values([...handles].map(([id, handle]) => ({ id, handle, lastSeenAt: daysAgo(id === kemi ? 4 : 0.04) })))
  await db.insert(communities).values({ id: lagos, slug: 'lagos', name: 'Lagos', description: 'Eko' })
  jobs = new Jobs()
  outbox = new Outbox()
  directory = new Directory()
  for (const [id, handle] of handles) directory.byId.set(id, `${handle}@example.test`)
  pusher = new Pusher()
  flag = new Flag()
  highlights = service()
})
after(() => pool.end())

const follow = (followerId: string, followeeId: string) => db.insert(follows).values({ followerId, followeeId })

/** A top-level post, `days` old. */
async function post(author: string, text: string, days = 1, community?: string) {
  const { id } = await postsService.create(author, text, community ? { communitySlug: community } : {})
  await db.update(posts).set({ createdAt: daysAgo(days) }).where(eq(posts.id, id))
  return id
}

const reply = async (author: string, to: string, text = 'reply') => (await postsService.create(author, text, { replyTo: to })).id

/** Moves what just happened a little into the past, so it is before the moment highlights are chosen as of. */
async function settle() {
  await db.execute(sql`update posts set created_at = created_at - interval '1 minute'`)
  await db.execute(sql`update likes set created_at = created_at - interval '1 minute'`)
  await db.execute(sql`update reposts set created_at = created_at - interval '1 minute'`)
}

/** What kemi would be sent, as "text (why)". */
const picked = async (memberId = kemi, sinceDays = 4) => {
  await settle()
  const since = new Date(Date.now() - sinceDays * 86_400_000)
  return (await highlights.pick(memberId, since)).map((h) => `${h.excerpt} (${reasonLine(h)})`)
}

/** Two conversations people took part in: enough to be worth sending. */
async function aBusyWeek() {
  const bridge = await post(ada, 'Third Mainland Bridge closes this weekend', 2)
  await reply(bayo, bridge)
  await reply(chi, bridge)
  const jollof = await post(dayo, 'Jollof wars, again', 1)
  await postsService.like(eze, jollof)
  await settle()
  return { bridge, jollof }
}

const memberRow = async (id: string) => (await db.select().from(members).where(eq(members.id, id)))[0]!

test('the conversations with most going on come first, each author once, and each says why', async () => {
  await follow(kemi, bayo)
  await follow(kemi, femi)
  await db.insert(communityMemberships).values([{ communityId: lagos, memberId: kemi }, { communityId: lagos, memberId: dayo }])

  // Two people replied (4 points), one of them someone kemi follows (3 more).
  const talked = await post(ada, 'talked about', 2)
  await reply(bayo, talked)
  await reply(chi, talked)
  // Three likes, in a community kemi joined (3 + 1).
  const local = await post(dayo, 'in Lagos', 2, 'lagos')
  for (const m of [ada, chi, eze]) await postsService.like(m, local)
  // By someone kemi follows, with nothing on it yet (2).
  await post(femi, 'from someone you follow', 1)
  // One like (1).
  const liked = await post(eze, 'liked once', 1)
  await postsService.like(ada, liked)
  // ada's second post has less going on than her first, so it is left out.
  const second = await post(ada, 'ada again', 1)
  await postsService.like(chi, second)

  assert.deepEqual(await picked(), [
    'talked about (@bayo, who you follow, replied)',
    'in Lagos (From Lagos, which you joined)',
    'from someone you follow (You follow @femi)',
    'liked once (Active on HeyNaija)',
  ])
})

test('at most five, and the counts are the ones on the post', async () => {
  const authors = [ada, bayo, chi, dayo, eze, femi, gbenga]
  for (const [i, author] of authors.entries()) {
    const id = await post(author, `post ${i}`, 1)
    // Later authors get more likes, from the authors before them.
    for (const liker of authors.slice(0, i)) await postsService.like(liker, id)
    if (i === 6) await reply(ada, id)
  }
  await settle()
  const sent = await highlights.pick(kemi, new Date(Date.now() - 4 * 86_400_000))
  assert.equal(sent.length, HIGHLIGHTS_RULES.maxPosts)
  assert.deepEqual(sent.map((h) => h.excerpt), ['post 6', 'post 5', 'post 4', 'post 3', 'post 2'])
  assert.deepEqual({ people: sent[0]!.people, likes: sent[0]!.likes }, { people: 1, likes: 6 })
  assert.equal(sent[0]!.author, 'gbenga')
})

test('nothing from before the member was last here, their own posts, replies on their own, or a quiet post by a stranger', async () => {
  const before = await post(ada, 'from before they left', 5)
  await postsService.like(bayo, before)
  const own = await post(kemi, 'my own post', 2)
  await postsService.like(bayo, own)
  await post(chi, 'nobody took part', 1)
  const seen = await post(dayo, 'the one worth sending', 1)
  await reply(eze, seen, 'a reply is not listed on its own')

  assert.deepEqual(await picked(), ['the one worth sending (Active on HeyNaija)'])
})

test('nothing from anyone blocked, muted or suspended, taken down, deleted, marked sensitive or held by reports', async () => {
  const like = async (id: string) => postsService.like(gbenga, id)
  const ids: Record<string, string> = {}
  for (const [author, text] of [[ada, 'blocked author'], [bayo, 'muted author'], [chi, 'suspended author'], [dayo, 'taken down'], [dayo, 'deleted'], [eze, 'sensitive'], [eze, 'reported by two'], [femi, 'reported by the scanner'], [femi, 'fine']] as const) {
    ids[text] = await post(author, text, 1)
    await like(ids[text]!)
  }
  await db.insert(blocks).values({ blockerId: kemi, blockedId: ada })
  await db.insert(mutes).values({ muterId: kemi, mutedId: bayo })
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, ids['taken down']!))
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, ids['deleted']!))
  await db.update(posts).set({ adultLabel: 'author' }).where(eq(posts.id, ids['sensitive']!))
  await db.insert(reports).values([
    { reporterId: ada, postId: ids['reported by two']!, reason: 'spam' },
    { reporterId: bayo, postId: ids['reported by two']!, reason: 'hate' },
    { reporterId: null, postId: ids['reported by the scanner']!, reason: 'illegal' },
  ])

  // dayo and eze each have one post left out for what it is, and nothing else.
  assert.deepEqual(await picked(), ['fine (Active on HeyNaija)'])
})

test('someone who blocked the member is left out too', async () => {
  const theirs = await post(ada, 'from someone who blocked kemi', 1)
  await postsService.like(bayo, theirs)
  await db.insert(blocks).values({ blockerId: ada, blockedId: kemi })
  assert.deepEqual(await picked(), [])
})

test('the sweep queues a member who has been away, wants highlights and has not been dealt with this run', async () => {
  const [recent, gone, off, suspended, never] = [ada, bayo, chi, dayo, eze]
  await lastSeen(recent, 1) // here yesterday
  await lastSeen(gone, HIGHLIGHTS_RULES.stopAfterDays + 1) // left long ago
  await lastSeen(off, 5)
  await db.update(members).set({ weeklyHighlights: false }).where(eq(members.id, off))
  await lastSeen(suspended, 5)
  await db.update(members).set({ active: false }).where(eq(members.id, suspended))
  await db.update(members).set({ lastSeenAt: null }).where(eq(members.id, never))
  await lastSeen(femi, 10)

  assert.equal(await highlights.sweep(), 2)
  assert.deepEqual([...jobs.queued].sort(), [kemi, femi].sort())
})

test('nothing is queued while no run is open, or when there is nowhere to send anything', async () => {
  assert.equal(await service(closed()).sweep(), 0)
  pusher.enabled = false
  assert.equal(await new HighlightsService(db, jobs, openNow(), flag, pusher, null, null).sweep(), 0)
  assert.equal(new HighlightsService(db, jobs, openNow(), flag, null, null, null).enabled, false)
  assert.deepEqual(jobs.queued, [])
})

test('with the flag off nobody is queued, and with a list only the members on it', async () => {
  await lastSeen(femi, 10)
  flag.on = false
  assert.equal(await highlights.sweep(), 0)
  assert.deepEqual(jobs.queued, [])
  assert.equal((await highlights.rules()).live, false)

  // Passed over this run, so they are not looked at again until the next.
  flag.on = true
  assert.equal(await highlights.sweep(), 0)

  await db.update(members).set({ highlightsSettledAt: null })
  flag.list = new Set([femi])
  assert.equal(await highlights.sweep(), 1)
  assert.deepEqual(jobs.queued, [femi])
  assert.equal(await highlights.offeredTo(femi), true)
  assert.equal(await highlights.offeredTo(kemi), false)
  // A list is not "live": the page that explains highlights says they are not being sent yet.
  assert.equal((await highlights.rules()).live, false)
})

test('highlights are emailed to a member with no device to push to, once a run', async () => {
  const { bridge, jollof } = await aBusyWeek()

  assert.equal(await highlights.send(kemi), 'email')
  assert.equal(outbox.sent.length, 1)
  const [mail] = outbox.sent
  assert.equal(mail!.to, 'kemi@example.test')
  assert.equal(mail!.subject, '2 conversations you missed on HeyNaija')
  assert.ok(mail!.text.indexOf('Third Mainland Bridge') < mail!.text.indexOf('Jollof wars'), 'the busier one first')
  assert.ok(mail!.text.includes(`${webUrl}/p/${bridge}`) && mail!.text.includes(`${webUrl}/p/${jollof}`))
  assert.ok(mail!.text.includes('2 people in the conversation'))
  assert.equal(mail!.unsubscribeUrl, highlights.unsubscribeUrl(kemi))

  const row = await memberRow(kemi)
  assert.ok(row.highlightsSettledAt && row.highlightsSentAt)
  // It is not a notification: nothing is written for the app to show.
  assert.equal((await db.select().from(notifications).where(eq(notifications.recipientId, kemi))).length, 0)

  // The same run does not send again, by the sweep or by a job that runs twice.
  assert.equal(await highlights.sweep(), 0)
  assert.equal(await highlights.send(kemi), null)
  assert.equal(outbox.sent.length, 1)
})

test('with too little worth sending, nothing is sent that week', async () => {
  const only = await post(ada, 'the only conversation', 1)
  await postsService.like(bayo, only)
  await settle()

  assert.equal(await highlights.send(kemi), null)
  assert.equal(outbox.sent.length, 0)
  const row = await memberRow(kemi)
  assert.ok(row.highlightsSettledAt, 'dealt with for this run')
  assert.equal(row.highlightsSentAt, null)
})

test('a push notification where a device takes it, and then no email', async () => {
  const { bridge } = await aBusyWeek()
  pusher.takes = true

  assert.equal(await highlights.send(kemi), 'push')
  assert.equal(outbox.sent.length, 0)
  assert.deepEqual(pusher.sent, [
    {
      memberId: kemi,
      messages: [{ title: 'While you were away on HeyNaija', body: '@ada: “Third Mainland Bridge closes this weekend” and 1 more conversation', url: `/p/${bridge}`, tag: 'highlights' }],
    },
  ])
  assert.ok((await memberRow(kemi)).highlightsSentAt)
})

test('pushed even with email off; and with email off and no device, nothing is sent', async () => {
  await aBusyWeek()
  await db.update(members).set({ emailNotifications: false }).where(eq(members.id, kemi))

  assert.equal(await highlights.send(kemi), null)
  assert.equal(outbox.sent.length, 0)
  assert.ok((await memberRow(kemi)).highlightsSettledAt)

  await db.update(members).set({ highlightsSettledAt: null }).where(eq(members.id, kemi))
  pusher.takes = true
  assert.equal(await highlights.send(kemi), 'push')
})

test('when the push services cannot be reached it is emailed instead; with email off the job is tried again', async () => {
  await aBusyWeek()
  pusher.failWith = new Error('push service is away')

  assert.equal(await highlights.send(kemi), 'email')
  assert.equal(outbox.sent.length, 1)

  await db.update(members).set({ highlightsSettledAt: null, highlightsSentAt: null, emailNotifications: false }).where(eq(members.id, kemi))
  await assert.rejects(highlights.send(kemi), /push service is away/)
  assert.equal((await memberRow(kemi)).highlightsSettledAt, null, 'left for the next try')
})

test('a mail server that is away leaves the member for the next try; a refusal for good does not', async () => {
  await aBusyWeek()
  outbox.failWith = new Error('connection refused')
  await assert.rejects(highlights.send(kemi), /connection refused/)
  assert.equal((await memberRow(kemi)).highlightsSettledAt, null)

  outbox.failWith = new PermanentMailError('no such mailbox')
  assert.equal(await highlights.send(kemi), null)
  const row = await memberRow(kemi)
  assert.ok(row.highlightsSettledAt)
  assert.equal(row.highlightsSentAt, null)
})

test('nothing is sent to a member who came back, turned highlights off, or lost the flag before the job ran', async () => {
  await aBusyWeek()

  await lastSeen(kemi, 0.01)
  assert.equal(await highlights.send(kemi), null)

  await lastSeen(kemi, 4)
  await db.update(members).set({ weeklyHighlights: false }).where(eq(members.id, kemi))
  assert.equal(await highlights.send(kemi), null)

  await db.update(members).set({ weeklyHighlights: true }).where(eq(members.id, kemi))
  flag.on = false
  assert.equal(await highlights.send(kemi), null)

  assert.equal(await service(closed()).send(kemi), null)
  assert.equal(outbox.sent.length, 0)
})

test('a member with no address on record is passed over', async () => {
  await aBusyWeek()
  directory.byId.set(kemi, null)
  assert.equal(await highlights.send(kemi), null)
  assert.ok((await memberRow(kemi)).highlightsSettledAt)
})

test('what an earlier run already covered is not sent again the next week', async () => {
  await aBusyWeek()
  // Last week's run dealt with kemi a day ago; both conversations started before that.
  await db.update(members).set({ highlightsSettledAt: daysAgo(0.5) }).where(eq(members.id, kemi))
  // The run that opened this hour finds only what started since.
  const fresh = await post(femi, 'new since the last run', 0.1)
  await postsService.like(ada, fresh)
  const also = await post(gbenga, 'also new', 0.1)
  await postsService.like(ada, also)
  await settle()

  // Settled half a day ago is before this hour's run, so kemi is due again.
  assert.equal(await highlights.send(kemi), 'email')
  const [mail] = outbox.sent
  assert.equal(mail!.subject, '2 conversations you missed on HeyNaija')
  assert.ok(mail!.text.includes('new since the last run') && mail!.text.includes('also new'))
  assert.ok(!mail!.text.includes('Third Mainland Bridge'))
})

test('the link in the email turns weekly highlights off and nothing else, and only its own kind of link works', async () => {
  const token = highlights.unsubscribeUrl(kemi).split('/').at(-1)!
  assert.ok(highlights.unsubscribeUrl(kemi).startsWith(`${webUrl}/api/v1/highlights/unsubscribe/`))

  // The link from a notification email is for email notifications, not this.
  assert.equal(await highlights.unsubscribe(unsubscribeToken(key, kemi)), false)
  assert.equal(await highlights.unsubscribe('not-a-token'), false)
  assert.equal((await memberRow(kemi)).weeklyHighlights, true)

  assert.equal(await highlights.unsubscribe(token), true)
  const row = await memberRow(kemi)
  assert.equal(row.weeklyHighlights, false)
  assert.equal(row.emailNotifications, true, 'notification emails are untouched')

  await aBusyWeek()
  assert.equal(await highlights.sweep(), 0)
  assert.equal(await highlights.send(kemi), null)
})

test('the published rules carry the schedule and say when highlights are live', async () => {
  const rules = await service({ ...openNow(), weekday: 0, hourUtc: 17 }).rules()
  assert.equal(rules.weekday, 0)
  assert.equal(rules.hourUtc, 17)
  assert.equal(rules.live, true)
  assert.equal(rules.awayDays, HIGHLIGHTS_RULES.awayDays)
  assert.equal(rules.maxPosts, HIGHLIGHTS_RULES.maxPosts)
})
