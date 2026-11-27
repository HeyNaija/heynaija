import { communities, communityMemberships, type Db, kekeNewsDrafts, kekeNewsItems, members } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm'
import { FeatureFlags } from '../flags/feature-flags.js'
import { LinksService, PAGE_FETCHER } from '../links/links.service.js'
import type { PageFetcher } from '../links/safe-fetch.js'
import { notify } from '../notifications/notifications.service.js'
import { AnnouncementTooSoonError, PostsService } from '../posts/posts.service.js'
import { DB } from '../tokens.js'
import { KEKE_ID, NAIJA_TODAY_SLUG } from './keke-ids.js'
import { chooseModels, KEKE_MODELS, type KekeModels, ModelCallError } from './keke-model.js'
import { KEKE_SETTINGS, KekeService, type KekeSettings } from './keke.service.js'
import { type NewsItem, readFeeds } from './news-feeds.js'
import {
  chooseStories,
  grouping,
  GROUPING_SCHEMA,
  groupingPrompt,
  groupingSystem,
  lagosDay,
  lagosTime,
  NEWS_RULE,
  type NewsStory,
  newsPostText,
  SENTENCE_MAX,
  storyReplyText,
} from './news-rule.js'
import { NEWS_SOURCES, type NewsSource } from './news-sources.js'

/** How long headlines are kept: the draft reads 24 hours, and a day's margin covers a late or missed draft. */
const KEEP_HOURS = 48

/** How a morning's draft went; each is saved for /mod and told to every site moderator. */
export type DraftOutcome = 'waiting' | 'too_few' | 'failed' | 'over_budget'

/** A morning that ended like this is tried again (NEWS_RULE.retryAt, or the API starting) before 08:00. */
const TRIED_AGAIN: DraftOutcome[] = ['failed', 'over_budget']

/**
 * How long one model may take over the morning's grouping, all of it: a day of
 * hourly reads is 400 to 500 headlines, about 60,000 tokens in. On 17 November 2026
 * Haiku took 49 seconds over 465 and DeepSeek 105 over 470; a question's 30 seconds
 * had failed both.
 */
const DRAFT_TIMEOUT_MS = 240_000

/**
 * The draft is saved this long before 08:00 at the latest, so a moderator is never
 * told of news that can no longer be approved; and a model is not asked with less
 * time than CALL_MIN_MS left.
 */
const CLOSE_MARGIN_MS = 60_000
const CALL_MIN_MS = 60_000

/** How long publishing waits for Naija Today's daily announcement to come free, at most. */
const ANNOUNCEMENT_WAIT_MAX_MS = 15 * 60 * 1000

// Each item is a "headline" on screen: a "story" is one member's post and its updates (ADR 0024).
export const NAIJA_TODAY = {
  slug: NAIJA_TODAY_SLUG,
  name: 'Naija Today',
  description: 'Each morning, the Nigerian headlines carried by three or more outlets, in one neutral line each. A person checks every one before it is posted. Reply under a headline to talk about it.',
  rules: [
    'Posts here are Keke’s daily news, started only by Keke once a site moderator has approved them. Reply under a headline to talk about it.',
    'Disagree with the news, not with each other. HeyNaija’s rules apply here as everywhere.',
    'How the headlines are chosen, and from which outlets, is on /about/keke.',
  ].join('\n'),
}

/** The first wording, which called each headline a story. Where it is still unchanged, the wording above replaces it. */
export const NAIJA_TODAY_FIRST = {
  description: 'Each morning, the Nigerian stories carried by three or more outlets, in one neutral line each. A person checks every one before it is posted. Reply under a story to talk about it.',
  rules: [
    'Posts here are Keke’s daily news, started only by Keke once a site moderator has approved them. Reply under a story to talk about it.',
    'Disagree with the story, not with each other. HeyNaija’s rules apply here as everywhere.',
    'How the stories are chosen, and from which outlets, is on /about/keke.',
  ].join('\n'),
}

/**
 * Makes Naija Today with Keke as its moderator, if it is not there yet. Made with the first draft, never before.
 * A description or rules still in the first wording take the new one; any a moderator has edited are left alone.
 */
export async function ensureNaijaToday(db: Db): Promise<void> {
  await db.insert(communities).values(NAIJA_TODAY).onConflictDoNothing({ target: communities.slug })
  const here = eq(communities.slug, NAIJA_TODAY_SLUG)
  await db.update(communities).set({ description: NAIJA_TODAY.description }).where(and(here, eq(communities.description, NAIJA_TODAY_FIRST.description)))
  await db.update(communities).set({ rules: NAIJA_TODAY.rules }).where(and(here, eq(communities.rules, NAIJA_TODAY_FIRST.rules)))
  const [made] = await db.select({ id: communities.id }).from(communities).where(here)
  await db.insert(communityMemberships).values({ communityId: made!.id, memberId: KEKE_ID, role: 'moderator' }).onConflictDoNothing()
}

export class NewsDecisionError extends Error {
  constructor(
    readonly code: 'no_draft' | 'too_late' | 'not_open' | 'no_stories',
    message: string,
  ) {
    super(message)
  }
}

export type NewsDraftView = {
  day: string
  status: (typeof kekeNewsDrafts.$inferSelect)['status']
  stories: NewsStory[]
  items: number
  outlets: number
  decidedBy: string | null
  decidedAt: Date | null
  postId: string | null
  /** Approving or skipping is open until then: 08:00 in Nigeria. */
  cutOff: Date
  open: boolean
}

export const NEWS_FETCHER = Symbol('NEWS_FETCHER')
export const NEWS_SOURCE_LIST = Symbol('NEWS_SOURCE_LIST')

/**
 * Keke's daily news (docs/adr/0030). Every hour, `collect` keeps the headlines
 * the outlets' feeds show. At 05:30 Nigerian time, `draft` has the model group
 * the last 24 hours' headlines into stories, keeps the stories the rule keeps and
 * saves them for a site moderator, and every site moderator is told how it went
 * (ready, too few stories, the model failed, the cap reached). At 08:00,
 * `publish` posts an approved draft in Naija Today as the day's announcement,
 * with a reply per story. A day nobody approves is skipped.
 */
@Injectable()
export class KekeNews {
  private readonly log = new Logger('KekeNews')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
    @Inject(LinksService) private readonly links: Pick<LinksService, 'request'>,
    @Inject(KEKE_MODELS) private readonly models: KekeModels,
    @Inject(KekeService) private readonly keke: Pick<KekeService, 'record' | 'overBudget'>,
    @Inject(KEKE_SETTINGS) private readonly settings: KekeSettings,
    @Inject(NEWS_FETCHER) private readonly fetcher: PageFetcher,
    @Inject(NEWS_SOURCE_LIST) private readonly sources: readonly NewsSource[] = NEWS_SOURCES,
  ) {}

  /**
   * Every hour: reads the outlets' feeds and keeps what is new (headline, link,
   * short description), and forgets anything older than 48 hours. Most feeds
   * hold only their last few hours, so the day is built up this way.
   */
  async collect(now = new Date()): Promise<{ kept: number; failed: string[] } | 'off'> {
    if (!(await this.flags.isEnabled('kekeNews', null))) return 'off'
    const { items, failed } = await readFeeds(this.fetcher, this.sources, KEEP_HOURS, now)
    if (failed.length) this.log.warn(`could not read the feeds of ${failed.join(', ')}`)
    const kept = items.length
      ? await this.db
          .insert(kekeNewsItems)
          .values(items.map((i) => ({ url: i.url, outlet: i.outlet, title: i.title, description: i.description, publishedAt: i.publishedAt })))
          .onConflictDoNothing()
          .returning({ url: kekeNewsItems.url })
      : []
    await this.db.delete(kekeNewsItems).where(lt(kekeNewsItems.publishedAt, new Date(now.getTime() - KEEP_HOURS * 3_600_000)))
    return { kept: kept.length, failed }
  }

  /** The headlines kept from the last `windowHours`, from outlets still on the list, oldest first. */
  private async lastDay(now: Date): Promise<NewsItem[]> {
    const rows = await this.db
      .select()
      .from(kekeNewsItems)
      .where(
        and(
          gt(kekeNewsItems.publishedAt, new Date(now.getTime() - NEWS_RULE.windowHours * 3_600_000)),
          inArray(kekeNewsItems.outlet, this.sources.map((s) => s.id)),
        ),
      )
      .orderBy(asc(kekeNewsItems.publishedAt))
    return rows.map((r) => ({ outlet: r.outlet, title: r.title, url: r.url, description: r.description, publishedAt: r.publishedAt }))
  }

  /**
   * Today's draft, made once (again only after a failure, until shortly before
   * 08:00). What happened, for the log and tests. `now` is when the job started;
   * the time it takes is added to it.
   */
  async draft(now = new Date()): Promise<'off' | 'exists' | 'closed' | DraftOutcome> {
    if (!(await this.flags.isEnabled('kekeNews', null))) return 'off'
    const order = chooseModels(this.models, await this.flags.isEnabled('kekeDeepSeek', null))
    if (!order.length) return 'off'
    const day = lagosDay(now)
    // 08:00 has passed: the post has gone or been missed, and nothing drafted now could be approved.
    const closes = lagosTime(day, NEWS_RULE.publishAt).getTime() - CLOSE_MARGIN_MS
    const started = Date.now()
    const timeLeft = () => closes - now.getTime() - (Date.now() - started)
    if (timeLeft() <= 0) return 'closed'
    const [existing] = await this.db.select({ status: kekeNewsDrafts.status }).from(kekeNewsDrafts).where(eq(kekeNewsDrafts.day, day))
    if (existing && !TRIED_AGAIN.includes(existing.status as DraftOutcome)) return 'exists'
    await ensureNaijaToday(this.db)

    // One more read first, so the last hour is in too; then the day as kept.
    await this.collect(now)
    const items = await this.lastDay(now)
    const outlets = new Set(items.map((i) => i.outlet)).size
    let stories: NewsStory[] | null = null
    let outcome: DraftOutcome = 'too_few'
    if (outlets >= NEWS_RULE.minOutlets) {
      for (const [i, model] of order.entries()) {
        if (await this.keke.overBudget()) {
          outcome = 'over_budget'
          break
        }
        const left = timeLeft()
        if (left < CALL_MIN_MS) {
          this.log.warn(`too close to 08:00 to ask ${model.id} for the news`)
          outcome = 'failed'
          break
        }
        const asked = Date.now()
        try {
          const { json, usage } = await model.ask({
            system: groupingSystem,
            user: groupingPrompt(items, this.sources),
            schemaName: 'keke_news',
            schema: GROUPING_SCHEMA as unknown as Record<string, unknown>,
            maxTokens: 20_000,
            timeoutMs: Math.min(DRAFT_TIMEOUT_MS, left),
          })
          const parsed = grouping.safeParse(json)
          if (!parsed.success) throw new ModelCallError('failed', 'the JSON did not fit the schema', usage)
          await this.keke.record(model, usage, 'drafted', asked, 'news')
          stories = chooseStories(items, parsed.data, this.sources, this.settings.siteUrl)
          outcome = stories ? 'waiting' : 'too_few'
          break
        } catch (err) {
          const failure = err instanceof ModelCallError ? err : new ModelCallError('failed', (err as Error).message)
          await this.keke.record(model, failure.usage, failure.reason, asked, 'news')
          this.log.warn(`${model.id} could not group the news: ${failure.message}`)
          if (i === order.length - 1) outcome = 'failed'
        }
      }
    }
    return this.finish(day, outcome, { stories: stories ?? [], items: items.length, outlets })
  }

  /**
   * Saves how the morning went and tells every site moderator, in one transaction.
   * The notification reaches them in the app and as a push at once, and by email
   * after the usual wait (EMAIL_DIGEST_DELAY_S, 5 minutes) if they have not seen it,
   * like any other. They are told once per outcome: a morning that fails again the
   * same way tells nobody again. A failed morning is replaced when it is tried
   * again; anything else already saved stands, and then this is 'exists'.
   */
  private async finish(
    day: string,
    outcome: DraftOutcome,
    draft: { stories: NewsStory[]; items: number; outlets: number },
  ): Promise<DraftOutcome | 'exists'> {
    const saved = await this.db.transaction(async (tx) => {
      // Locked, so two runs at once save (and tell) one after the other.
      const [before] = await tx.select({ status: kekeNewsDrafts.status }).from(kekeNewsDrafts).where(eq(kekeNewsDrafts.day, day)).for('update')
      if (before && !TRIED_AGAIN.includes(before.status as DraftOutcome)) return false
      const rows = before
        ? await tx
            .update(kekeNewsDrafts)
            .set({ status: outcome, ...draft, createdAt: sql`now()` })
            .where(eq(kekeNewsDrafts.day, day))
            .returning({ day: kekeNewsDrafts.day })
        : await tx.insert(kekeNewsDrafts).values({ day, status: outcome, ...draft }).onConflictDoNothing().returning({ day: kekeNewsDrafts.day })
      if (!rows.length) return false
      if (before?.status === outcome) return true
      const moderators = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.role, 'moderator'), eq(members.active, true), isNull(members.deletedAt)))
      await notify(tx, moderators.map((m) => ({ recipientId: m.id, kind: 'keke_news' as const, detail: outcome })))
      return true
    })
    if (!saved) return 'exists'
    if (outcome === 'waiting') this.log.log(`the news for ${day} is waiting: ${draft.stories.length} stories`)
    else if (outcome === 'too_few') this.log.log(`no news for ${day}: fewer than ${NEWS_RULE.minStories} stories carried by ${NEWS_RULE.minOutlets} outlets`)
    else this.log.warn(`no news for ${day}: ${outcome === 'failed' ? 'every model failed' : 'the monthly cap is reached'}`)
    return outcome
  }

  /** For /about/keke: whether the news is on, its rule and its outlets. */
  async about() {
    const configured = Boolean(this.models.haiku || this.models.deepseek)
    return {
      live: configured && (await this.flags.isEnabled('kekeNews', null)),
      rule: NEWS_RULE,
      sources: this.sources.map((s) => ({ name: s.name, site: s.site })),
    }
  }

  /** Today's draft, or null, for site moderators on /mod. */
  async today(now = new Date()): Promise<NewsDraftView | null> {
    const day = lagosDay(now)
    const [row] = await this.db.select().from(kekeNewsDrafts).where(eq(kekeNewsDrafts.day, day))
    if (!row) return null
    const cutOff = lagosTime(day, NEWS_RULE.publishAt)
    return {
      day: row.day,
      status: row.status,
      stories: row.stories as NewsStory[],
      items: row.items,
      outlets: row.outlets,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      postId: row.postId,
      cutOff,
      open: ['waiting', 'approved', 'skipped'].includes(row.status) && now < cutOff,
    }
  }

  /**
   * A site moderator's decision, before 08:00 on the day: approve the stories
   * they kept (by their place in the draft) with their own wording, or skip the
   * day. Either can be changed until the cut-off.
   */
  async decide(memberId: string, day: string, decision: { skip: true } | { stories: { index: number; sentence: string }[] }, now = new Date()): Promise<void> {
    if (now >= lagosTime(day, NEWS_RULE.publishAt)) throw new NewsDecisionError('too_late', 'the news for that day can no longer be changed')
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(kekeNewsDrafts).where(eq(kekeNewsDrafts.day, day)).for('update')
      if (!row) throw new NewsDecisionError('no_draft', 'there is no news draft for that day')
      if (!['waiting', 'approved', 'skipped'].includes(row.status)) throw new NewsDecisionError('not_open', 'that draft is no longer open')
      if ('skip' in decision) {
        await tx.update(kekeNewsDrafts).set({ status: 'skipped', decidedBy: memberId, decidedAt: sql`now()` }).where(eq(kekeNewsDrafts.day, day))
        return
      }
      const drafted = row.stories as NewsStory[]
      const seen = new Set<number>()
      const kept = decision.stories.flatMap(({ index, sentence }) => {
        const story = drafted[index]
        const text = sentence.replace(/\s+/g, ' ').trim()
        if (!story || seen.has(index) || !text) return []
        seen.add(index)
        return [{ ...story, sentence: text.slice(0, SENTENCE_MAX) }]
      })
      if (!kept.length) throw new NewsDecisionError('no_stories', 'keep at least one story, or skip the day')
      await tx
        .update(kekeNewsDrafts)
        .set({ status: 'approved', stories: kept, decidedBy: memberId, decidedAt: sql`now()` })
        .where(eq(kekeNewsDrafts.day, day))
    })
  }

  /**
   * At 08:00: posts the approved draft in Naija Today as its announcement for the
   * day, then a reply per story. A draft still waiting is missed. Safe to run
   * again: what was posted is recorded as it goes, and is not posted twice.
   */
  async publish(now = new Date()): Promise<'none' | 'off' | 'missed' | 'published' | 'not_approved'> {
    const day = lagosDay(now)
    const [row] = await this.db.select().from(kekeNewsDrafts).where(eq(kekeNewsDrafts.day, day))
    if (!row) return 'none'
    if (row.status === 'waiting') {
      await this.db.update(kekeNewsDrafts).set({ status: 'missed' }).where(and(eq(kekeNewsDrafts.day, day), eq(kekeNewsDrafts.status, 'waiting')))
      return 'missed'
    }
    if (row.status !== 'approved' && row.status !== 'published') return 'not_approved'
    if (!(await this.flags.isEnabled('kekeNews', null))) return 'off'
    await ensureNaijaToday(this.db)
    const stories = row.stories as NewsStory[]

    let postId = row.postId
    if (!postId) postId = await this.postAnnouncement(day, stories)
    for (const [i, story] of stories.entries()) {
      if (story.replyId) continue
      const { id, linkUrl } = await this.posts.create(KEKE_ID, storyReplyText(story), {
        replyTo: postId,
        // Recorded in the reply's own transaction, so a second run never posts it again.
        alongside: async (tx, id) => {
          await tx.execute(sql`update keke_news_drafts set stories = jsonb_set(stories, ${`{${i},replyId}`}::text[], to_jsonb(${id}::text)) where day = ${day}`)
        },
      })
      stories[i] = { ...story, replyId: id }
      if (linkUrl && (await this.flags.isEnabled('linkPreviews', KEKE_ID))) await this.links.request(linkUrl)
    }
    return 'published'
  }

  /** The day's post, as Naija Today's announcement; waits for its daily slot if it is only minutes away. */
  private async postAnnouncement(day: string, stories: NewsStory[]): Promise<string> {
    const text = newsPostText(day, stories)
    const record = async (tx: Pick<Db, 'update'>, id: string) => {
      await tx.update(kekeNewsDrafts).set({ status: 'published', postId: id, publishedAt: sql`now()` }).where(eq(kekeNewsDrafts.day, day))
    }
    // The daily notice is a community announcement (ADR 0029), so it follows that flag:
    // while it is off the news is posted all the same, and nobody is notified.
    if (!(await this.flags.isEnabled('communityAnnouncements', KEKE_ID))) {
      return (await this.posts.create(KEKE_ID, text, { communitySlug: NAIJA_TODAY_SLUG, alongside: record })).id
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const { id } = await this.posts.create(KEKE_ID, text, { communitySlug: NAIJA_TODAY_SLUG, announce: true, alongside: record })
        return id
      } catch (err) {
        if (!(err instanceof AnnouncementTooSoonError)) throw err
        const wait = err.nextAt.getTime() - Date.now()
        if (attempt === 0 && wait <= ANNOUNCEMENT_WAIT_MAX_MS) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait) + 1000))
          continue
        }
        // Should not happen (only Keke posts there, once a day); the news still goes, without the notice.
        this.log.warn(`Naija Today's announcement is not free until ${err.nextAt.toISOString()}; posting the news without it`)
        const { id } = await this.posts.create(KEKE_ID, text, { communitySlug: NAIJA_TODAY_SLUG, alongside: record })
        return id
      }
    }
  }
}
