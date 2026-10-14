import {
  communities,
  communityMemberships,
  type Db,
  members,
  moderationActions,
  posts,
  REPORT_REASONS,
  reports,
} from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { DB } from '../tokens.js'

export type ReportReason = Exclude<(typeof REPORT_REASONS)[number], 'appeal'>
export type Resolution = 'dismiss' | 'remove_post' | 'suspend_member' | 'reinstate_member'

export class NotAModeratorError extends Error {}
export class ModerationTargetError extends Error {}

/** What a moderator may act on: everything, or only posts in certain communities. */
export type Scope = { siteWide: boolean; communityIds: string[] }

export type QueueItem = {
  id: string
  reason: (typeof REPORT_REASONS)[number]
  details: string
  createdAt: Date
  reporterHandle: string
  /** How many open reports there are about the same post or account. */
  reportCount: number
  post: { id: string; text: string; authorHandle: string; communityName: string | null } | null
  member: { handle: string; active: boolean } | null
}

export type LogEntry = {
  id: string
  action: string
  note: string
  createdAt: Date
  actorHandle: string
  postId: string | null
  memberHandle: string | null
}

@Injectable()
export class ModerationService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async scope(memberId: string): Promise<Scope> {
    const [[member], moderated] = await Promise.all([
      this.db.select({ role: members.role }).from(members).where(eq(members.id, memberId)),
      this.db
        .select({ id: communityMemberships.communityId })
        .from(communityMemberships)
        .innerJoin(communities, eq(communities.id, communityMemberships.communityId))
        .where(
          and(
            eq(communityMemberships.memberId, memberId),
            eq(communityMemberships.role, 'moderator'),
            eq(communities.active, true),
          ),
        ),
    ])
    return { siteWide: member?.role === 'moderator', communityIds: moderated.map((c) => c.id) }
  }

  private async requireModerator(memberId: string): Promise<Scope> {
    const scope = await this.scope(memberId)
    if (!scope.siteWide && scope.communityIds.length === 0) throw new NotAModeratorError()
    return scope
  }

  /**
   * Files a report about a post or an account. Reporting the same thing again
   * while the first report is still open changes nothing.
   */
  async report(
    reporterId: string,
    target: { postId: string } | { handle: string },
    reason: ReportReason,
    details = '',
  ): Promise<void> {
    let postId: string | null = null
    let memberId: string | null = null

    if ('postId' in target) {
      const [post] = await this.db
        .select({ id: posts.id, authorId: posts.authorId })
        .from(posts)
        .where(and(eq(posts.id, target.postId), isNull(posts.deletedAt), isNull(posts.removedAt)))
      if (!post) throw new ModerationTargetError('that post is no longer available')
      if (post.authorId === reporterId) throw new ModerationTargetError('you cannot report your own post')
      postId = post.id
    } else {
      const [member] = await this.db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.handle, target.handle), eq(members.active, true)))
        .orderBy(sql`${members.lastSeenAt} desc nulls last`)
        .limit(1)
      if (!member) throw new ModerationTargetError('that member is no longer available')
      if (member.id === reporterId) throw new ModerationTargetError('you cannot report yourself')
      memberId = member.id
    }

    const [existing] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, reporterId),
          eq(reports.status, 'open'),
          postId ? eq(reports.postId, postId) : eq(reports.memberId, memberId!),
        ),
      )
    if (existing) return
    await this.db.insert(reports).values({ reporterId, postId, memberId, reason, details })
  }

  /** A suspended member asks for the decision to be looked at again. One open appeal at a time. */
  async appeal(memberId: string, message: string): Promise<void> {
    const [member] = await this.db.select({ active: members.active }).from(members).where(eq(members.id, memberId))
    if (!member || member.active) throw new ModerationTargetError('only a suspended account can appeal')

    const [existing] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.reporterId, memberId), eq(reports.reason, 'appeal'), eq(reports.status, 'open')))
    if (existing) return
    await this.db.insert(reports).values({ reporterId: memberId, memberId, reason: 'appeal', details: message })
  }

  /** Open reports this moderator may act on, oldest first. */
  async queue(moderatorId: string): Promise<QueueItem[]> {
    const scope = await this.requireModerator(moderatorId)
    const rows = await this.db.execute<{
      id: string
      reason: QueueItem['reason']
      details: string
      created_at: Date
      reporter_handle: string
      report_count: number
      post_id: string | null
      post_text: string | null
      post_author: string | null
      community_name: string | null
      member_handle: string | null
      member_active: boolean | null
    }>(sql`
      select r.id, r.reason, r.details, r.created_at, rep.handle as reporter_handle,
        (select count(*)::int from reports o where o.status = 'open'
          and ((r.post_id is not null and o.post_id = r.post_id)
            or (r.post_id is null and o.post_id is null and o.member_id = r.member_id))) as report_count,
        p.id as post_id, p.text as post_text, pa.handle as post_author, c.name as community_name,
        tm.handle as member_handle, tm.active as member_active
      from reports r
      join members rep on rep.id = r.reporter_id
      left join posts p on p.id = r.post_id
      left join members pa on pa.id = p.author_id
      left join communities c on c.id = p.community_id
      left join members tm on tm.id = r.member_id
      where r.status = 'open'
        and (${scope.siteWide} or p.community_id in ${scope.communityIds.length ? sql`(${sql.join(scope.communityIds.map((id) => sql`${id}`), sql`, `)})` : sql`(null)`})
      order by r.created_at asc
      limit 200`)

    return rows.rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      details: r.details,
      createdAt: new Date(r.created_at),
      reporterHandle: r.reporter_handle,
      reportCount: r.report_count,
      post: r.post_id
        ? { id: r.post_id, text: r.post_text!, authorHandle: r.post_author!, communityName: r.community_name }
        : null,
      member: r.member_handle ? { handle: r.member_handle, active: r.member_active! } : null,
    }))
  }

  /**
   * Decides a report. Every other open report about the same post or account is
   * closed with it, and the decision is written to the log.
   */
  async resolve(moderatorId: string, reportId: string, resolution: Resolution, note = ''): Promise<void> {
    const scope = await this.requireModerator(moderatorId)

    await this.db.transaction(async (tx) => {
      const [report] = await tx
        .select({
          id: reports.id,
          postId: reports.postId,
          memberId: reports.memberId,
          postAuthorId: posts.authorId,
          postCommunityId: posts.communityId,
        })
        .from(reports)
        .leftJoin(posts, eq(posts.id, reports.postId))
        .where(and(eq(reports.id, reportId), eq(reports.status, 'open')))
        .for('update', { of: reports })
      if (!report) throw new ModerationTargetError('that report is already resolved')

      const inScope =
        scope.siteWide || (report.postCommunityId !== null && scope.communityIds.includes(report.postCommunityId))
      if (!inScope) throw new NotAModeratorError()

      const targetMemberId = report.memberId ?? report.postAuthorId
      let action: (typeof moderationActions.$inferInsert)['action']

      if (resolution === 'dismiss') {
        action = 'dismiss_report'
      } else if (resolution === 'remove_post') {
        if (!report.postId) throw new ModerationTargetError('this report is not about a post')
        await tx.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, report.postId))
        action = 'remove_post'
      } else {
        // Suspending and reinstating accounts is for site moderators only.
        if (!scope.siteWide) throw new NotAModeratorError()
        if (!targetMemberId) throw new ModerationTargetError('this report has no account to act on')
        const suspend = resolution === 'suspend_member'
        if (suspend) await this.assertSuspendable(tx, moderatorId, targetMemberId)
        await tx
          .update(members)
          .set(suspend ? { active: false, status: 'suspended' } : { active: true, status: null })
          .where(eq(members.id, targetMemberId))
        action = suspend ? 'suspend_member' : 'reinstate_member'
      }

      const sameTarget = report.postId
        ? eq(reports.postId, report.postId)
        : and(isNull(reports.postId), eq(reports.memberId, report.memberId!))
      await tx
        .update(reports)
        .set({ status: resolution === 'dismiss' ? 'dismissed' : 'actioned', resolvedAt: new Date(), resolvedBy: moderatorId })
        .where(and(eq(reports.status, 'open'), or(eq(reports.id, report.id), sameTarget)))

      await tx.insert(moderationActions).values({
        actorId: moderatorId,
        action,
        postId: report.postId,
        memberId: targetMemberId,
        reportId: report.id,
        note,
      })
    })
  }

  private async assertSuspendable(tx: Pick<Db, 'select'>, moderatorId: string, targetId: string): Promise<void> {
    if (targetId === moderatorId) throw new ModerationTargetError('you cannot suspend yourself')
    const [target] = await tx.select({ role: members.role }).from(members).where(eq(members.id, targetId))
    // A site moderator has to be demoted (pnpm mod:revoke) before they can be suspended.
    if (target?.role === 'moderator') throw new ModerationTargetError('site moderators cannot be suspended')
  }

  /** Puts back a post a moderator took down. Site moderators only. */
  async restorePost(moderatorId: string, postId: string, note = ''): Promise<void> {
    if (!(await this.requireModerator(moderatorId)).siteWide) throw new NotAModeratorError()
    const restored = await this.db
      .update(posts)
      .set({ removedAt: null })
      .where(and(eq(posts.id, postId), sql`${posts.removedAt} is not null`))
      .returning({ id: posts.id })
    if (restored.length === 0) throw new ModerationTargetError('that post is not removed')
    await this.db.insert(moderationActions).values({ actorId: moderatorId, action: 'restore_post', postId, note })
  }

  /** Suspends or reinstates an account directly, without a report. Site moderators only. */
  async setSuspended(moderatorId: string, handle: string, suspended: boolean, note = ''): Promise<void> {
    if (!(await this.requireModerator(moderatorId)).siteWide) throw new NotAModeratorError()
    const [target] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.handle, handle), eq(members.active, suspended)))
      .orderBy(sql`${members.lastSeenAt} desc nulls last`)
      .limit(1)
    if (!target) throw new ModerationTargetError(suspended ? 'no active member with that handle' : 'no suspended member with that handle')
    if (suspended) await this.assertSuspendable(this.db, moderatorId, target.id)

    await this.db
      .update(members)
      .set(suspended ? { active: false, status: 'suspended' } : { active: true, status: null })
      .where(eq(members.id, target.id))
    await this.db.insert(moderationActions).values({
      actorId: moderatorId,
      action: suspended ? 'suspend_member' : 'reinstate_member',
      memberId: target.id,
      note,
    })
  }

  /** Recent decisions. Community moderators see only their own. */
  async log(moderatorId: string, limit = 50): Promise<LogEntry[]> {
    const scope = await this.requireModerator(moderatorId)
    const rows = await this.db.execute<{
      id: string
      action: string
      note: string
      created_at: Date
      actor_handle: string
      post_id: string | null
      member_handle: string | null
    }>(sql`
      select a.id, a.action, a.note, a.created_at, actor.handle as actor_handle, a.post_id, tm.handle as member_handle
      from moderation_actions a
      join members actor on actor.id = a.actor_id
      left join members tm on tm.id = a.member_id
      where ${scope.siteWide} or a.actor_id = ${moderatorId}
      order by a.created_at desc
      limit ${limit}`)
    return rows.rows.map((r) => ({
      id: r.id,
      action: r.action,
      note: r.note,
      createdAt: new Date(r.created_at),
      actorHandle: r.actor_handle,
      postId: r.post_id,
      memberHandle: r.member_handle,
    }))
  }

  // --- Roles (used by the mod:grant / mod:revoke commands; there is no UI for this) ---

  private async memberIdForHandle(handle: string): Promise<string> {
    const [member] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.handle, handle))
      .orderBy(sql`${members.lastSeenAt} desc nulls last`)
      .limit(1)
    if (!member) throw new ModerationTargetError(`no member @${handle} (they must have signed in at least once)`)
    return member.id
  }

  async setSiteModerator(handle: string, on: boolean): Promise<void> {
    const id = await this.memberIdForHandle(handle)
    await this.db.update(members).set({ role: on ? 'moderator' : 'member' }).where(eq(members.id, id))
  }

  /** Granting also joins the member to the community if they had not already. */
  async setCommunityModerator(handle: string, slug: string, on: boolean): Promise<void> {
    const memberId = await this.memberIdForHandle(handle)
    const [community] = await this.db.select({ id: communities.id }).from(communities).where(eq(communities.slug, slug))
    if (!community) throw new ModerationTargetError(`no community "${slug}"`)

    if (on) {
      await this.db
        .insert(communityMemberships)
        .values({ communityId: community.id, memberId, role: 'moderator' })
        .onConflictDoUpdate({
          target: [communityMemberships.communityId, communityMemberships.memberId],
          set: { role: 'moderator' },
        })
    } else {
      await this.db
        .update(communityMemberships)
        .set({ role: 'member' })
        .where(and(eq(communityMemberships.communityId, community.id), eq(communityMemberships.memberId, memberId)))
    }
  }
}
