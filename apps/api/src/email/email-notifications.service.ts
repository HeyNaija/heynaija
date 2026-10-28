import { type Db, members, notifications, OPTIONAL_NOTIFICATION_KINDS } from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { eq, inArray, sql } from 'drizzle-orm'
import { excerpt, joins, type NotificationKind, visible } from '../notifications/notifications.service.js'
import { DB } from '../tokens.js'
import { EMAIL_ADDRESSES, type EmailAddresses } from './addresses.js'
import { type DigestItem, EXCERPT_MAX, KINDS_WITH_EXCERPT, renderDigest } from './digest.js'
import { MAILER, type Mailer, PermanentMailError } from './mailer.js'
import { memberOfUnsubscribeToken, unsubscribeToken } from './unsubscribe-token.js'

export const EMAIL_JOBS = Symbol('EMAIL_JOBS')
export const EMAIL_SETTINGS = Symbol('EMAIL_SETTINGS')

/** What the email service needs from the job queue: somewhere to send work. */
export interface EmailJobs {
  /** Queues one member's email. Safe to repeat: a member has at most one waiting. */
  sendDigest(memberId: string): Promise<void>
}

export type EmailSettings = {
  /** The address members use for the web app: where every link in an email points. */
  webUrl: string
  unsubscribeKey: Buffer
  /** A notification waits this long, so that what follows it can go in the same email. */
  delayS: number
  /** At least this long passes between two emails to one member. */
  gapS: number
  /**
   * Push notifications are on (docs/adr/0011): a notification is not emailed
   * until the push side has dealt with it, and not at all if it was pushed.
   */
  waitForPush: boolean
}

// A notification that nothing has emailed within a day is not worth emailing
// any more (the mail server was down, or the job kept failing).
const STALE_AFTER_S = 24 * 60 * 60
// Members whose email falls due in one pass; the rest follow a minute later.
const DUE_PER_SWEEP = 500
// Notifications one email looks at; a member with more than this is sent the
// newest and the rest are passed over.
const PENDING_MAX = 1000
// Entries an email lists. Everything is counted, only the newest are written out.
const LISTED_MAX = 100

/**
 * Notification emails. A notification is written by whatever happened and never
 * waits on email. Every minute `sweep` finds the members whose waiting
 * notifications have waited long enough and asks for one email each;
 * `sendDigest` then writes that email and sends it. Everything decided here is
 * decided at that moment, from what is true then: a member who has since turned
 * email off, been suspended or read the notification in the app is not emailed
 * about it, and neither is anything whose actor has been blocked or whose post
 * has been taken down, or that one of the member's browsers took as a push
 * notification.
 */
@Injectable()
export class EmailNotificationsService {
  private readonly log = new Logger(EmailNotificationsService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EMAIL_JOBS) private readonly jobs: EmailJobs,
    @Inject(EMAIL_SETTINGS) private readonly settings: EmailSettings,
    @Optional() @Inject(MAILER) private readonly mailer: Mailer | null = null,
    @Optional() @Inject(EMAIL_ADDRESSES) private readonly addresses: EmailAddresses | null = null,
  ) {}

  /** False when no mail server is configured: notifications then stay in the app. */
  get enabled(): boolean {
    return this.mailer !== null && this.addresses !== null
  }

  /** The link in a member's emails that turns them off. */
  unsubscribeUrl(memberId: string): string {
    return `${this.settings.webUrl}/api/v1/email/unsubscribe/${unsubscribeToken(this.settings.unsubscribeKey, memberId)}`
  }

  /**
   * Turns email notifications off for the member a link was made for, and
   * changes nothing else: not the kinds they are notified about, not their
   * notifications. False if the link is not one of ours.
   */
  async unsubscribe(token: string): Promise<boolean> {
    const memberId = memberOfUnsubscribeToken(this.settings.unsubscribeKey, token)
    if (!memberId) return false
    await this.db.update(members).set({ emailNotifications: false }).where(eq(members.id, memberId))
    return true
  }

  /**
   * Run every minute. Passes over what no email will be sent for, then asks for
   * an email for each member whose oldest waiting notification has waited long
   * enough and who has not been emailed too recently. Returns how many it asked for.
   */
  async sweep(): Promise<number> {
    // Settled so it is never looked at again: read in the app already, pushed,
    // too old, or for a member who is suspended or has email off. Turning email on
    // later does not bring these back.
    await this.db.execute(sql`
      update notifications n set email_settled_at = now()
      where n.email_settled_at is null
        and (n.read_at is not null
          or n.pushed_at is not null
          or n.created_at < now() - make_interval(secs => ${STALE_AFTER_S})
          or exists(select 1 from members m where m.id = n.recipient_id and (not m.active or not m.email_notifications)))`)

    const { rows } = await this.db.execute<{ id: string }>(sql`
      select n.recipient_id as id
      from notifications n
      join members m on m.id = n.recipient_id
      where n.email_settled_at is null and ${this.pushDone()} and m.active and m.email_notifications
        and (m.last_notification_email_at is null
          or m.last_notification_email_at <= now() - make_interval(secs => ${this.settings.gapS}))
      group by n.recipient_id
      having min(n.created_at) <= now() - make_interval(secs => ${this.settings.delayS})
      limit ${DUE_PER_SWEEP}`)
    for (const { id } of rows) await this.jobs.sendDigest(id)
    return rows.length
  }

  /**
   * Writes and sends one member's email about everything waiting for them, if
   * anything in it is still worth sending. Returns whether an email went out.
   * Throws when the mail server or Kratos cannot be reached, leaving the
   * notifications waiting, so that the job is retried.
   */
  async sendDigest(memberId: string): Promise<boolean> {
    // Only what the push side is done with: anything still to be pushed waits for
    // the next email, so it is never both pushed and emailed.
    const { rows: waiting } = await this.db.execute<{ id: string }>(sql`
      select n.id from notifications n where n.recipient_id = ${memberId} and n.email_settled_at is null and ${this.pushDone()}
      order by n.created_at desc limit ${PENDING_MAX}`)
    if (!waiting.length) return false
    const ids = waiting.map((r) => r.id)
    const settle = () =>
      this.db.update(notifications).set({ emailSettledAt: new Date() }).where(inArray(notifications.id, ids))

    const [member] = await this.db
      .select({ handle: members.handle, active: members.active, on: members.emailNotifications })
      .from(members)
      .where(eq(members.id, memberId))
    if (!member?.active || !member.on || !this.mailer || !this.addresses) {
      // Off, suspended or not configured. With no mail server the notifications
      // are left to wait (and go stale) rather than be thrown away at once.
      if (this.mailer && this.addresses) await settle()
      return false
    }

    const { items, total } = await this.eligible(memberId, ids)
    if (!items.length) {
      await settle()
      return false
    }
    const to = await this.addresses.addressFor(memberId)
    if (!to) {
      await settle()
      return false
    }

    const unsubscribeUrl = this.unsubscribeUrl(memberId)
    const email = renderDigest({ handle: member.handle, items, total, webUrl: this.settings.webUrl, unsubscribeUrl })
    try {
      await this.mailer.send({ to, subject: email.subject, text: email.text, html: email.html, unsubscribeUrl })
    } catch (error) {
      if (!(error instanceof PermanentMailError)) throw error
      // Trying again would fail the same way: leave this email unsent.
      this.log.warn(`email to member ${memberId} was refused for good: ${error.message}`)
      await settle()
      return false
    }
    await this.db.transaction(async (tx) => {
      await tx.update(notifications).set({ emailSettledAt: new Date() }).where(inArray(notifications.id, ids))
      await tx.update(members).set({ lastNotificationEmailAt: new Date() }).where(eq(members.id, memberId))
    })
    return true
  }

  /** Whether the push side has dealt with notification `n`, when there is a push side. */
  private pushDone() {
    return this.settings.waitForPush ? sql`n.push_settled_at is not null` : sql`true`
  }

  /**
   * Which of the waiting notifications are still worth an email, newest first:
   * what the member would still be shown in the app (not from someone blocked,
   * muted or suspended, not about a post taken down or a like taken back) that
   * they have not read, have not since opted out of and were not pushed.
   */
  private async eligible(memberId: string, ids: string[]): Promise<{ items: DigestItem[]; total: number }> {
    const optional = sql.join(OPTIONAL_NOTIFICATION_KINDS.map((k) => sql`${k}`), sql`, `)
    const excerptKinds = sql.join(KINDS_WITH_EXCERPT.map((k) => sql`${k}`), sql`, `)
    const waiting = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)
    const { rows } = await this.db.execute<{
      kind: NotificationKind
      actor_handle: string | null
      post_id: string | null
      post_text: string | null
      community_name: string | null
      detail: string | null
      idea_kind: string | null
      idea_yours: boolean
      total: number
    }>(sql`
      select n.kind, a.handle as actor_handle, n.post_id,
        -- The text of a post is read only for the kinds that quote it.
        case when n.kind in (${excerptKinds}) then p.text end as post_text,
        c.name as community_name, n.detail, i.kind as idea_kind, coalesce(p.author_id = n.recipient_id, false) as idea_yours, count(*) over ()::int as total
      ${joins}
      where ${visible(memberId)} and n.id in (${waiting}) and n.read_at is null and n.pushed_at is null
        and (n.kind not in (${optional})
          or not exists(select 1 from notification_opt_outs o where o.member_id = n.recipient_id and o.kind = n.kind))
      order by n.created_at desc, n.id desc
      limit ${LISTED_MAX}`)
    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((r) => ({
        kind: r.kind,
        actor: r.actor_handle,
        postId: r.post_id,
        excerpt: r.post_text ? excerpt(r.post_text, EXCERPT_MAX) : null,
        community: r.community_name,
        idea: r.idea_kind ? { status: r.detail, kind: r.idea_kind, yours: r.idea_yours } : null,
      })),
    }
  }
}
