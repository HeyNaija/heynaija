import {
  communities,
  communityMemberships,
  type Db,
  gistMembers,
  gistReportParticipants,
  gists,
  members,
  moderationActions,
  posts,
  REPORT_REASONS,
  reports,
} from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { GistsService } from '../gists/gists.service.js'
import { avatarPath, MediaService } from '../media/media.service.js'
import { type NewNotification, notify } from '../notifications/notifications.service.js'
import { imagesOf, type PostImage, toPostImages } from '../posts/posts.service.js'
import { DB } from '../tokens.js'
import { SAFETY_ALERTS, type SafetyAlerts } from './safety-alerts.js'

export type ReportReason = Exclude<(typeof REPORT_REASONS)[number], 'appeal'>
export const RESOLUTIONS = [
  'dismiss',
  'remove_post',
  'suspend_member',
  'reinstate_member',
  'remove_avatar',
  'clear_profile',
  'end_gist',
] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export class NotAModeratorError extends Error {}
export class ModerationTargetError extends Error {}

// Reinstating lifts the suspension, but an account waiting to be deleted stays
// off the site until its owner cancels the deletion (docs/adr/0016).
const reinstated = { active: sql<boolean>`${members.deletionRequestedAt} is null`, status: null }

/** What a moderator may act on: everything, or only posts in certain communities. */
export type Scope = { siteWide: boolean; communityIds: string[] }

export type QueueItem = {
  id: string
  reason: (typeof REPORT_REASONS)[number]
  details: string
  createdAt: Date
  /** Null when the upload scanner filed it. */
  reporterHandle: string | null
  /** How many open reports there are about the same post or account. */
  reportCount: number
  post: { id: string; text: string; images: PostImage[]; authorHandle: string; communityName: string | null } | null
  /** For reports about an account: what the moderator needs to judge it. */
  member: { handle: string; active: boolean; displayName: string | null; bio: string; avatar: string | null } | null
  /** For reports about a Gist: what it was, and who was in it when it was reported. There is no audio. */
  gist: {
    id: string
    title: string
    status: 'scheduled' | 'live' | 'ended'
    hostHandle: string
    communityName: string | null
    startedAt: Date | null
    participants: { handle: string; role: string }[]
  } | null
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
  /** Ending a Gist: its title. */
  gistTitle: string | null
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
    @Optional() @Inject(SAFETY_ALERTS) private readonly alerts?: SafetyAlerts,
    // Ends a reported Gist. Optional so tests of other decisions need no LiveKit.
    @Optional() @Inject(GistsService) private readonly gists?: Pick<GistsService, 'endNow'>,
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
   * Files a report about a post, an account or a Gist. Reporting the same thing
   * again while the first report is still open changes nothing.
   */
  async report(
    reporterId: string,
    target: { postId: string } | { handle: string } | { gistId: string },
    reason: ReportReason,
    details = '',
  ): Promise<void> {
    if ('gistId' in target) return this.reportGist(reporterId, target.gistId, reason, details)
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
    // Illegal content may need taking down and reporting quickly, so a person
    // hears about it rather than waiting for a moderator to open the queue.
    if (reason === 'illegal') {
      await this.alerts?.alert('A member reported illegal content', [
        postId ? `A post (${postId}) was reported as illegal.` : `An account (${memberId}) was reported as illegal.`,
        'Illegal-content reports are at the top of the moderation queue.',
      ])
    }
  }

  /**
   * A report about a Gist (docs/adr/0017). Only someone who has been in it may
   * report it, and not its host. It records who is in the Gist at that moment,
   * the evidence a moderator decides on, since no audio is kept.
   */
  private async reportGist(reporterId: string, gistId: string, reason: ReportReason, details: string): Promise<void> {
    const [gist] = await this.db
      .select({ hostId: gists.hostId, inside: gistMembers.joinedAt })
      .from(gists)
      .leftJoin(gistMembers, and(eq(gistMembers.gistId, gists.id), eq(gistMembers.memberId, reporterId)))
      .where(eq(gists.id, gistId))
    // The same answer for a Gist that does not exist as for one they were never in.
    if (!gist || !gist.inside) throw new ModerationTargetError('you can only report a Gist you have been in')
    if (gist.hostId === reporterId) throw new ModerationTargetError('you cannot report your own Gist')

    const [existing] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.reporterId, reporterId), eq(reports.status, 'open'), eq(reports.gistId, gistId)))
    if (existing) return
    await this.db.transaction(async (tx) => {
      const [report] = await tx.insert(reports).values({ reporterId, gistId, reason, details }).returning({ id: reports.id })
      // In the room now: joined, not left, not removed.
      await tx.execute(sql`
        insert into ${gistReportParticipants} (report_id, member_id, role)
        select ${report!.id}, gm.member_id, gm.role from ${gistMembers} gm
        where gm.gist_id = ${gistId} and gm.joined_at is not null and gm.left_at is null and gm.removed_at is null`)
    })
    if (reason === 'illegal') {
      await this.alerts?.alert('A member reported illegal content', [
        `A Gist (${gistId}) was reported as illegal.`,
        'Illegal-content reports are at the top of the moderation queue.',
      ])
    }
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

  /**
   * A suspended member asks for the decision to be looked at again. One open
   * appeal at a time. Not while the account is waiting to be deleted: they can
   * cancel the deletion first (docs/adr/0016).
   */
  async appeal(memberId: string, message: string): Promise<void> {
    const [member] = await this.db
      .select({ active: members.active, deletionRequestedAt: members.deletionRequestedAt })
      .from(members)
      .where(eq(members.id, memberId))
    if (member?.deletionRequestedAt) {
      throw new ModerationTargetError('an account waiting to be deleted cannot appeal; cancel the deletion first')
    }
    if (!member || member.active) throw new ModerationTargetError('only a suspended account can appeal')

    const [existing] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.reporterId, memberId), eq(reports.reason, 'appeal'), eq(reports.status, 'open')))
    if (existing) return
    await this.db.insert(reports).values({ reporterId: memberId, memberId, reason: 'appeal', details: message })
  }

  /** Open reports this moderator may act on: illegal content first, then oldest first. */
  async queue(moderatorId: string): Promise<QueueItem[]> {
    const scope = await this.requireModerator(moderatorId)
    const rows = await this.db.execute<{
      id: string
      reason: QueueItem['reason']
      details: string
      created_at: Date
      reporter_handle: string | null
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
      gist_id: string | null
      gist_title: string | null
      gist_status: 'scheduled' | 'live' | 'ended' | null
      gist_host: string | null
      gist_community: string | null
      gist_started_at: Date | null
      gist_participants: { handle: string; role: string }[] | null
    }>(sql`
      select r.id, r.reason, r.details, r.created_at, rep.handle as reporter_handle,
        (select count(*)::int from reports o where o.status = 'open'
          and ((r.post_id is not null and o.post_id = r.post_id)
            or (r.gist_id is not null and o.gist_id = r.gist_id)
            or (r.post_id is null and r.gist_id is null and o.post_id is null and o.gist_id is null
              and o.member_id = r.member_id))) as report_count,
        p.id as post_id, p.text as post_text, ${imagesOf(sql`p.id`)} as post_images, pa.handle as post_author, c.name as community_name,
        tm.handle as member_handle, tm.active as member_active, tm.display_name as member_name,
        tm.bio as member_bio, tm.avatar_media_id as member_avatar,
        g.id as gist_id, g.title as gist_title, g.status as gist_status, gh.handle as gist_host, gc.name as gist_community,
        g.started_at as gist_started_at,
        case when g.id is null then null else (
          select coalesce(json_agg(json_build_object('handle', pm.handle, 'role', grp.role)
            order by grp.role = 'host' desc, grp.role = 'cohost' desc, grp.role = 'speaker' desc, pm.handle), '[]'::json)
          from gist_report_participants grp join members pm on pm.id = grp.member_id
          where grp.report_id = r.id) end as gist_participants
      from reports r
      left join members rep on rep.id = r.reporter_id
      left join posts p on p.id = r.post_id
      left join members pa on pa.id = p.author_id
      left join communities c on c.id = p.community_id
      left join members tm on tm.id = r.member_id
      left join gists g on g.id = r.gist_id
      left join members gh on gh.id = g.host_id
      left join communities gc on gc.id = g.community_id
      where r.status = 'open'
        and (${scope.siteWide} or coalesce(p.community_id, g.community_id) in ${scope.communityIds.length ? sql`(${sql.join(scope.communityIds.map((id) => sql`${id}`), sql`, `)})` : sql`(null)`})
      order by r.reason = 'illegal' desc, r.created_at asc
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
      gist: r.gist_id
        ? {
            id: r.gist_id,
            title: r.gist_title!,
            status: r.gist_status!,
            hostHandle: r.gist_host!,
            communityName: r.gist_community,
            startedAt: r.gist_started_at ? new Date(r.gist_started_at) : null,
            participants: r.gist_participants ?? [],
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
    // A Gist is ended before the decision is written, so a LiveKit failure leaves
    // the report open to try again (GistsService.endNow).
    if (resolution === 'end_gist') await this.endReportedGist(scope, reportId)

    let removedAvatar: string | null = null
    let removedPost: string | null = null

    await this.db.transaction(async (tx) => {
      const [report] = await tx
        .select({
          id: reports.id,
          reason: reports.reason,
          postId: reports.postId,
          memberId: reports.memberId,
          gistId: reports.gistId,
          postAuthorId: posts.authorId,
          postCommunityId: posts.communityId,
          gistCommunityId: gists.communityId,
        })
        .from(reports)
        .leftJoin(posts, eq(posts.id, reports.postId))
        .leftJoin(gists, eq(gists.id, reports.gistId))
        .where(and(eq(reports.id, reportId), eq(reports.status, 'open')))
        .for('update', { of: reports })
      if (!report) throw new ModerationTargetError('that report is already resolved')

      const community = report.postCommunityId ?? report.gistCommunityId
      const inScope = scope.siteWide || (community !== null && scope.communityIds.includes(community))
      if (!inScope) throw new NotAModeratorError()

      const targetMemberId = report.memberId ?? report.postAuthorId
      let action: (typeof moderationActions.$inferInsert)['action']

      if (resolution === 'dismiss') {
        action = 'dismiss_report'
      } else if (resolution === 'end_gist') {
        // Ended already, by endReportedGist.
        if (!report.gistId) throw new ModerationTargetError('this report is not about a Gist')
        action = 'end_gist'
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
          .set(suspend ? { active: false, status: 'suspended' } : reinstated)
          .where(eq(members.id, targetMemberId))
        action = suspend ? 'suspend_member' : 'reinstate_member'
      }

      const sameTarget = report.postId
        ? eq(reports.postId, report.postId)
        : report.gistId
          ? eq(reports.gistId, report.gistId)
          : and(isNull(reports.postId), isNull(reports.gistId), eq(reports.memberId, report.memberId!))
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
      const reporters = new Set(
        closed.flatMap((r) => (r.reason !== 'appeal' && r.reporterId ? [r.reporterId] : [])),
      )
      for (const reporterId of reporters) {
        told.push({
          recipientId: reporterId,
          kind: 'report_resolved',
          postId: report.postId,
          subjectId: report.postId ? null : report.memberId,
          // A Gist report names no post or member, so the wording needs telling apart.
          detail: `${report.gistId ? 'gist_' : ''}${resolution === 'dismiss' ? 'dismissed' : 'actioned'}`,
        })
      }
      await notify(tx, told)

      await tx.insert(moderationActions).values({
        actorId: moderatorId,
        action,
        postId: report.postId,
        memberId: targetMemberId,
        reportId: report.id,
        gistId: report.gistId,
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

  /** Ends the Gist a report is about, if this moderator may decide that report. */
  private async endReportedGist(scope: Scope, reportId: string): Promise<void> {
    const [report] = await this.db
      .select({ gistId: reports.gistId, communityId: gists.communityId, status: gists.status })
      .from(reports)
      .leftJoin(gists, eq(gists.id, reports.gistId))
      .where(and(eq(reports.id, reportId), eq(reports.status, 'open')))
    if (!report) throw new ModerationTargetError('that report is already resolved')
    if (!report.gistId) throw new ModerationTargetError('this report is not about a Gist')
    if (!scope.siteWide && !(report.communityId !== null && scope.communityIds.includes(report.communityId))) {
      throw new NotAModeratorError()
    }
    if (report.status === 'ended') return
    if (!this.gists) throw new ModerationTargetError('Gists are not running here')
    await this.gists.endNow(report.gistId)
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

  /**
   * Suspends or reinstates an account directly, without a report. Site
   * moderators only. An account waiting to be deleted can be suspended too, so
   * cancelling the deletion does not bring it back (docs/adr/0016).
   */
  async setSuspended(moderatorId: string, handle: string, suspended: boolean, note = ''): Promise<void> {
    if (!(await this.requireModerator(moderatorId)).siteWide) throw new NotAModeratorError()
    const [target] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.handle, handle),
          isNull(members.deletedAt),
          suspended ? sql`${members.status} is distinct from 'suspended'` : eq(members.status, 'suspended'),
        ),
      )
      .orderBy(sql`${members.lastSeenAt} desc nulls last`)
      .limit(1)
    if (!target) throw new ModerationTargetError(suspended ? 'no active member with that handle' : 'no suspended member with that handle')
    if (suspended) await this.assertSuspendable(this.db, moderatorId, target.id)

    await this.db
      .update(members)
      .set(suspended ? { active: false, status: 'suspended' } : reinstated)
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
      gist_title: string | null
    }>(sql`
      select a.id, a.action, a.note, a.created_at, actor.handle as actor_handle, a.post_id, tm.handle as member_handle,
        c.name as community_name, g.title as gist_title
      from moderation_actions a
      join members actor on actor.id = a.actor_id
      left join members tm on tm.id = a.member_id
      left join communities c on c.id = a.community_id
      left join gists g on g.id = a.gist_id
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
      gistTitle: r.gist_title,
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
