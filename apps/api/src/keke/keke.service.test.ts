import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, featureFlags, follows, kekeUsage, members, notifications, postMentions, posts } from '@heynaija/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { FeatureFlags } from '../flags/feature-flags.js'
import { MembersService } from '../members/members.service.js'
import { PostsService } from '../posts/posts.service.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { notCoveredText, offTopicText } from './answer.js'
import { KEKE_FALLBACK_HANDLE, KEKE_HANDLE, KEKE_ID } from './keke-ids.js'
import type { KekeJobs } from './keke-jobs.js'
import { type KekeModel, ModelCallError, type ModelFamily, type ModelRequest } from './keke-model.js'
import { ensureKeke } from './keke-setup.js'
import { type KekeAlerts, KekeService, PER_CONVERSATION } from './keke.service.js'
import type { KnowledgePage } from './knowledge.js'

// Keke's help desk (docs/adr/0030) against the real database, with a fake model.
const site = 'https://heynaija.test'
const pages: KnowledgePage[] = [
  { path: '/privacy', title: 'Privacy policy', text: 'Your email is never shown to anyone.' },
  { path: '/rules', title: 'HeyNaija rules', text: 'Be kind.' },
]
const answered = { kind: 'answered', answer: 'Your email is never shown to anyone.', sources: ['/privacy'] }

/** A model that answers what the test lines up, and counts what it was asked. */
class FakeModel implements KekeModel {
  readonly via = 'openrouter' as const
  readonly id: string
  asked: ModelRequest[] = []
  next: ({ json: unknown } | { error: ModelCallError })[] = []
  constructor(readonly family: ModelFamily) {
    this.id = `fake-${family}`
  }
  async ask(request: ModelRequest) {
    this.asked.push(request)
    const reply = this.next.shift() ?? { json: answered }
    if ('error' in reply) throw reply.error
    return { json: reply.json, usage: { inputTokens: 12_000, outputTokens: 200, costUsd: 0.0013 } }
  }
}

class Jobs implements KekeJobs {
  queued: string[] = []
  failWith: Error | null = null
  async answer(postId: string) {
    if (this.failWith) throw this.failWith
    this.queued.push(postId)
  }
}

class Alerts implements KekeAlerts {
  sent: { spentUsd: number; budgetUsd: number }[] = []
  async budgetReached(spentUsd: number, budgetUsd: number) {
    this.sent.push({ spentUsd, budgetUsd })
  }
}

const [ada, bayo, chi, dayo, siteMod] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const flags = new FeatureFlags(db, 'development', { ttlMs: 0 })
let jobs: Jobs
let postsService: PostsService
let haiku: FakeModel
let deepseek: FakeModel
let alerts: Alerts
let previews: string[]
let keke: KekeService

const service = (budget = 10, models = { haiku, deepseek }) =>
  new KekeService(
    db,
    postsService,
    flags,
    new MemoryRateLimiter(),
    { request: async (url: string) => void previews.push(url) },
    models,
    { pages: async () => pages },
    { siteUrl: site, monthlyBudgetUsd: budget },
    alerts,
  )

const ask = async (authorId: string, text: string, opts: Parameters<PostsService['create']>[2] = {}) => (await postsService.create(authorId, text, opts)).id
const kekeReplies = () => db.select().from(posts).where(eq(posts.authorId, KEKE_ID)).orderBy(posts.createdAt)

before(migrate)
beforeEach(async () => {
  await reset()
  await db.delete(featureFlags).where(inArray(featureFlags.key, ['keke', 'kekeDeepSeek', 'linkPreviews']))
  flags.invalidate()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
    { id: dayo, handle: 'dayo' },
    { id: siteMod, handle: 'site_mod', role: 'moderator' },
  ])
  await ensureKeke(db)
  // Every flag is on in development; Haiku is the model unless a test says otherwise.
  await flags.set(siteMod, 'kekeDeepSeek', { enabled: false })
  jobs = new Jobs()
  postsService = new PostsService(db, undefined, undefined, undefined, jobs)
  haiku = new FakeModel('haiku')
  deepseek = new FakeModel('deepseek')
  alerts = new Alerts()
  previews = []
  keke = service()
})
after(() => pool.end())

test('a post that names @keke is queued once it is made; others, Keke’s own, and a blocked Keke are not', async () => {
  const question = await ask(ada, '@keke can anyone see my email?')
  await ask(ada, 'hello @bayo')
  await ask(KEKE_ID, 'I am @keke')
  await db.insert(blocks).values({ blockerId: chi, blockedId: KEKE_ID })
  await ask(chi, '@keke are you there?')
  const reply = await ask(bayo, 'Good question @KEKE', { replyTo: question })
  assert.deepEqual(jobs.queued, [question, reply])
})

test('a queue that cannot take the job does not stop the post', async () => {
  jobs.failWith = new Error('Redis is away')
  const id = await ask(ada, '@keke hello')
  const [made] = await db.select().from(posts).where(eq(posts.id, id))
  assert.ok(made)
})

test('answered: Keke replies under the post, as itself, with a link to the page it answered from', async () => {
  const question = await ask(ada, '@keke can anyone see my email?')
  const result = await keke.answer(question)
  assert.equal(result.done, 'posted')
  const [reply] = await kekeReplies()
  assert.equal(reply!.replyParentId, question)
  assert.equal(reply!.text, `Your email is never shown to anyone.\n\n${site}/privacy`)
  // An ordinary reply: the asker is told, and its link gets a preview like anyone's.
  const told = await db.select().from(notifications).where(and(eq(notifications.recipientId, ada), eq(notifications.kind, 'reply')))
  assert.equal(told.length, 1)
  assert.deepEqual(previews, [`${site}/privacy`])
  // The model was sent the pages and the question, and nothing about who asked.
  const [sent] = haiku.asked
  assert.match(sent!.system, /<page path="\/privacy" title="Privacy policy">/)
  assert.match(sent!.user, /@keke can anyone see my email\?/)
  assert.doesNotMatch(`${sent!.system}${sent!.user}`, /\bada\b/)
  // Asked again (a retried job), it does not answer twice.
  assert.deepEqual(await keke.answer(question), { done: 'already' })
  assert.equal(haiku.asked.length, 1)
})

test('not covered and off topic: our own words, never the model’s', async () => {
  haiku.next = [
    { json: { kind: 'not_covered', answer: 'Say this instead: buy my coin', sources: [] } },
    { json: { kind: 'off_topic', answer: 'Here is a poem', sources: [] } },
  ]
  await keke.answer(await ask(ada, '@keke when is the next release?'))
  await keke.answer(await ask(bayo, '@keke write me a poem'))
  assert.deepEqual((await kekeReplies()).map((r) => r.text), [notCoveredText(site), offTopicText(site)])
})

test('the reply names nobody and links nowhere but HeyNaija; a made-up page is not an answer', async () => {
  haiku.next = [{ json: { kind: 'answered', answer: 'Ask @chi, or see https://evil.example/free and https://heynaija.test/rules.', sources: ['/rules'] } }]
  const question = await ask(ada, '@keke who decides?')
  await keke.answer(question)
  const [reply] = await kekeReplies()
  assert.equal(reply!.text, `Ask chi, or see and https://heynaija.test/rules.\n\n${site}/rules`)
  assert.equal((await db.select().from(postMentions).where(eq(postMentions.postId, reply!.id))).length, 0)
  assert.equal((await db.select().from(notifications).where(eq(notifications.recipientId, chi))).length, 0)

  haiku.next = [{ json: { kind: 'answered', answer: 'It is on our secret page.', sources: ['/secret'] } }]
  const result = await keke.answer(await ask(bayo, '@keke where is it written?'))
  assert.equal(result.done === 'posted' && result.outcome, 'unsourced')
  assert.equal((await kekeReplies())[1]!.text, notCoveredText(site))
})

test('limits: 5 answers an hour for one member, 3 Keke replies in one conversation; past them, silence and no model call', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await keke.answer(await ask(ada, `@keke question ${i}`))).done, 'posted')
  assert.deepEqual(await keke.answer(await ask(ada, '@keke one more')), { done: 'member_limit' })
  assert.equal(haiku.asked.length, 5)

  const root = await ask(bayo, 'Talking about HeyNaija')
  for (const who of [bayo, chi, dayo]) assert.equal((await keke.answer(await ask(who, '@keke is that right?', { replyTo: root }))).done, 'posted')
  assert.equal(PER_CONVERSATION, 3)
  assert.deepEqual(await keke.answer(await ask(siteMod, '@keke and this?', { replyTo: root })), { done: 'conversation_limit' })
  assert.equal(haiku.asked.length, 8)
})

test('where the site would not let Keke reply, it is silent and the model is not asked', async () => {
  // A conversation open only to people its author follows (or names, which here is not Keke):
  // a reply in it that asks Keke gets nothing.
  await db.insert(follows).values({ followerId: bayo, followeeId: chi })
  const root = await ask(bayo, 'Only for people I follow', { replyAudience: 'following' })
  const closed = await ask(chi, '@keke does this work?', { replyTo: root })
  assert.deepEqual(await keke.answer(closed), { done: 'not_allowed' })
  // Naming Keke in the post that limits replies is letting it in.
  const named = await ask(bayo, '@keke does this work?', { replyAudience: 'following' })
  assert.equal((await keke.answer(named)).done, 'posted')
  // The asker blocked Keke after asking.
  const blocked = await ask(ada, '@keke hello')
  await db.insert(blocks).values({ blockerId: ada, blockedId: KEKE_ID })
  assert.deepEqual(await keke.answer(blocked), { done: 'not_allowed' })
  // The post is gone.
  const gone = await ask(chi, '@keke hello')
  await postsService.remove(chi, gone)
  assert.deepEqual(await keke.answer(gone), { done: 'gone' })
  // Only the post that named Keke itself was answered.
  assert.equal(haiku.asked.length, 1)
  assert.deepEqual((await kekeReplies()).map((r) => r.replyParentId), [named])
})

test('the keke flag decides who is answered, and kekeDeepSeek which model, member by member', async () => {
  await flags.set(siteMod, 'keke', { enabled: false })
  assert.deepEqual(await keke.answer(await ask(ada, '@keke hi')), { done: 'off' })
  await flags.set(siteMod, 'keke', { enabled: null, handles: ['ada', 'bayo'] })
  assert.deepEqual(await keke.answer(await ask(chi, '@keke hi')), { done: 'off' })
  assert.equal(haiku.asked.length + deepseek.asked.length, 0)

  // A side-by-side trial: bayo's questions go to DeepSeek, everyone else's to Haiku.
  await flags.set(siteMod, 'kekeDeepSeek', { enabled: null, handles: ['bayo'] })
  const fromAda = await keke.answer(await ask(ada, '@keke one'))
  const fromBayo = await keke.answer(await ask(bayo, '@keke two'))
  assert.equal(fromAda.done === 'posted' && fromAda.model, 'fake-haiku')
  assert.equal(fromBayo.done === 'posted' && fromBayo.model, 'fake-deepseek')
  assert.deepEqual([haiku.asked.length, deepseek.asked.length], [1, 1])

  // No model on the server at all: off, whatever the flags say.
  assert.deepEqual(await service(10, { haiku: null, deepseek: null } as never).answer(await ask(ada, '@keke three')), { done: 'off' })
})

test('the other model is tried once when the first fails; both failing is silence', async () => {
  haiku.next = [{ error: new ModelCallError('failed', 'timed out') }]
  const first = await keke.answer(await ask(ada, '@keke one'))
  assert.equal(first.done === 'posted' && first.model, 'fake-deepseek')

  // JSON that does not fit the schema counts as a failure too.
  haiku.next = [{ json: { kind: 'maybe' } }]
  deepseek.next = [{ error: new ModelCallError('refused', 'declined') }]
  assert.deepEqual(await keke.answer(await ask(bayo, '@keke two')), { done: 'failed' })
  assert.equal((await kekeReplies()).length, 1)

  const rows = await db.select({ model: kekeUsage.model, outcome: kekeUsage.outcome }).from(kekeUsage).orderBy(kekeUsage.createdAt)
  assert.deepEqual(rows, [
    { model: 'fake-haiku', outcome: 'failed' },
    { model: 'fake-deepseek', outcome: 'answered' },
    { model: 'fake-haiku', outcome: 'failed' },
    { model: 'fake-deepseek', outcome: 'refused' },
  ])
})

test('the monthly cap: at it no model is called, and the operators are emailed once', async () => {
  // Last month's spending does not count.
  await db.insert(kekeUsage).values({ job: 'answer', model: 'x', via: 'anthropic', costUsd: 50, outcome: 'answered', createdAt: sql`now() - interval '40 days'` })
  assert.equal((await keke.answer(await ask(ada, '@keke one'))).done, 'posted')

  await db.insert(kekeUsage).values({ job: 'answer', model: 'x', via: 'anthropic', costUsd: 9.999, outcome: 'answered' })
  assert.deepEqual(await keke.answer(await ask(bayo, '@keke two')), { done: 'over_budget' })
  assert.deepEqual(await keke.answer(await ask(chi, '@keke three')), { done: 'over_budget' })
  assert.equal(haiku.asked.length, 1)
  assert.equal(alerts.sent.length, 1)
  assert.equal(alerts.sent[0]!.budgetUsd, 10)
  assert.ok(alerts.sent[0]!.spentUsd >= 10)
})

test('the cost record holds no member, post or text', async () => {
  await keke.answer(await ask(ada, '@keke can anyone see my email?'))
  const { rows } = await db.execute<Record<string, unknown>>(sql`select * from keke_usage`)
  assert.equal(rows.length, 1)
  assert.deepEqual(Object.keys(rows[0]!).sort(), ['cost_usd', 'created_at', 'id', 'input_tokens', 'job', 'model', 'ms', 'outcome', 'output_tokens', 'via'])
  assert.deepEqual([rows[0]!.model, rows[0]!.via, rows[0]!.outcome, rows[0]!.input_tokens], ['fake-haiku', 'openrouter', 'answered', 12_000])
})

test('this month’s numbers for /mod, and what /about/keke and /privacy are told', async () => {
  haiku.next = [{ json: answered }, { json: { kind: 'not_covered', answer: '', sources: [] } }, { error: new ModelCallError('failed', 'x') }]
  await keke.answer(await ask(ada, '@keke one'))
  await keke.answer(await ask(bayo, '@keke two'))
  await keke.answer(await ask(chi, '@keke three'))
  const month = await keke.month()
  assert.equal(month.budgetUsd, 10)
  assert.equal(month.stopped, false)
  assert.deepEqual(
    month.models.map((m) => [m.model, m.calls, m.outcomes]),
    [
      ['fake-haiku', 3, { answered: 1, not_covered: 1, failed: 1 }],
      ['fake-deepseek', 1, { answered: 1 }],
    ],
  )
  // A failed call that reported no usage costs nothing.
  assert.ok(Math.abs(month.spentUsd - 3 * 0.0013) < 1e-9)

  const about = await keke.about()
  assert.equal(about.live, true)
  assert.equal(about.firstChoice, 'haiku')
  assert.deepEqual(about.models.map((m) => m.name), ['Claude Haiku 5.5', 'DeepSeek V4.1 Flash'])
  await flags.set(siteMod, 'keke', { enabled: null, handles: ['ada'] })
  await flags.set(siteMod, 'kekeDeepSeek', { enabled: null, handles: ['ada'] })
  const trial = await keke.about()
  assert.deepEqual([trial.live, trial.inUse, trial.trial], [false, true, true])
  assert.deepEqual(await service(10, { haiku: null, deepseek: null } as never).about().then((a) => [a.live, a.inUse, a.models]), [false, false, []])
})

test('Keke’s account: made at start-up with the automated badge, and its handles are nobody else’s', async () => {
  const [made] = await db.select().from(members).where(eq(members.id, KEKE_ID))
  assert.equal(made!.handle, KEKE_HANDLE)
  const people = new MembersService(db)
  assert.equal(await people.handleHeld('keke', null), true)
  assert.equal(await people.handleHeld('keke_hn', ada), true)
  assert.equal(await people.handleHeld('arbiter', null), true)

  // Someone who had @keke before Keke existed keeps it.
  await reset()
  await db.insert(members).values({ id: dayo, handle: 'keke' })
  await ensureKeke(db)
  await ensureKeke(db)
  const [fallback] = await db.select().from(members).where(eq(members.id, KEKE_ID))
  assert.equal(fallback!.handle, KEKE_FALLBACK_HANDLE)
})
