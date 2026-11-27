import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { communities, communityMemberships, featureFlags, kekeNewsDrafts, kekeNewsItems, kekeUsage, members, notifications, posts } from '@heynaija/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { FeatureFlags } from '../flags/feature-flags.js'
import type { PageFetcher } from '../links/safe-fetch.js'
import { NotACommunityMemberError, PostsService } from '../posts/posts.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { KEKE_ID, NAIJA_TODAY_SLUG } from './keke-ids.js'
import { type KekeModel, ModelCallError, type ModelRequest } from './keke-model.js'
import { ensureKeke } from './keke-setup.js'
import { type KekeAlerts, KekeService } from './keke.service.js'
import { parseFeed } from './news-feeds.js'
import { chooseStories, lagosDay, lagosTime, NEWS_RULE, type NewsStory, outletList } from './news-rule.js'
import type { NewsSource } from './news-sources.js'
import { ensureNaijaToday, KekeNews, NAIJA_TODAY, NAIJA_TODAY_FIRST, NewsDecisionError } from './news.service.js'

// Keke's daily news (docs/adr/0030): feeds, the published rule, drafts a person
// approves, and the post at 08:00, against the real database with a fake model.
const site = 'https://heynaija.test'
const sources: NewsSource[] = ['A', 'B', 'C', 'D', 'E'].map((x) => ({ id: x.toLowerCase(), name: `Outlet ${x}`, site: `https://${x.toLowerCase()}.example`, feed: `https://${x.toLowerCase()}.example/feed` }))

const day = lagosDay()
const at = (hour: number, minute = 0) => lagosTime(day, { hour, minute })
/** The moment every date here is measured from: 05:30 today in Nigeria, when the draft is made. */
const T0 = at(5, 30)
const hoursAgo = (h: number) => new Date(T0.getTime() - h * 3_600_000)
const rss = (items: { title: string; slug: string; at: Date; description?: string }[], host: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${host}</title>${items
    .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>https://${host}/${i.slug}</link><pubDate>${i.at.toUTCString()}</pubDate><description><![CDATA[<p>${i.description ?? `${i.title}, in more words.`}</p>]]></description></item>`)
    .join('')}</channel></rss>`

/** Every outlet carries the budget story and the fuel story; A, B and C the flood; only A and B the match. */
const FEEDS: Record<string, string> = Object.fromEntries(
  sources.map((s, i) => {
    const items = [
      { title: `Budget passes Senate (${s.name})`, slug: 'budget', at: hoursAgo(2) },
      { title: `Fuel price falls (${s.name})`, slug: 'fuel', at: hoursAgo(3) },
      ...(i < 3 ? [{ title: `Floods in Kogi (${s.name})`, slug: 'floods', at: hoursAgo(4) }] : []),
      ...(i < 2 ? [{ title: `Eagles win (${s.name})`, slug: 'eagles', at: hoursAgo(5) }] : []),
      { title: `Old story (${s.name})`, slug: 'old', at: hoursAgo(30) },
    ]
    return [s.feed, rss(items, `${s.id}.example`)]
  }),
)

class Fetcher implements PageFetcher {
  down = new Set<string>()
  /** What a feed shows now, in place of the full test feed. */
  showing = new Map<string, string>()
  async get(url: string) {
    const feed = this.showing.get(url) ?? FEEDS[url]
    if (this.down.has(url) || !feed) throw new Error('unreachable')
    return { url: new URL(url), contentType: 'application/rss+xml', body: Buffer.from(feed) }
  }
}

/** Groups the test feeds by their slug, as a model would, with sentences of its own. */
class GroupingModel implements KekeModel {
  readonly family = 'haiku' as const
  readonly via = 'anthropic' as const
  readonly id = 'fake-haiku'
  asked: ModelRequest[] = []
  failWith: ModelCallError | null = null
  async ask(request: ModelRequest) {
    this.asked.push(request)
    if (this.failWith) throw this.failWith
    const lines = request.user.split('\n')
    const bySlug = new Map<string, number[]>()
    lines.forEach((line, i) => {
      const slug = /^\[\d+\] Outlet \w: (\w+)/.exec(line)?.[1]!.toLowerCase() ?? 'x'
      bySlug.set(slug, [...(bySlug.get(slug) ?? []), i])
    })
    const stories = [...bySlug].map(([slug, items]) => ({ items, sentence: `The ${slug} story, said plainly. Ask @ada https://evil.example` }))
    return { json: { stories }, usage: { inputTokens: 3000, outputTokens: 400, costUsd: 0.0005 } }
  }
}

class Alerts implements KekeAlerts {
  async budgetReached() {}
}

const [ada, mod, formerMod] = [randomUUID(), randomUUID(), randomUUID()]
/** Who has been told about the morning's draft, and what: [handle, outcome], oldest first. */
const told = async () =>
  (
    await db
      .select({ handle: members.handle, detail: notifications.detail })
      .from(notifications)
      .innerJoin(members, eq(members.id, notifications.recipientId))
      .where(eq(notifications.kind, 'keke_news'))
      .orderBy(notifications.createdAt)
  ).map((r) => [r.handle, r.detail])
const flags = new FeatureFlags(db, 'development', { ttlMs: 0 })
let fetcher: Fetcher
let model: GroupingModel
let alerts: Alerts
let postsService: PostsService
let news: KekeNews

before(migrate)
beforeEach(async () => {
  await reset()
  await db.delete(featureFlags).where(inArray(featureFlags.key, ['kekeNews', 'kekeDeepSeek', 'communityAnnouncements', 'linkPreviews']))
  flags.invalidate()
  // A suspended site moderator is not told.
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: mod, handle: 'site_mod', role: 'moderator' },
    { id: formerMod, handle: 'suspended_mod', role: 'moderator', active: false },
  ])
  await ensureKeke(db)
  fetcher = new Fetcher()
  model = new GroupingModel()
  alerts = new Alerts()
  postsService = new PostsService(db)
  const settings = { siteUrl: site, monthlyBudgetUsd: 10 }
  const models = { haiku: model, deepseek: null }
  const links = { request: async () => {} }
  const keke = new KekeService(db, postsService, flags, new MemoryRateLimiter(), links, models, { pages: async () => [] }, settings, alerts)
  news = new KekeNews(db, postsService, flags, links, models, keke, settings, fetcher, sources)
})
after(() => pool.end())

test('feeds: RSS and Atom items from the last 24 hours, as plain text, with nothing else taken', () => {
  const items = parseFeed(FEEDS['https://a.example/feed']!, 'a', hoursAgo(24), 0, T0)
  assert.deepEqual(items.map((i) => i.title), ['Budget passes Senate (Outlet A)', 'Fuel price falls (Outlet A)', 'Floods in Kogi (Outlet A)', 'Eagles win (Outlet A)'])
  assert.equal(items[0]!.url, 'https://a.example/budget')
  assert.equal(items[0]!.description, 'Budget passes Senate (Outlet A), in more words.')
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Tinubu &amp; governors meet</title><link rel="alternate" href="https://x.example/meet"/><updated>${hoursAgo(1).toISOString()}</updated><summary>${'Long '.repeat(100)}</summary></entry><entry><title>No link</title><updated>${hoursAgo(1).toISOString()}</updated></entry></feed>`
  const [entry, ...rest] = parseFeed(atom, 'x', hoursAgo(24), 0, T0)
  assert.equal(rest.length, 0)
  assert.equal(entry!.title, 'Tinubu & governors meet')
  assert.equal(entry!.url, 'https://x.example/meet')
  assert.ok(entry!.description.length <= 300 && entry!.description.endsWith('…'))
  // Tracking tags off the link, the feed's own footer off the description, paid-for items left out.
  const tidy = rss([{ title: 'Real', slug: 'real?utm_source=rss&id=7', at: hoursAgo(1), description: 'Words. The post Real appeared first on Punch Newspapers.' }, { title: 'Ad', slug: 'promoted/ad', at: hoursAgo(1) }], 'p.example')
  assert.deepEqual(parseFeed(tidy, 'p', hoursAgo(24), 0, T0).map((i) => [i.url, i.description]), [['https://p.example/real?id=7', 'Words.']])
  // Zero-width joiners some outlets put in headlines are taken out.
  assert.equal(parseFeed(rss([{ title: 'Obi \u200d\u200d\u200dis incorruptible', slug: 'obi', at: hoursAgo(1) }], 'p.example'), 'p', hoursAgo(24), 0, T0)[0]!.title, 'Obi is incorruptible')
  // A feed that writes Nigerian time as UTC is put right.
  const ahead = rss([{ title: 'Late', slug: 'late', at: new Date(T0.getTime() + 30 * 60_000) }], 'p.example')
  assert.equal(parseFeed(ahead, 'p', hoursAgo(24), 1, T0)[0]!.publishedAt.getTime(), T0.getTime() - 30 * 60_000)
})

test('the rule: 3 or more different outlets, the 5 carried by most, and fewer than 3 such stories is no post', () => {
  const item = (outlet: string, n: number) => ({ outlet, title: `t${n}`, url: `https://${outlet}.example/${n}`, description: '', publishedAt: hoursAgo(1) })
  const items = [item('a', 0), item('b', 1), item('c', 2), item('a', 3), item('b', 4), item('c', 5), item('d', 6), item('a', 7), item('a', 8), item('b', 9), item('c', 10), item('d', 11), item('e', 12)]
  const result = {
    stories: [
      { items: [0, 1, 2], sentence: 'Three outlets.' },
      { items: [3, 4, 5, 6], sentence: 'Four outlets.' },
      // One outlet twice is one outlet; a made-up number and an item already used do not count.
      { items: [7, 8, 99, 0], sentence: 'One outlet.' },
      { items: [9, 10, 11, 12], sentence: 'Four outlets, too.' },
    ],
  }
  const kept = chooseStories(items, result, sources, site)!
  assert.deepEqual(kept.map((s) => [s.sentence, s.outlets.length]), [['Four outlets.', 4], ['Four outlets, too.', 4], ['Three outlets.', 3]])
  // Outlets in the source list's order, and the first one's link goes with the story.
  assert.deepEqual(kept[0]!.outlets.map((o) => o.id), ['a', 'b', 'c', 'd'])
  assert.equal(kept[0]!.link, 'https://a.example/3')
  // Two stories that count is too few.
  assert.equal(chooseStories(items, { stories: result.stories.slice(0, 2) }, sources, site), null)
  // At most five.
  const many = { stories: Array.from({ length: 7 }, (_, n) => ({ items: [0, 1, 2].map((k) => k), sentence: `s${n}` })) }
  assert.ok((chooseStories(items, many, sources, site) ?? []).length <= NEWS_RULE.maxStories)
  assert.equal(outletList(['Punch', 'Premium Times', 'Channels']), 'Punch, Premium Times and Channels')
})

test('the 05:30 draft: Naija Today is made, the rule picks the stories, every site moderator is told once', async () => {
  assert.equal(await news.draft(at(5, 30)), 'waiting')
  const [community] = await db.select().from(communities).where(eq(communities.slug, NAIJA_TODAY_SLUG))
  assert.ok(community)
  const view = (await news.today(at(6)))!
  assert.equal(view.status, 'waiting')
  // Fuel and budget (5 outlets each; level, so in the model's order, which is oldest first), then
  // floods (3); the match (2) does not count, nor the old story.
  assert.deepEqual(view.stories.map((s) => [s.sentence.slice(0, 16), s.outlets.length]), [['The fuel story, ', 5], ['The budget story', 5], ['The floods story', 3]])
  // The model's own @mention and link do not survive.
  assert.equal(view.stories[1]!.sentence, 'The budget story, said plainly. Ask ada')
  assert.equal(view.open, true)
  assert.deepEqual(await told(), [['site_mod', 'waiting']])
  // The model is asked only for stories from three or more outlets, and given minutes to answer.
  assert.match(model.asked[0]!.system, /at least 3 different outlets/)
  assert.ok((model.asked[0]!.timeoutMs ?? 0) >= 120_000)
  // Its cost is recorded like any call, with no text.
  const [usage] = await db.select().from(kekeUsage)
  assert.deepEqual([usage!.job, usage!.outcome], ['news', 'drafted'])
  // Run again (a retry, a restart): the same draft, not a second, and nobody told twice.
  assert.equal(await news.draft(at(6)), 'exists')
  assert.equal(model.asked.length, 1)
  assert.equal((await told()).length, 1)
})

test('the moderators’ notification: in their list with what happened, and gone for someone no longer a site moderator', async () => {
  await news.draft(at(5, 30))
  const list = new NotificationsService(db)
  const [shown] = (await list.list(mod, 10)).notifications
  assert.deepEqual([shown!.kind, shown!.detail, shown!.actor, shown!.post], ['keke_news', 'waiting', null, null])
  assert.equal(await list.unreadCount(mod), 1)
  assert.equal((await list.list(ada, 10)).notifications.length, 0)
  await db.update(members).set({ role: 'member' }).where(eq(members.id, mod))
  assert.equal((await list.list(mod, 10)).notifications.length, 0)
})

test('the day is built from hourly reads: a headline gone from its feed by 05:30 still counts', async () => {
  // At 05:00 every feed shows its stories, yesterday's included: all 20 headlines are kept.
  assert.deepEqual(await news.collect(at(5)), { kept: 20, failed: [] })
  // By 05:30 each feed has moved on and shows only its fuel story.
  for (const s of sources) fetcher.showing.set(s.feed, rss([{ title: `Fuel price falls (${s.name})`, slug: 'fuel', at: hoursAgo(3) }], `${s.id}.example`))
  assert.equal(await news.draft(at(5, 30)), 'waiting')
  assert.deepEqual((await news.today(at(6)))!.stories.map((s) => s.sentence.split(',')[0]), ['The fuel story', 'The budget story', 'The floods story'])
  // Read again, nothing is kept twice.
  assert.deepEqual(await news.collect(at(6)), { kept: 0, failed: [] })
})

test('headlines are kept 48 hours, and only the last 24 go into a draft', async () => {
  await db.insert(kekeNewsItems).values([
    { url: 'https://a.example/two-days', outlet: 'a', title: 'Two days old', publishedAt: hoursAgo(50) },
    { url: 'https://a.example/yesterday', outlet: 'a', title: 'Yesterday morning', publishedAt: hoursAgo(30) },
    // An outlet no longer on the list is not read into a draft.
    { url: 'https://gone.example/x', outlet: 'gone', title: 'Gone outlet', publishedAt: hoursAgo(1) },
  ])
  await news.draft(at(5, 30))
  const kept = (await db.select({ url: kekeNewsItems.url }).from(kekeNewsItems)).map((r) => r.url)
  assert.ok(!kept.includes('https://a.example/two-days'))
  assert.ok(kept.includes('https://a.example/yesterday'))
  const sent = model.asked[0]!.user
  assert.doesNotMatch(sent, /Yesterday morning|Gone outlet|Old story/)
  assert.match(sent, /Budget passes Senate/)
  // One line per headline of the last 24 hours: budget and fuel from five outlets, floods from three, the match from two.
  assert.equal(sent.split('\n').length, 15)
})

test('a day with too few stories has no post; the flag off makes no draft at all', async () => {
  // Only two outlets answer: no story can be carried by three, so the model is not even asked.
  fetcher.down = new Set([sources[2]!.feed, sources[3]!.feed, sources[4]!.feed])
  assert.equal(await news.draft(at(5, 30)), 'too_few')
  assert.equal((await news.today(at(6)))!.status, 'too_few')
  // The moderators hear about a day with no news too.
  assert.deepEqual(await told(), [['site_mod', 'too_few']])
  assert.equal(await news.publish(at(8)), 'not_approved')
  assert.equal((await db.select().from(posts).where(eq(posts.authorId, KEKE_ID))).length, 0)
  assert.equal(model.asked.length, 0)

  await db.delete(kekeNewsDrafts)
  await flags.set(mod, 'kekeNews', { enabled: false })
  assert.equal(await news.draft(at(5, 30)), 'off')
  assert.equal(await news.collect(at(6, 15)), 'off')
})

test('a model that fails: no stories, /mod and the moderators are told, and a second run that morning tries again', async () => {
  model.failWith = new ModelCallError('failed', 'timed out')
  assert.equal(await news.draft(at(5, 30)), 'failed')
  const view = (await news.today(at(6)))!
  assert.deepEqual([view.status, view.stories, view.open], ['failed', [], false])
  assert.deepEqual(await told(), [['site_mod', 'failed']])
  // 06:30: it fails again the same way, and nobody is told twice.
  assert.equal(await news.draft(at(6, 30)), 'failed')
  assert.deepEqual(await told(), [['site_mod', 'failed']])
  // 07:30: the model answers this time.
  model.failWith = null
  assert.equal(await news.draft(at(7, 30)), 'waiting')
  assert.equal((await news.today(at(7, 35)))!.status, 'waiting')
  assert.deepEqual(await told(), [['site_mod', 'failed'], ['site_mod', 'waiting']])
  // Made now, it is not made again.
  assert.equal(await news.draft(at(7, 40)), 'exists')
  assert.equal(model.asked.length, 3)
})

test('close to 08:00 the model gets only the time left, none with less than a minute, and nothing runs once the day has closed', async () => {
  // Started at 07:56: three minutes until the draft must be saved at 07:59.
  assert.equal(await news.draft(at(7, 56)), 'waiting')
  const limit = model.asked[0]!.timeoutMs!
  assert.ok(limit <= 180_000 && limit > 170_000, String(limit))

  // Started at 07:58 after a failed morning: under a minute left, so no model is asked.
  await db.update(kekeNewsDrafts).set({ status: 'failed' })
  assert.equal(await news.draft(at(7, 58)), 'failed')
  assert.equal(model.asked.length, 1)
  assert.equal((await news.today(at(7, 58)))!.status, 'failed')

  // 07:59 and after: the day is closed. Nothing is drafted, saved or told.
  const before = await told()
  assert.equal(await news.draft(at(7, 59)), 'closed')
  assert.equal(await news.draft(at(8, 0)), 'closed')
  assert.deepEqual(await told(), before)
})

test('over the monthly cap: the model is not asked, and the moderators are told why there is no news', async () => {
  await db.insert(kekeUsage).values({ job: 'answer', model: 'fake-haiku', via: 'anthropic', costUsd: 10, outcome: 'answered' })
  assert.equal(await news.draft(at(5, 30)), 'over_budget')
  assert.equal(model.asked.length, 0)
  assert.equal((await news.today(at(6)))!.status, 'over_budget')
  assert.deepEqual(await told(), [['site_mod', 'over_budget']])
  // Tried again at 06:30, still over: nobody is told twice.
  assert.equal(await news.draft(at(6, 30)), 'over_budget')
  assert.deepEqual(await told(), [['site_mod', 'over_budget']])
  assert.equal(await news.publish(at(8)), 'not_approved')
})

test('approving: stories kept in the moderator’s order and words; removing; skipping; and nothing after 08:00', async () => {
  await news.draft(at(5, 30))
  await news.decide(mod, day, { stories: [{ index: 2, sentence: 'Floods displace thousands in Kogi.' }, { index: 0, sentence: '  The Senate passed the budget.  ' }, { index: 9, sentence: 'made up' }] }, at(7))
  const approved = (await news.today(at(7)))!
  assert.equal(approved.status, 'approved')
  assert.equal(approved.decidedBy, mod)
  assert.deepEqual(approved.stories.map((s) => s.sentence), ['Floods displace thousands in Kogi.', 'The Senate passed the budget.'])
  assert.equal(approved.stories[0]!.outlets.length, 3)

  await assert.rejects(news.decide(mod, day, { stories: [{ index: 7, sentence: 'x' }] }, at(7)), (e: NewsDecisionError) => e.code === 'no_stories')
  await news.decide(mod, day, { skip: true }, at(7, 30))
  assert.equal((await news.today(at(7, 30)))!.status, 'skipped')
  await assert.rejects(news.decide(mod, day, { skip: true }, at(8)), (e: NewsDecisionError) => e.code === 'too_late')
  assert.equal(await news.publish(at(8)), 'not_approved')
})

test('not approved by 08:00: missed, and nothing is posted', async () => {
  await news.draft(at(5, 30))
  assert.equal(await news.publish(at(8)), 'missed')
  assert.equal((await news.today(at(8)))!.status, 'missed')
  assert.equal((await db.select().from(posts).where(eq(posts.authorId, KEKE_ID))).length, 0)
})

test('08:00: one announcement in Naija Today and a reply per story; members reply, they cannot start posts; it goes once', async () => {
  await news.draft(at(5, 30))
  const [community] = await db.select().from(communities).where(eq(communities.slug, NAIJA_TODAY_SLUG))
  await db.insert(communityMemberships).values({ communityId: community!.id, memberId: ada })
  await news.decide(mod, day, { stories: [0, 1, 2].map((index) => ({ index, sentence: `Story ${index}.` })) }, at(7))
  assert.equal(await news.publish(at(8)), 'published')

  const made = await db.select().from(posts).where(eq(posts.authorId, KEKE_ID)).orderBy(posts.createdAt)
  const [main, ...replies] = made
  assert.equal(main!.communityId, community!.id)
  assert.match(main!.text, /^Naija today, \w+day \d+ \w+\n\n1\. Story 0\.\n2\. Story 1\.\n3\. Story 2\./)
  // "Headline", not "story": a story is a member's post and its updates (ADR 0024).
  assert.match(main!.text, /\n\nReply under a headline to talk about it\.$/)
  assert.equal(replies.length, 3)
  assert.ok(replies.every((r) => r.replyParentId === main!.id))
  assert.equal(replies[0]!.text, 'Story 0.\n\nCarried by Outlet A, Outlet B, Outlet C, Outlet D and Outlet E\n\nhttps://a.example/fuel')
  // The day's announcement: Naija Today's member is told, once.
  const told = await db.select().from(notifications).where(and(eq(notifications.recipientId, ada), eq(notifications.kind, 'community_announcement')))
  assert.equal(told.length, 1)
  const view = (await news.today(at(8)))!
  assert.equal(view.status, 'published')
  assert.equal(view.postId, main!.id)
  assert.ok(view.stories.every((s: NewsStory) => s.replyId))

  // Again (a retried job): nothing new.
  assert.equal(await news.publish(at(8, 1)), 'published')
  assert.equal((await db.select().from(posts).where(eq(posts.authorId, KEKE_ID))).length, 4)

  // Only Keke starts posts there; members reply.
  await assert.rejects(postsService.create(ada, 'my own news', { communitySlug: NAIJA_TODAY_SLUG }), NotACommunityMemberError)
  await postsService.create(ada, 'Na wa for this flood', { replyTo: replies[2]!.id })
})

test('a reply that failed half way is posted on the next run, the rest are not posted twice', async () => {
  await news.draft(at(5, 30))
  await news.decide(mod, day, { stories: [0, 1].map((index) => ({ index, sentence: `Story ${index}.` })) }, at(7))
  await news.publish(at(8))
  // As if the second reply had not gone: its record and its post removed.
  const [second] = await db.select().from(posts).where(and(eq(posts.authorId, KEKE_ID), sql`${posts.text} like 'Story 1.%'`))
  await db.execute(sql`update keke_news_drafts set stories = stories #- '{1,replyId}' where day = ${day}`)
  await db.delete(notifications).where(eq(notifications.postId, second!.id))
  await db.delete(posts).where(eq(posts.id, second!.id))
  await news.publish(at(8, 5))
  const replies = await db.select().from(posts).where(and(eq(posts.authorId, KEKE_ID), sql`${posts.replyParentId} is not null`))
  assert.equal(replies.length, 2)
})

test('the announcement slot a few seconds short: publishing waits for it', async () => {
  await news.draft(at(5, 30))
  await news.decide(mod, day, { stories: [{ index: 0, sentence: 'Story.' }] }, at(7))
  // Yesterday's news took the slot 24 hours ago, less two seconds.
  await db.update(communities).set({ announcedAt: sql`now() - interval '24 hours' + interval '2 seconds'` }).where(eq(communities.slug, NAIJA_TODAY_SLUG))
  const started = Date.now()
  assert.equal(await news.publish(at(8)), 'published')
  assert.ok(Date.now() - started >= 2000)
  const [community] = await db.select().from(communities).where(eq(communities.slug, NAIJA_TODAY_SLUG))
  assert.ok(community!.announcedAt!.getTime() > Date.now() - 10_000)
})

test('with community announcements off, the news is posted and nobody is notified', async () => {
  await flags.set(mod, 'communityAnnouncements', { enabled: false })
  await news.draft(at(5, 30))
  const [community] = await db.select().from(communities).where(eq(communities.slug, NAIJA_TODAY_SLUG))
  await db.insert(communityMemberships).values({ communityId: community!.id, memberId: ada })
  await news.decide(mod, day, { stories: [{ index: 0, sentence: 'Story.' }] }, at(7))
  assert.equal(await news.publish(at(8)), 'published')
  assert.equal((await db.select().from(notifications).where(eq(notifications.recipientId, ada))).length, 0)
  const [after] = await db.select().from(communities).where(and(eq(communities.slug, NAIJA_TODAY_SLUG), isNull(communities.announcedAt)))
  assert.ok(after)
})

test('Naija Today made with the first wording takes the new one, except what a moderator has changed', async () => {
  await db.insert(communities).values({ slug: NAIJA_TODAY_SLUG, name: 'Naija Today', ...NAIJA_TODAY_FIRST })
  await ensureNaijaToday(db)
  const read = async () => (await db.select().from(communities).where(eq(communities.slug, NAIJA_TODAY_SLUG)))[0]!
  assert.deepEqual([(await read()).description, (await read()).rules], [NAIJA_TODAY.description, NAIJA_TODAY.rules])
  assert.doesNotMatch(NAIJA_TODAY.description + NAIJA_TODAY.rules, /stor(y|ies)/i)

  // A moderator's own description stays; rules still in the first wording are replaced.
  await db.update(communities).set({ description: 'Our own words.', rules: NAIJA_TODAY_FIRST.rules }).where(eq(communities.slug, NAIJA_TODAY_SLUG))
  await ensureNaijaToday(db)
  assert.deepEqual([(await read()).description, (await read()).rules], ['Our own words.', NAIJA_TODAY.rules])
})
