import { type Db, KEKE_OUTCOMES, kekeBudgetAlerts, kekeUsage, posts } from '@heynaija/db'
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq, gte, sql } from 'drizzle-orm'
import { FeatureFlags } from '../flags/feature-flags.js'
import { LinksService } from '../links/links.service.js'
import { ParentNotFoundError, PostsService, ReplyNotAllowedError } from '../posts/posts.service.js'
import { LIMITS, RateLimiter } from '../rate-limit.js'
import { DB } from '../tokens.js'
import { ANSWER_MAX, ANSWER_SCHEMA, composeReply, type ModelAnswer, modelAnswer, questionPrompt, systemPrompt } from './answer.js'
import { KEKE_ID } from './keke-ids.js'
import { chooseModels, KEKE_MODELS, type KekeModel, type KekeModels, MODEL_NAMES, ModelCallError, type ModelUsage } from './keke-model.js'
import { KNOWLEDGE_PAGES, Knowledge } from './knowledge.js'

/** Most replies Keke writes in one conversation, whoever asks. */
export const PER_CONVERSATION = 3

/** Room for the answer and the model's thinking, which on these models is billed as output. */
const MAX_TOKENS = 8000

export const KEKE_SETTINGS = Symbol('KEKE_SETTINGS')
export type KekeSettings = { siteUrl: string; monthlyBudgetUsd: number }

export const KEKE_ALERTS = Symbol('KEKE_ALERTS')
/** Tells the operators about Keke. Never throws. */
export interface KekeAlerts {
  budgetReached(spentUsd: number, budgetUsd: number): Promise<void>
  /** The day's news draft is waiting for a site moderator on /mod. */
  newsWaiting(day: string, stories: number): Promise<void>
}

export type Outcome = (typeof KEKE_OUTCOMES)[number]

/** What became of a mention. Every one but the first four is silence; `posted` says what was posted. */
export type AnswerResult =
  | { done: 'posted'; outcome: Exclude<Outcome, 'failed' | 'refused'>; replyId: string; model: string }
  | { done: 'gone' | 'already' | 'off' | 'not_allowed' | 'conversation_limit' | 'member_limit' | 'over_budget' | 'no_pages' | 'failed' }

/** This calendar month, UTC: where Keke's spending is counted from. */
const monthStart = sql`(date_trunc('month', now() at time zone 'utc') at time zone 'utc')`

/**
 * Keke's help desk (docs/adr/0030). A post that names @keke is queued by
 * PostsService; this reads it, decides whether Keke may and should answer, asks
 * the model, and posts the reply as Keke. Whenever it may not, or something
 * fails, Keke says nothing and the post is left as it is.
 */
@Injectable()
export class KekeService {
  private readonly log = new Logger('Keke')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Inject(LinksService) private readonly links: Pick<LinksService, 'request'>,
    @Inject(KEKE_MODELS) private readonly models: KekeModels,
    @Inject(Knowledge) private readonly knowledge: Pick<Knowledge, 'pages'>,
    @Inject(KEKE_SETTINGS) private readonly settings: KekeSettings,
    @Inject(KEKE_ALERTS) private readonly alerts: KekeAlerts,
  ) {}

  async answer(postId: string): Promise<AnswerResult> {
    const [post] = await this.db
      .select({ authorId: posts.authorId, text: posts.text, parentId: posts.replyParentId, rootId: posts.rootId })
      .from(posts)
      .where(and(eq(posts.id, postId), sql`${posts.deletedAt} is null and ${posts.removedAt} is null and ${posts.gistId} is null`))
    if (!post || post.authorId === KEKE_ID) return { done: 'gone' }

    const [already] = await this.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.authorId, KEKE_ID), eq(posts.replyParentId, postId)))
      .limit(1)
    if (already) return { done: 'already' }

    // Off for this member, or no model on this server: nothing at all happens.
    if (!(await this.flags.isEnabled('keke', post.authorId))) return { done: 'off' }
    const order = chooseModels(this.models, await this.flags.isEnabled('kekeDeepSeek', post.authorId))
    if (!order.length) return { done: 'off' }

    // What the site lets Keke do: see the post (no block either way, nothing it may not
    // see) and reply under it (the conversation's reply setting).
    const seen = await this.posts.post(KEKE_ID, postId)
    if (!seen?.viewerCanReply) return { done: 'not_allowed' }

    const [conversation] = await this.db.execute<{ n: number }>(sql`
      select count(*)::int as n from posts where author_id = ${KEKE_ID} and root_id = ${post.rootId ?? postId}`).then((r) => r.rows)
    if ((conversation?.n ?? 0) >= PER_CONVERSATION) return { done: 'conversation_limit' }

    if (await this.overBudget()) return { done: 'over_budget' }
    try {
      await this.limits.hit('kekeAsk', post.authorId)
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 429) return { done: 'member_limit' }
      throw err
    }

    const pages = await this.knowledge.pages().catch(() => [])
    if (!pages.length) {
      this.log.warn(`no pages could be read, so Keke did not answer ${postId}`)
      return { done: 'no_pages' }
    }
    const parent = post.parentId ? await this.posts.post(KEKE_ID, post.parentId) : null
    const request = {
      system: systemPrompt(pages),
      user: questionPrompt(post.text, parent && !parent.deleted ? parent.text : null),
      schemaName: 'keke_answer',
      schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: MAX_TOKENS,
    }

    for (const [i, model] of order.entries()) {
      // The cap is checked before every call, the second model's too.
      if (i > 0 && (await this.overBudget())) return { done: 'over_budget' }
      const started = Date.now()
      let answer: ModelAnswer & { usage: ModelUsage }
      try {
        const { json, usage } = await model.ask(request)
        const parsed = modelAnswer.safeParse(json)
        if (!parsed.success) throw new ModelCallError('failed', 'the JSON did not fit the schema', usage)
        answer = { ...parsed.data, usage }
      } catch (err) {
        const failure = err instanceof ModelCallError ? err : new ModelCallError('failed', (err as Error).message)
        await this.record(model, failure.usage, failure.reason, started)
        this.log.warn(`${model.id} via ${model.via} gave no answer for ${postId}: ${failure.message}`)
        continue
      }
      const reply = composeReply(answer, pages, this.settings.siteUrl)
      await this.record(model, answer.usage, reply.outcome, started)
      try {
        const { id, linkUrl } = await this.posts.create(KEKE_ID, reply.text, { replyTo: postId })
        if (linkUrl && (await this.flags.isEnabled('linkPreviews', KEKE_ID))) await this.links.request(linkUrl)
        return { done: 'posted', outcome: reply.outcome, replyId: id, model: model.id }
      } catch (err) {
        // The post went, or its conversation closed to Keke, while the model was thinking.
        if (err instanceof ParentNotFoundError || err instanceof ReplyNotAllowedError) return { done: 'not_allowed' }
        throw err
      }
    }
    return { done: 'failed' }
  }

  /** One call to a model, for the cap and /mod: no member, post or text. */
  async record(model: KekeModel, usage: ModelUsage, outcome: Outcome, started: number, job: 'answer' | 'news' = 'answer'): Promise<void> {
    await this.db.insert(kekeUsage).values({
      job,
      model: model.id,
      via: model.via,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      outcome,
      ms: Date.now() - started,
    })
  }

  /** What Keke's model has cost this calendar month (UTC), in dollars. */
  async spentThisMonth(): Promise<number> {
    const [row] = await this.db
      .select({ spent: sql<number>`coalesce(sum(${kekeUsage.costUsd}), 0)::float8` })
      .from(kekeUsage)
      .where(gte(kekeUsage.createdAt, monthStart))
    return row?.spent ?? 0
  }

  /** At or past the month's cap. The first time in a month, the operators are emailed. */
  async overBudget(): Promise<boolean> {
    const spent = await this.spentThisMonth()
    if (spent < this.settings.monthlyBudgetUsd) return false
    const first = await this.db
      .insert(kekeBudgetAlerts)
      .values({ month: sql`(date_trunc('month', now() at time zone 'utc'))::date` })
      .onConflictDoNothing()
      .returning({ month: kekeBudgetAlerts.month })
    if (first.length) await this.alerts.budgetReached(spent, this.settings.monthlyBudgetUsd)
    return true
  }

  /** Whether Keke can answer at all on this server, and who handles a question: for /about/keke and /privacy. */
  async about(): Promise<KekeAbout> {
    const configured = Boolean(this.models.haiku || this.models.deepseek)
    const [everyone, anyone, deepSeekForAll, deepSeekForAny] = await Promise.all([
      this.flags.isEnabled('keke', null),
      this.flags.onForAnyone('keke'),
      this.flags.isEnabled('kekeDeepSeek', null),
      this.flags.onForAnyone('kekeDeepSeek'),
    ])
    const models = (['haiku', 'deepseek'] as const).flatMap((family) => {
      const model = this.models[family]
      return model ? [{ family, ...MODEL_NAMES[family], via: model.via }] : []
    })
    return {
      live: configured && everyone,
      inUse: configured && anyone,
      models,
      firstChoice: chooseModels(this.models, deepSeekForAll)[0]?.family ?? null,
      trial: Boolean(this.models.haiku && this.models.deepseek) && deepSeekForAny && !deepSeekForAll,
      pages: KNOWLEDGE_PAGES,
      answerMax: ANSWER_MAX,
      perHour: LIMITS.kekeAsk[0]!.max,
      perDay: LIMITS.kekeAsk[1]!.max,
      perConversation: PER_CONVERSATION,
    }
  }

  /** This month's numbers for /mod: by model, how each question went and what it cost. */
  async month(): Promise<KekeMonth> {
    const rows = await this.db
      .select({
        model: kekeUsage.model,
        via: kekeUsage.via,
        outcome: kekeUsage.outcome,
        calls: sql<number>`count(*)::int`,
        costUsd: sql<number>`coalesce(sum(${kekeUsage.costUsd}), 0)::float8`,
      })
      .from(kekeUsage)
      .where(and(eq(kekeUsage.job, 'answer'), gte(kekeUsage.createdAt, monthStart)))
      .groupBy(kekeUsage.model, kekeUsage.via, kekeUsage.outcome)
    const byModel = new Map<string, KekeMonth['models'][number]>()
    for (const row of rows) {
      const key = `${row.model} ${row.via}`
      const entry = byModel.get(key) ?? { model: row.model, name: modelName(row.model), via: row.via, calls: 0, costUsd: 0, outcomes: {} }
      entry.calls += row.calls
      entry.costUsd += row.costUsd
      entry.outcomes[row.outcome] = (entry.outcomes[row.outcome] ?? 0) + row.calls
      byModel.set(key, entry)
    }
    const spentUsd = await this.spentThisMonth()
    return {
      month: new Date().toISOString().slice(0, 7),
      budgetUsd: this.settings.monthlyBudgetUsd,
      spentUsd,
      stopped: spentUsd >= this.settings.monthlyBudgetUsd,
      models: [...byModel.values()].sort((a, b) => b.calls - a.calls),
    }
  }
}

export type KekeAbout = {
  /** On for everyone, with a model: Keke answers anyone who asks. */
  live: boolean
  /** On for anyone at all, a list included: someone's questions are being sent to a model. */
  inUse: boolean
  /** The models this server can use, and who each question is sent to. */
  models: { family: 'haiku' | 'deepseek'; name: string; maker: string; via: 'anthropic' | 'openrouter' }[]
  /** Which model answers a member nobody listed. */
  firstChoice: 'haiku' | 'deepseek' | null
  /** Some members' questions go to DeepSeek and everyone else's to Haiku, to compare them. */
  trial: boolean
  pages: readonly string[]
  answerMax: number
  perHour: number
  perDay: number
  perConversation: number
}

export type KekeMonth = {
  /** YYYY-MM, UTC. */
  month: string
  budgetUsd: number
  spentUsd: number
  /** At the cap: Keke is not answering until next month. */
  stopped: boolean
  models: { model: string; name: string; via: string; calls: number; costUsd: number; outcomes: Partial<Record<Outcome, number>> }[]
}

/** A model's ID as recorded, by the name members know it by; an ID it does not know stays as it is. */
const modelName = (id: string): string =>
  /haiku/i.test(id) ? MODEL_NAMES.haiku.name : /deepseek/i.test(id) ? MODEL_NAMES.deepseek.name : id
