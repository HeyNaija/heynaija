import { type Db, IDEA_KINDS, IDEA_STATUSES, ideas, ideaStatusChanges, ideaVotes, problemDetails } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { notify } from '../notifications/notifications.service.js'
import { POST_MAX_GRAPHEMES, PostsService, postText, visibleAuthor } from '../posts/posts.service.js'
import { cleanLine, cleanLines, graphemes } from '../text.js'
import { DB } from '../tokens.js'

// The board (ADR 0015): ideas for HeyNaija and problems with it, each an
// ordinary post in this community, whose moderators decide what happens to them.
export const BOARD_COMMUNITY = 'building-heynaija'
export const IDEA_TITLE_MAX = 80
const REASON_MAX = 500
const SIMILAR_MAX = 5
const BOARD_PAGE_MAX = 50

export type IdeaKind = (typeof IDEA_KINDS)[number]
export type IdeaStatus = (typeof IDEA_STATUSES)[number]

/** Which statuses each part of the board lists. */
export const IDEA_GROUPS = {
  open: ['under_review', 'planned', 'in_progress'],
  shipped: ['shipped'],
  closed: ['not_now', 'duplicate'],
} as const satisfies Record<string, readonly IdeaStatus[]>
export type IdeaGroup = keyof typeof IDEA_GROUPS
const OPEN: readonly IdeaStatus[] = IDEA_GROUPS.open

/** A new idea or problem as the API receives it. The post is its title, then its details. */
export const newIdea = z
  .object({
    kind: z.enum(IDEA_KINDS),
    title: z
      .string()
      .transform(cleanLine)
      .pipe(z.string().min(1, 'give it a title').refine((t) => graphemes(t) <= IDEA_TITLE_MAX, `a title is at most ${IDEA_TITLE_MAX} characters`)),
    details: z.string().default('').transform(cleanLines),
    // Where a problem happened, as the reporter's browser says. Kept private.
    page: z.string().trim().max(500).optional(),
    browser: z.string().trim().max(500).optional(),
    appVersion: z.string().trim().max(100).optional(),
  })
  .transform((idea) => ({ ...idea, text: idea.details ? `${idea.title}\n\n${idea.details}` : idea.title }))
  .superRefine((idea, ctx) => {
    if (!postText.safeParse(idea.text).success) {
      ctx.addIssue({ code: 'custom', path: ['details'], message: `the title and details together are longer than ${POST_MAX_GRAPHEMES} characters` })
    }
  })
export type NewIdea = z.infer<typeof newIdea>

export const boardQuery = z.object({
  group: z.enum(Object.keys(IDEA_GROUPS) as [IdeaGroup, ...IdeaGroup[]]).default('open'),
  kind: z.enum(IDEA_KINDS).optional(),
  sort: z.enum(['top', 'new']).default('top'),
  limit: z.coerce.number().int().min(1).max(BOARD_PAGE_MAX).default(BOARD_PAGE_MAX),
  // How many the reader has seen. The board is short, and votes move ideas while it is read.
  cursor: z.coerce.number().int().min(0).max(10_000).optional(),
})
export type BoardQuery = z.infer<typeof boardQuery>

export const statusChange = z
  .object({
    status: z.enum(IDEA_STATUSES),
    reason: z
      .string()
      .default('')
      .transform(cleanLines)
      .pipe(z.string().max(REASON_MAX, `a reason is at most ${REASON_MAX} characters`)),
    duplicateOf: z.uuid().optional(),
  })
  .superRefine((change, ctx) => {
    if ((change.status === 'not_now' || change.status === 'duplicate') && !change.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'say why, in public' })
    }
    if ((change.status === 'duplicate') !== !!change.duplicateOf) {
      ctx.addIssue({ code: 'custom', path: ['duplicateOf'], message: 'a duplicate needs the idea it repeats, and only a duplicate has one' })
    }
  })
export type StatusChange = z.infer<typeof statusChange>

export type IdeaSummary = {
  id: string
  kind: IdeaKind
  title: string
  status: IdeaStatus
  /** Members who voted for it, active ones only. */
  votes: number
  viewerVoted: boolean
  replyCount: number
  createdAt: Date
  author: { handle: string; displayName: string | null }
}

export type IdeaDetail = IdeaSummary & {
  statusReason: string | null
  /** A duplicate's original, if the reader may still see it. */
  duplicateOf: { id: string; title: string } | null
  /** Every status it has had, oldest first; the first is its sending. */
  timeline: { status: IdeaStatus; reason: string | null; at: Date }[]
  /** The reader may set its status: they moderate Building HeyNaija, or the whole site. */
  viewerCanModerate: boolean
  /** Where a problem happened. Only for its reporter and the board's moderators. */
  problem: { page: string | null; browser: string | null; appVersion: string | null } | null
}

export type BoardPage = { ideas: IdeaSummary[]; cursor: number | null }

export class IdeaNotFoundError extends Error {}
export class IdeaClosedError extends Error {}
export class NotABoardModeratorError extends Error {}
export class BadDuplicateError extends Error {}

type SummaryRow = {
  id: string
  kind: IdeaKind
  title: string
  status: IdeaStatus
  votes: number
  viewer_voted: boolean
  reply_count: number
  created_at: Date
  author_handle: string
  author_name: string | null
}

const toSummary = (r: SummaryRow): IdeaSummary => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  status: r.status,
  votes: r.votes,
  viewerVoted: r.viewer_voted,
  replyCount: r.reply_count,
  createdAt: new Date(r.created_at),
  author: { handle: r.author_handle, displayName: r.author_name },
})

/** Votes by active members, as the board counts them. */
const votesOf = (postId: SQL) =>
  sql<number>`(select count(*)::int from idea_votes v join members vm on vm.id = v.member_id and vm.active where v.post_id = ${postId})`

@Injectable()
export class IdeasService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PostsService) private readonly posts: PostsService,
  ) {}

  /**
   * Sends an idea or a problem: a post in Building HeyNaija, open to every member
   * whether they joined it or not, with the author's own vote, under review.
   */
  async create(memberId: string, idea: NewIdea): Promise<{ id: string; linkUrl: string | null }> {
    return this.posts.create(memberId, idea.text, {
      communitySlug: BOARD_COMMUNITY,
      anyMember: true,
      alongside: async (tx, id) => {
        await tx.insert(ideas).values({ postId: id, kind: idea.kind, title: idea.title })
        await tx.insert(ideaStatusChanges).values({ postId: id, status: 'under_review' })
        await tx.insert(ideaVotes).values({ postId: id, memberId })
        if (idea.kind === 'problem' && (idea.page || idea.browser || idea.appVersion)) {
          await tx.insert(problemDetails).values({
            postId: id,
            page: idea.page ?? null,
            browser: idea.browser ?? null,
            appVersion: idea.appVersion ?? null,
          })
        }
      },
    })
  }

  /** The select every board read shares: live ideas by authors the viewer can see. */
  private summaries(viewerId: string | null, where: SQL, order: SQL, limit: number, offset = 0) {
    return this.db.execute<SummaryRow>(sql`
      select i.post_id as id, i.kind, i.title, i.status, ${votesOf(sql`i.post_id`)} as votes,
        ${viewerId ? sql`exists(select 1 from idea_votes v where v.post_id = i.post_id and v.member_id = ${viewerId})` : sql`false`} as viewer_voted,
        p.reply_count, p.created_at, a.handle as author_handle, a.display_name as author_name
      from ideas i join posts p on p.id = i.post_id join members a on a.id = p.author_id
      where p.deleted_at is null and p.removed_at is null
        and ${visibleAuthor(viewerId, sql`p.author_id`, sql`a.active`)}
        and ${where}
      order by ${order}
      limit ${limit} offset ${offset}`)
  }

  /** One part of the board: open, shipped or closed; ideas, problems or both; by votes or newest. */
  async board(viewerId: string | null, { group, kind, sort, limit, cursor = 0 }: BoardQuery): Promise<BoardPage> {
    const statuses = sql.join(IDEA_GROUPS[group].map((s) => sql`${s}`), sql`, `)
    const { rows } = await this.summaries(
      viewerId,
      sql`i.status in (${statuses}) ${kind ? sql`and i.kind = ${kind}` : sql``}`,
      sort === 'top' ? sql`votes desc, p.created_at desc, i.post_id desc` : sql`p.created_at desc, i.post_id desc`,
      limit + 1,
      cursor,
    )
    return { ideas: rows.slice(0, limit).map(toSummary), cursor: rows.length > limit ? cursor + limit : null }
  }

  /** Ideas whose title or text has words starting like those in `query`, for someone about to send one. */
  async similar(viewerId: string | null, query: string): Promise<IdeaSummary[]> {
    const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 8)
    if (!words.length) return []
    // Each word as a prefix, any of them: the words are letters and digits only, so they cannot be syntax.
    const terms = words.map((w) => `${w}:*`).join(' | ')
    const document = sql`to_tsvector('simple', i.title || ' ' || p.text)`
    const { rows } = await this.summaries(
      viewerId,
      sql`${document} @@ to_tsquery('simple', ${terms})`,
      sql`ts_rank(${document}, to_tsquery('simple', ${terms})) desc, votes desc, p.created_at desc`,
      SIMILAR_MAX,
    )
    return rows.map(toSummary)
  }

  /** True when `memberId` moderates Building HeyNaija, as one of its moderators or site-wide. */
  private async moderatesBoard(memberId: string): Promise<boolean> {
    const { rows } = await this.db.execute<{ yes: boolean }>(sql`
      select exists(select 1 from members m where m.id = ${memberId} and m.role = 'moderator' and m.active)
        or exists(select 1 from community_memberships cm join communities c on c.id = cm.community_id
          where c.slug = ${BOARD_COMMUNITY} and cm.member_id = ${memberId} and cm.role = 'moderator') as yes`)
    return rows[0]!.yes
  }

  /** An idea with its timeline, as its page shows it. Null when it is not an idea the viewer may see. */
  async get(viewerId: string | null, id: string): Promise<IdeaDetail | null> {
    const [{ rows }, moderates] = await Promise.all([
      this.summaries(viewerId, sql`i.post_id = ${id}`, sql`i.post_id`, 1),
      viewerId ? this.moderatesBoard(viewerId) : false,
    ])
    const row = rows[0]
    if (!row) return null
    const [extra] = (
      await this.db.execute<{
        status_reason: string | null
        duplicate_id: string | null
        duplicate_title: string | null
        author_id: string
      }>(sql`
        select i.status_reason, d.post_id as duplicate_id, d.title as duplicate_title, p.author_id
        from ideas i join posts p on p.id = i.post_id
        left join ideas d on d.post_id = i.duplicate_of
          and exists(select 1 from posts dp join members da on da.id = dp.author_id
            where dp.id = d.post_id and dp.deleted_at is null and dp.removed_at is null
              and ${visibleAuthor(viewerId, sql`dp.author_id`, sql`da.active`)})
        where i.post_id = ${id}`)
    ).rows
    const timeline = await this.db
      .select({ status: ideaStatusChanges.status, reason: ideaStatusChanges.reason, at: ideaStatusChanges.createdAt })
      .from(ideaStatusChanges)
      .where(eq(ideaStatusChanges.postId, id))
      .orderBy(ideaStatusChanges.createdAt, ideaStatusChanges.id)
    const sees = moderates || extra!.author_id === viewerId
    const [problem] =
      row.kind === 'problem' && sees
        ? await this.db
            .select({ page: problemDetails.page, browser: problemDetails.browser, appVersion: problemDetails.appVersion })
            .from(problemDetails)
            .where(eq(problemDetails.postId, id))
        : []
    return {
      ...toSummary(row),
      statusReason: extra!.status_reason,
      duplicateOf: extra!.duplicate_id ? { id: extra!.duplicate_id, title: extra!.duplicate_title! } : null,
      timeline,
      viewerCanModerate: moderates,
      problem: row.kind === 'problem' && sees ? (problem ?? { page: null, browser: null, appVersion: null }) : null,
    }
  }

  /**
   * Adds or takes back `memberId`'s vote. Only open ideas take new votes; a vote
   * can be taken back from any. False when there is no such idea to see.
   */
  async vote(memberId: string, id: string, on: boolean): Promise<boolean> {
    const { rows } = await this.summaries(memberId, sql`i.post_id = ${id}`, sql`i.post_id`, 1)
    const idea = rows[0]
    if (!idea) return false
    if (!on) {
      await this.db.delete(ideaVotes).where(and(eq(ideaVotes.postId, id), eq(ideaVotes.memberId, memberId)))
      return true
    }
    if (!OPEN.includes(idea.status)) throw new IdeaClosedError('this idea is closed to new votes')
    await this.db.insert(ideaVotes).values({ postId: id, memberId }).onConflictDoNothing()
    return true
  }

  /**
   * Sets an idea's status, for Building HeyNaija's moderators. Not now and
   * duplicate need a public reason; a duplicate names its original, and its votes
   * move there. The author and everyone who voted are told. False when there is
   * no such idea to see.
   */
  async setStatus(moderatorId: string, id: string, change: StatusChange): Promise<boolean> {
    if (!(await this.moderatesBoard(moderatorId))) throw new NotABoardModeratorError('only Building HeyNaija’s moderators set statuses')
    const { rows } = await this.summaries(moderatorId, sql`i.post_id = ${id}`, sql`i.post_id`, 1)
    if (!rows[0]) return false
    if (change.duplicateOf) {
      if (change.duplicateOf === id) throw new BadDuplicateError('an idea cannot duplicate itself')
      const { rows: originals } = await this.summaries(moderatorId, sql`i.post_id = ${change.duplicateOf}`, sql`i.post_id`, 1)
      const original = originals[0]
      if (!original) throw new BadDuplicateError('the original idea is not on the board')
      if (original.status === 'duplicate') throw new BadDuplicateError('the original is itself a duplicate; name the idea it repeats')
    }

    await this.db.transaction(async (tx) => {
      // Told before votes move: everyone who voted for this one, and its author.
      const { rows: told } = await tx.execute<{ id: string }>(sql`
        select p.author_id as id from posts p where p.id = ${id}
        union select v.member_id from idea_votes v where v.post_id = ${id}`)
      await tx
        .update(ideas)
        .set({ status: change.status, statusReason: change.reason || null, duplicateOf: change.duplicateOf ?? null })
        .where(eq(ideas.postId, id))
      await tx.insert(ideaStatusChanges).values({ postId: id, status: change.status, reason: change.reason || null, moderatorId })
      if (change.duplicateOf) {
        await tx.execute(sql`
          insert into idea_votes (post_id, member_id, created_at)
          select ${change.duplicateOf}::uuid, v.member_id, v.created_at from idea_votes v where v.post_id = ${id}
          on conflict do nothing`)
        await tx.delete(ideaVotes).where(eq(ideaVotes.postId, id))
      }
      await notify(
        tx,
        told
          .filter((m) => m.id !== moderatorId)
          .map((m) => ({ recipientId: m.id, kind: 'idea_status' as const, postId: id, detail: change.status })),
      )
    })
    return true
  }
}
