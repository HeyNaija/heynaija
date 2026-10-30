import {
  ageAssurances,
  type Db,
  governanceAuditLog,
  identityVerifications,
  members,
  privacyRequests,
  PRIVACY_REQUEST_STATUSES,
} from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { AuthService } from '../auth/auth.service.js'
import { EMAIL_ADDRESSES, type EmailAddresses } from '../email/addresses.js'
import type { Env } from '../env.js'
import { MediaService } from '../media/media.service.js'
import { HANDLE_HOLD_DAYS, MembersService } from '../members/members.service.js'
import { DB, ENV } from '../tokens.js'

const DAY_MS = 24 * 60 * 60 * 1000
const OPEN_REQUEST = ['received', 'verifying', 'in_progress'] as const satisfies readonly (typeof PRIVACY_REQUEST_STATUSES)[number][]

/**
 * What an erased account's handle becomes. Never a real handle: Kratos allows
 * only [a-z0-9_], so no /u/ address, lookup or @mention can reach it.
 */
export const tombstoneHandle = (memberId: string) => `deleted-${memberId.slice(0, 8).toLowerCase()}`

export type DeletionErrorCode = 'no_member' | 'site_moderator' | 'erased' | 'too_late' | 'not_due'

export class AccountDeletionError extends Error {
  constructor(
    readonly code: DeletionErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export const DELETION_NOTICES = Symbol('DELETION_NOTICES')

/** Emails about a deletion. Optional: without them nothing is emailed. */
export interface DeletionNotices {
  /** The deletion was asked for: when the account will be erased, and how to cancel. */
  scheduled(memberId: string, scheduledFor: Date): Promise<void>
  /** To the address the account had, once it is erased. */
  erased(email: string): Promise<void>
}

export type DeletionState = { state: 'none' } | { state: 'scheduled'; scheduledFor: Date } | { state: 'erased' }

/**
 * Deleting an account, start to finish (docs/adr/0016): asked for, the account
 * leaves the site at once; ACCOUNT_DELETION_GRACE_DAYS later it is erased,
 * unless its owner cancels first. Self-service and operators go through here.
 * Logs carry member IDs only, never emails, handles or content.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'ACCOUNT_DELETION_GRACE_DAYS' | 'PRIVACY_REQUEST_DUE_DAYS'>,
    @Inject(AuthService) private readonly auth: Pick<AuthService, 'revokeAllSessions' | 'deleteIdentity'>,
    @Inject(EMAIL_ADDRESSES) private readonly addresses: EmailAddresses,
    @Inject(MediaService) private readonly media: Pick<MediaService, 'eraseFilesOf'>,
    @Inject(MembersService) private readonly memberships: Pick<MembersService, 'holdHandle'>,
    @Optional() @Inject(DELETION_NOTICES) private readonly notices?: DeletionNotices,
  ) {}

  async state(memberId: string): Promise<DeletionState> {
    const [member] = await this.db
      .select({ scheduledFor: members.deletionScheduledFor, deletedAt: members.deletedAt })
      .from(members)
      .where(eq(members.id, memberId))
    if (member?.deletedAt) return { state: 'erased' }
    return member?.scheduledFor ? { state: 'scheduled', scheduledFor: member.scheduledFor } : { state: 'none' }
  }

  /**
   * Takes the account off the site and schedules its erase, recorded as a
   * privacy request. `immediate` (operators only) erases it within the hour.
   * Asking again changes nothing, except that `immediate` brings the erase
   * forward. A site moderator cannot ask for themselves: they are demoted first
   * (`pnpm mod:revoke`), as before a suspension.
   */
  async request(
    memberId: string,
    { channel, handledBy = null, immediate = false }: { channel: 'self_service' | 'email'; handledBy?: string | null; immediate?: boolean },
    now = new Date(),
  ): Promise<{ scheduledFor: Date; alreadyRequested: boolean }> {
    const result = await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({
          role: members.role,
          deletionRequestedAt: members.deletionRequestedAt,
          deletionScheduledFor: members.deletionScheduledFor,
          deletedAt: members.deletedAt,
        })
        .from(members)
        .where(eq(members.id, memberId))
        .for('update')
      if (!member) throw new AccountDeletionError('no_member', 'no such member')
      if (member.deletedAt) throw new AccountDeletionError('erased', 'that account has already been erased')
      if (channel === 'self_service' && member.role === 'moderator') {
        throw new AccountDeletionError('site_moderator', 'a site moderator cannot delete their own account; ask to be demoted first')
      }

      if (member.deletionRequestedAt && member.deletionScheduledFor) {
        if (!immediate || member.deletionScheduledFor <= now) return { scheduledFor: member.deletionScheduledFor, alreadyRequested: true }
        await tx.update(members).set({ deletionScheduledFor: now }).where(eq(members.id, memberId))
        return { scheduledFor: now, alreadyRequested: true }
      }

      const scheduledFor = immediate ? now : new Date(now.getTime() + this.env.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS)
      // `status` is left alone: a suspension outlives a cancelled deletion. Going
      // inactive moves their likes, replies and reposts out of the counts, in this
      // transaction (members_active_counts, migrations 0011 and 0015).
      await tx
        .update(members)
        .set({ active: false, deletionRequestedAt: now, deletionScheduledFor: scheduledFor })
        .where(eq(members.id, memberId))
      await tx.insert(privacyRequests).values({
        memberId,
        kind: 'deletion',
        channel,
        status: 'in_progress',
        receivedAt: now,
        dueBy: new Date(now.getTime() + this.env.PRIVACY_REQUEST_DUE_DAYS * DAY_MS),
        handledBy,
      })
      return { scheduledFor, alreadyRequested: false }
    })

    // Signed out everywhere. If Kratos cannot be reached they stay signed in but
    // shut out (SessionGuard reads `active` on every request), and the erase
    // ends their sessions again.
    try {
      await this.auth.revokeAllSessions(memberId)
    } catch (err) {
      this.logger.warn(`could not end the sessions of member ${memberId}; the erase will: ${(err as Error).message}`)
    }
    if (!result.alreadyRequested && this.notices) {
      try {
        await this.notices.scheduled(memberId, result.scheduledFor)
      } catch (err) {
        this.logger.warn(`could not email member ${memberId} that their deletion is scheduled: ${(err as Error).message}`)
      }
    }
    return result
  }

  /**
   * Called off before the erase. Back on the site unless suspended: deletion and
   * suspension are separate. False if no deletion was asked for.
   */
  async cancel(memberId: string, now = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({
          status: members.status,
          deletionRequestedAt: members.deletionRequestedAt,
          deletionScheduledFor: members.deletionScheduledFor,
          deletedAt: members.deletedAt,
        })
        .from(members)
        .where(eq(members.id, memberId))
        .for('update')
      if (!member) throw new AccountDeletionError('no_member', 'no such member')
      if (!member.deletionRequestedAt) return false
      // The erase locks the same row, so a cancel cannot slip in once it has begun.
      if (member.deletedAt || !member.deletionScheduledFor || member.deletionScheduledFor <= now) {
        throw new AccountDeletionError('too_late', 'the account is already being erased')
      }
      // Going active again puts their likes, replies and reposts back in the counts.
      await tx
        .update(members)
        .set({ deletionRequestedAt: null, deletionScheduledFor: null, active: member.status !== 'suspended' })
        .where(eq(members.id, memberId))
      await tx
        .update(privacyRequests)
        .set({ status: 'cancelled', closedAt: now })
        .where(and(eq(privacyRequests.memberId, memberId), eq(privacyRequests.kind, 'deletion'), inArray(privacyRequests.status, OPEN_REQUEST)))
      return true
    })
  }

  /**
   * Erases an account whose deletion is due. Safe to repeat after a failure at
   * any step: each step done already changes nothing, and `deleted_at` is set
   * only once all of them are done, so the erase job keeps trying until then.
   */
  async erase(memberId: string, now = new Date()): Promise<'erased' | 'already_erased' | 'cancelled'> {
    const [member] = await this.db
      .select({
        deletionRequestedAt: members.deletionRequestedAt,
        deletionScheduledFor: members.deletionScheduledFor,
        deletedAt: members.deletedAt,
      })
      .from(members)
      .where(eq(members.id, memberId))
    if (!member) throw new AccountDeletionError('no_member', 'no such member')
    if (member.deletedAt) return 'already_erased'
    if (!member.deletionRequestedAt) return 'cancelled'
    if (!member.deletionScheduledFor || member.deletionScheduledFor > now) throw new AccountDeletionError('not_due', 'that deletion is not due yet')

    // 1. The address for the last email, while Kratos still has it (null once deleted).
    const email = await this.addresses.addressFor(memberId)
    // 2. Signed out everywhere, in case they signed in during the grace period.
    await this.auth.revokeAllSessions(memberId)
    // 3. Everything in the app's database.
    const erased = await this.eraseRows(memberId, now)
    if (!erased) return 'cancelled'
    // 4. Their images out of storage and the CDN's cache; evidence kept privately.
    await this.media.eraseFilesOf(memberId)
    // 5. A retry between here and the next step may send this twice.
    if (email && this.notices) await this.notices.erased(email)
    // 6. The sign-in account: email, sign-in methods and any session left.
    await this.auth.deleteIdentity(memberId)
    // 7. Done.
    await this.db.transaction(async (tx) => {
      await tx.update(members).set({ deletedAt: now }).where(and(eq(members.id, memberId), isNull(members.deletedAt)))
      await tx
        .update(privacyRequests)
        .set({ status: 'completed', closedAt: now })
        .where(and(eq(privacyRequests.memberId, memberId), eq(privacyRequests.kind, 'deletion'), inArray(privacyRequests.status, OPEN_REQUEST)))
    })
    this.logger.log(`erased member ${memberId}`)
    return 'erased'
  }

  /**
   * One transaction doing what the inventory in docs/adr/0016 says for each
   * table. Every statement can run twice. False if the deletion was cancelled
   * before the row could be locked.
   */
  private async eraseRows(memberId: string, now: Date): Promise<boolean> {
    const orphaned = await this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({
          handle: members.handle,
          active: members.active,
          deletionRequestedAt: members.deletionRequestedAt,
          deletionScheduledFor: members.deletionScheduledFor,
        })
        .from(members)
        .where(eq(members.id, memberId))
        .for('update')
      if (!member?.deletionRequestedAt) return null
      if (!member.deletionScheduledFor || member.deletionScheduledFor > now) throw new AccountDeletionError('not_due', 'that deletion is not due yet')
      // The counters were settled when the account went inactive, and the
      // triggers below count active members only. Erasing an active account
      // would leave its likes and replies counted for good.
      if (member.active) throw new Error(`member ${memberId} is active; it cannot be erased`)

      const run = (query: SQL) => tx.execute(query)
      // Posts kept as evidence: taken down by a moderator, or reported at any time.
      const evidence = sql`(select p.id from posts p where p.author_id = ${memberId} and (p.removed_at is not null
        or exists(select 1 from reports r where r.post_id = p.id)
        or exists(select 1 from moderation_actions a where a.post_id = p.id)))`
      const ordinary = sql`(select id from posts where author_id = ${memberId} and id not in ${evidence})`
      const own = sql`(select id from posts where author_id = ${memberId})`

      // Images: kept while they are evidence, and so is the photo while a report
      // about the account is open. The rest are marked deleted; their files go
      // after the transaction (MediaService.eraseFilesOf).
      await run(sql`update media set status = 'deleted'
        where owner_id = ${memberId} and status in ('pending', 'processing', 'ready')
          and not (kind = 'post_image' and post_id is not null and post_id in ${evidence})
          and not (kind = 'avatar' and id is not distinct from (select avatar_media_id from members where id = ${memberId})
            and exists(select 1 from reports r where r.member_id = ${memberId} and r.post_id is null
              and r.status = 'open' and r.reason <> 'appeal'))`)

      // Posts stay as rows: the parents of other people's replies, and what
      // reports, likes and notifications point at. The author is inactive, so
      // setting deleted_at changes no reply count.
      await run(sql`update posts set deleted_at = coalesce(deleted_at, ${now}::timestamptz) where author_id = ${memberId} and id in ${evidence}`)
      await run(sql`update posts set deleted_at = coalesce(deleted_at, ${now}::timestamptz), text = '', link_url = null, quote_post_id = null
        where author_id = ${memberId} and id not in ${evidence}`)
      await run(sql`delete from post_mentions where member_id = ${memberId} or post_id in ${ordinary}`)
      await run(sql`delete from post_hashtags where post_id in ${ordinary}`)
      await run(sql`update ideas set title = '' where post_id in ${ordinary}`)
      await run(sql`delete from problem_details where post_id in ${own}`)
      await run(sql`update communities set pinned_post_id = null where pinned_post_id in ${own}`)

      // What they did. The member is inactive, so the like and repost triggers change no count.
      await run(sql`delete from likes where member_id = ${memberId}`)
      await run(sql`delete from reposts where member_id = ${memberId}`)
      await run(sql`delete from bookmarks where member_id = ${memberId}`)
      await run(sql`delete from idea_votes where member_id = ${memberId}`)
      await run(sql`delete from follows where follower_id = ${memberId} or followee_id = ${memberId}`)
      await run(sql`delete from blocks where blocker_id = ${memberId} or blocked_id = ${memberId}`)
      await run(sql`delete from mutes where muter_id = ${memberId} or muted_id = ${memberId}`)

      // Communities they alone moderated, to log once it is done: site moderators
      // cover every community, but someone should appoint a new one.
      const { rows: unmoderated } = await tx.execute<{ slug: string }>(sql`
        select c.slug from community_memberships cm join communities c on c.id = cm.community_id and c.active
        where cm.member_id = ${memberId} and cm.role = 'moderator'
          and not exists(select 1 from community_memberships o join members m on m.id = o.member_id and m.active
            where o.community_id = cm.community_id and o.role = 'moderator' and o.member_id <> ${memberId})`)
      await run(sql`delete from community_memberships where member_id = ${memberId}`)

      await run(sql`delete from notifications where recipient_id = ${memberId} or actor_id = ${memberId}`)
      await run(sql`delete from notification_opt_outs where member_id = ${memberId}`)
      await run(sql`delete from push_subscriptions where member_id = ${memberId}`)
      await run(sql`delete from profile_badges where member_id = ${memberId}`)
      await run(sql`delete from invite_redemptions where identity_id = ${memberId}`)
      // Reports about them and the ones they made stay, as evidence. An appeal
      // still open has nothing left to decide.
      await run(sql`update reports set status = 'dismissed', resolved_at = ${now}
        where reporter_id = ${memberId} and reason = 'appeal' and status = 'open'`)

      // Handles: old holds that have run out go; the one they have now is held for
      // HANDLE_HOLD_DAYS, so nobody can take it straight away (docs/adr/0004).
      // Renames are refused while a deletion is pending, so it is the one Kratos has.
      await run(sql`delete from released_handles
        where member_id = ${memberId} and released_at <= now() - make_interval(days => ${HANDLE_HOLD_DAYS})`)
      if (member.handle !== tombstoneHandle(memberId)) await this.memberships.holdHandle(memberId, member.handle, tx)

      // The age record goes; the audit log keeps that an 18+ declaration was made,
      // and when. A live identity verification is revoked so the person can verify
      // another account; its row stays as the record (switched off: none exist).
      await tx.delete(ageAssurances).where(eq(ageAssurances.memberId, memberId))
      const revoked = await tx
        .update(identityVerifications)
        .set({ status: 'revoked', revokedAt: now, outcome: 'member_deleted' })
        .where(and(eq(identityVerifications.memberId, memberId), inArray(identityVerifications.status, ['pending', 'verified'])))
        .returning({ id: identityVerifications.id })
      if (revoked.length) {
        await tx.insert(governanceAuditLog).values({ subjectId: memberId, event: 'verification_revoked', reason: 'member_deleted', createdAt: now })
      }

      // The tombstone: nothing personal left, still there for everything that points at it.
      await tx
        .update(members)
        .set({
          handle: tombstoneHandle(memberId),
          displayName: null,
          bio: '',
          avatarMediaId: null,
          role: 'member',
          lastSeenAt: null,
          onboardedAt: null,
          emailNotifications: false,
          lastNotificationEmailAt: null,
          pinnedPostId: null,
        })
        .where(eq(members.id, memberId))
      return unmoderated.map((r) => r.slug)
    })
    if (orphaned === null) return false
    if (orphaned.length) this.logger.warn(`erasing member ${memberId} left communities with no moderator: ${orphaned.join(', ')}`)
    return true
  }
}
