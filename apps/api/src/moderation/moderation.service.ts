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
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { avatarPath, MediaService } from '../media/media.service.js'
import { type NewNotification, notify } from '../notifications/notifications.service.js'
import { imagesOf, type PostImage, toPostImages } from '../posts/posts.service.js'
import { DB } from '../tokens.js'

export type ReportReason = Exclude<(typeof REPORT_REASONS)[number], 'appeal'>
export const RESOLUTIONS = [
  'dismiss',
  'remove_post',
  'suspend_member',
  'reinstate_member',
  'remove_avatar',
  'clear_profile',
] as const
export type Resolution = (typeof RESOLUTIONS)[number]

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
  post: { id: string; text: string; images: PostImage[]; authorHandle: string; communityName: string | null } | null
  /** For reports about an account: what the moderator needs to judge it. */
  member: { handle: string; active: boolean; displayName: string | null; bio: string; avatar: string | null } | null
}

export type LogEntry = {
  id: string
  action: string
  note: string
  createdAt: Date
  actorHandle: string
  postId: string | null
  memberHandle: string | null
  /** Role changes: the community concerned. */
  communityName: string | null
}

/** Who moderates each community, for site moderators assigning roles. */
export type ModeratorRoster = { slug: string; name: string; moderators: { handle: string; displayName: string | null }[] }[]

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    // Moves taken-down images out of public view. Optional so tests about
    // decisions alone need no storage.
    @Optional() @Inject(MediaService) private readonly media?: MediaService,
  ) {}

  /**
   * Storage work after a decision is committed. A failure is logged, not thrown:
   * the decision stands and the hourly sweep finishes moving the files.
   */
  private async afterwards(what: string, work: () => Promise<void>): Promise<void> {
    if (!this.media) return
    try {
      await work()
    } catch (err) {
      this.logger.error(`${what} failed; the hourly sweep will retry: ${(err as Error).message}`)
    }
  }

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

  /**
   * The member's most recent appeal, so a suspended member can see whether it is
   * still waiting or was turned down. (An accepted appeal reinstates them, and
   * they hear about that as a notification.)
   */
  async latestAppeal(memberId: string): Promise<{ status: 'open' | 'actioned' | 'dismissed'; createdAt: Date; resolvedAt: Date | null } | null> {
    const [row] = await this.db
      .select({ status: reports.status, createdAt: reports.createdAt, resolvedAt: reports.resolvedAt })
      .from(reports)
      .where(and(eq(reports.reporterId, memberId), eq(reports.reason, 'appeal')))
      .orderBy(desc(reports.createdAt))
      .limit(1)
    return row ?? null
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
      post_images: { id: string; alt: string; width: number; height: number; animated: boolean }[]
      post_author: string | null
      community_name: string | null
      member_handle: string | null
      member_active: boolean | null
      member_name: string | null
      member_bio: string | null
      member_avatar: string | null
    }>(sql`
      select r.id, r.reason, r.details, r.created_at, rep.handle as reporter_handle,
        (select count(*)::int from reports o where o.status = 'open'
          and ((r.post_id is not null and o.post_id = r.post_id)
            or (r.post_id is null and o.post_id is null and o.member_id = r.member_id))) as report_count,
        p.id as post_id, p.text as post_text, ${imagesOf(sql`p.id`)} as post_images, pa.handle as post_author, c.name as community_name,
        tm.handle as member_handle, tm.active as member_active, tm.display_name as member_name,
        tm.bio as member_bio, tm.avatar_media_id as member_avatar
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
        ? { id: r.post_id, text: r.post_text!, images: toPostImages(r.post_images), authorHandle: r.post_author!, communityName: r.community_name }
        : null,
      member: r.member_handle
        ? {
            handle: r.member_handle,
            active: r.member_active!,
            displayName: r.member_name,
            bio: r.member_bio ?? '',
            avatar: avatarPath(r.member_avatar),
          }
        : null,
    }))
  }

  /**
   * Decides a report. Every other open report about the same post or account is
   * closed with it, and the decision is written to the log.
   */
  async resolve(moderatorId: string, reportId: string, resolution: Resolution, note = ''): Promise<void> {
    const scope = await this.requireModerator(moderatorId)

    let removedAvatar: string | null = null
    let removedPost: string | null = null

    await this.db.transaction(async (tx) => {
      const [report] = await tx
        .select({
          id: reports.id,
          reason: reports.reason,
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
        removedPost = report.postId
      } else if (resolution === 'remove_avatar' || resolution === 'clear_profile') {
        // Changing someone's profile is for site moderators only, like suspension.
        if (!scope.siteWide) throw new NotAModeratorError()
        if (!report.memberId) throw new ModerationTargetError('this report is not about an account')
        const [target] = await tx
          .select({ avatarMediaId: members.avatarMediaId })
          .from(members)
          .where(eq(members.id, report.memberId))
          .for('update')
        if (resolution === 'remove_avatar') {
          if (!target?.avatarMediaId) throw new ModerationTargetError('that account has no profile photo')
          await tx.update(members).set({ avatarMediaId: null }).where(eq(members.id, report.memberId))
          removedAvatar = target.avatarMediaId
        } else {
          await tx.update(members).set({ displayName: null, bio: '' }).where(eq(members.id, report.memberId))
        }
        action = resolution
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
      const closed = await tx
        .update(reports)
        .set({ status: resolution === 'dismiss' ? 'dismissed' : 'actioned', resolvedAt: new Date(), resolvedBy: moderatorId })
        .where(and(eq(reports.status, 'open'), or(eq(reports.id, report.id), sameTarget)))
        .returning({ reporterId: reports.reporterId, reason: reports.reason })

      // Tell the people affected. A suspended member cannot read notifications, so
      // suspension and a rejected appeal show on their account page instead.
      const told: NewNotification[] = []
      if (action === 'remove_post' && report.postAuthorId) {
        told.push({ recipientId: report.postAuthorId, kind: 'post_removed', postId: report.postId, detail: report.reason })
      }
      if (action === 'reinstate_member' && targetMemberId) {
        told.push({ recipientId: targetMemberId, kind: 'account_reinstated' })
      }
      if ((action === 'remove_avatar' || action === 'clear_profile') && targetMemberId) {
        told.push({ recipientId: targetMemberId, kind: action === 'remove_avatar' ? 'avatar_removed' : 'profile_cleared' })
      }
      const reporters = new Set(closed.filter((r) => r.reason !== 'appeal').map((r) => r.reporterId))
      for (const reporterId of reporters) {
        told.push({
          recipientId: reporterId,
          kind: 'report_resolved',
          postId: report.postId,
          subjectId: report.postId ? null : report.memberId,
          detail: resolution === 'dismiss' ? 'dismissed' : 'actioned',
        })
      }
      await notify(tx, told)

      await tx.insert(moderationActions).values({
        actorId: moderatorId,
        action,
        postId: report.postId,
        memberId: targetMemberId,
        reportId: report.id,
        note,
      })
    })

    if (removedPost) {
      const postId = removedPost
      await this.afterwards(`quarantining images of post ${postId}`, () => this.media!.quarantinePostImages(postId))
    }
    if (removedAvatar) {
      const mediaId = removedAvatar
      await this.afterwards(`quarantining profile photo ${mediaId}`, () => this.media!.quarantineAvatar(mediaId))
    }
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
      .returning({ authorId: posts.authorId })
    if (restored.length === 0) throw new ModerationTargetError('that post is not removed')
    await this.db.insert(moderationActions).values({ actorId: moderatorId, action: 'restore_post', postId, note })
    await notify(this.db, [{ recipientId: restored[0]!.authorId, kind: 'post_restored', postId }])
    await this.afterwards(`releasing images of post ${postId}`, () => this.media!.releasePostImages(postId))
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
    if (!suspended) await notify(this.db, [{ recipientId: target.id, kind: 'account_reinstated' }])
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
      community_name: string | null
    }>(sql`
      select a.id, a.action, a.note, a.created_at, actor.handle as actor_handle, a.post_id, tm.handle as member_handle,
        c.name as community_name
      from moderation_actions a
      join members actor on actor.id = a.actor_id
      left join members tm on tm.id = a.member_id
      left join communities c on c.id = a.community_id
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
      communityName: r.community_name,
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

  /**
   * A site moderator makes someone a community moderator, or stops them being
   * one. Logged, and the member is told. Site-wide roles are not assignable here:
   * they stay a command-line job for whoever runs the service.
   */
  async assignCommunityModerator(actorId: string, handle: string, slug: string, on: boolean, note = ''): Promise<void> {
    if (!(await this.requireModerator(actorId)).siteWide) throw new NotAModeratorError()
    const memberId = await this.memberIdForHandle(handle)
    const [community] = await this.db
      .select({
        id: communities.id,
        isModerator: sql<boolean>`exists(select 1 from community_memberships cm where cm.community_id = "communities"."id" and cm.member_id = ${memberId} and cm.role = 'moderator')`,
      })
      .from(communities)
      .where(and(eq(communities.slug, slug), eq(communities.active, true)))
    if (!community) throw new ModerationTargetError(`no community "${slug}"`)
    if (community.isModerator === on) {
      throw new ModerationTargetError(on ? `@${handle} already moderates it` : `@${handle} does not moderate it`)
    }
    const [target] = await this.db.select({ active: members.active }).from(members).where(eq(members.id, memberId))
    if (on && !target?.active) throw new ModerationTargetError('a suspended account cannot be a moderator')

    await this.setCommunityModerator(handle, slug, on)
    await this.db.insert(moderationActions).values({
      actorId,
      action: on ? 'grant_community_moderator' : 'revoke_community_moderator',
      memberId,
      communityId: community.id,
      note,
    })
    await notify(this.db, [
      { recipientId: memberId, kind: on ? 'moderator_granted' : 'moderator_revoked', communityId: community.id },
    ])
  }

  /** Every active community and its moderators. Site moderators only. */
  async moderatorRoster(actorId: string): Promise<ModeratorRoster> {
    if (!(await this.requireModerator(actorId)).siteWide) throw new NotAModeratorError()
    const { rows } = await this.db.execute<{
      slug: string
      name: string
      moderators: { handle: string; displayName: string | null }[]
    }>(sql`
      select c.slug, c.name,
        coalesce((select json_agg(json_build_object('handle', m.handle, 'displayName', m.display_name) order by m.handle)
          from community_memberships cm join members m on m.id = cm.member_id and m.active
          where cm.community_id = c.id and cm.role = 'moderator'), '[]'::json) as moderators
      from communities c
      where c.active
      order by c.name`)
    return rows
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
