import { type Db, members, notifications, OPTIONAL_NOTIFICATION_KINDS, pushSubscriptions } from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { EXCERPT_MAX, KINDS_WITH_EXCERPT } from '../email/digest.js'
import { excerpt, joins, type NotificationKind, visible } from '../notifications/notifications.service.js'
import { DB } from '../tokens.js'
import { type PushItem, pushMessages } from './push-message.js'
import {
  PermanentPushError,
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type PushTarget,
  SubscriptionGoneError,
} from './push-sender.js'

export const PUSH_JOBS = Symbol('PUSH_JOBS')

/** What the push service needs from the job queue: somewhere to send work. */
export interface PushJobs {
  /** Queues one member's push. Safe to repeat: a member has at most one waiting. */
  push(memberId: string): Promise<void>
}

// A push is about now. One that could not go out within ten minutes (the push
// worker was down, every try failed) is left to email and the app.
const STALE_AFTER_S = 10 * 60
// Members whose push falls due in one pass; the rest follow on the next.
const DUE_PER_SWEEP = 500
// Waiting notifications one push looks at; a member with more is told about the
// newest and the rest are passed over.
const PENDING_MAX = 200
// How far back already-pushed likes, reposts and follows are counted in.
const COUNTED_IN_S = 24 * 60 * 60
// Notifications one push reads, waiting and counted in together.
const READ_MAX = 300

/**
 * Push notifications (docs/adr/0011). A notification is written by whatever
 * happened and never waits on a push. Every few seconds `sweep` passes over what
 * nothing will be pushed for and asks for one push per member with something
 * waiting; `send` then decides what to say and sends it to each of the member's
 * browsers. As with email, everything is decided from what is true at that
 * moment. What a browser took is marked `pushed_at`, and email leaves it out.
 */
@Injectable()
export class PushNotificationsService {
  private readonly log = new Logger(PushNotificationsService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PUSH_JOBS) private readonly jobs: PushJobs,
    @Optional() @Inject(PUSH_SENDER) private readonly sender: PushSender | null = null,
  ) {}

  /** False when no VAPID keys are configured: nothing is pushed, and browsers are not offered it. */
  get enabled(): boolean {
    return this.sender !== null
  }

  /** The key browsers subscribe with, or null when push is off. */
  get publicKey(): string | null {
    return this.sender?.publicKey ?? null
  }

  /**
   * Starts pushing the member's notifications to a browser and returns the
   * subscription's ID. A browser has one subscription: if it was someone else's,
   * it is now this member's. `replaces` is the address the browser had before,
   * when its push service gave it a new one: that subscription keeps its ID, which
   * the browser's sign-out cookie names, and takes the new address.
   */
  async subscribe(memberId: string, target: PushTarget, replaces?: string): Promise<string> {
    return this.db.transaction(async (tx) => {
      if (replaces && replaces !== target.endpoint) {
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, target.endpoint))
        const [moved] = await tx
          .update(pushSubscriptions)
          .set({ memberId, ...target })
          .where(eq(pushSubscriptions.endpoint, replaces))
          .returning({ id: pushSubscriptions.id })
        if (moved) return moved.id
      }
      const [row] = await tx
        .insert(pushSubscriptions)
        .values({ memberId, ...target })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { memberId, p256dh: target.p256dh, auth: target.auth },
        })
        .returning({ id: pushSubscriptions.id })
      return row!.id
    })
  }

  /**
   * Whether the member's notifications are pushed to the browser with this
   * address. If someone else's are, they stop: the browser is now in this
   * member's hands, and another member's notifications must not show on it.
   */
  async isSubscribed(memberId: string, endpoint: string): Promise<boolean> {
    const [row] = await this.db
      .select({ memberId: pushSubscriptions.memberId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
    if (!row) return false
    if (row.memberId === memberId) return true
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.memberId, row.memberId)))
    return false
  }

  /** Stops pushing to the browser with this address, whoever's it was. */
  async unsubscribe(endpoint: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  }

  /** Signing out: stops pushing to the member's subscription with this ID, if it is still theirs. */
  async remove(memberId: string, id: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.memberId, memberId)))
  }

  /**
   * Run every few seconds. Passes over what nothing will be pushed for, then asks
   * for a push for each member with something waiting. Returns how many it asked for.
   */
  async sweep(): Promise<number> {
    // Settled so it is never looked at again: read in the app already, too old, or
    // for a member who is suspended or has no browser to push to. Subscribing later
    // does not bring these back.
    await this.db.execute(sql`
      update notifications n set push_settled_at = now()
      where n.push_settled_at is null
        and (n.read_at is not null
          or n.created_at < now() - make_interval(secs => ${STALE_AFTER_S})
          or exists(select 1 from members m where m.id = n.recipient_id and not m.active)
          or not exists(select 1 from push_subscriptions s where s.member_id = n.recipient_id))`)

    const { rows } = await this.db.execute<{ id: string }>(sql`
      select distinct n.recipient_id as id from notifications n
      where n.push_settled_at is null
      limit ${DUE_PER_SWEEP}`)
    for (const { id } of rows) await this.jobs.push(id)
    return rows.length
  }

  /**
   * Pushes what is waiting for one member to each of their browsers, if anything
   * in it is still worth telling them. Returns how many push notifications each
   * browser was sent. Throws when no browser could be reached, leaving the
   * notifications waiting, so that the job is retried.
   */
  async send(memberId: string): Promise<number> {
    if (!this.sender) return 0
    const { rows: waiting } = await this.db.execute<{ id: string }>(sql`
      select id from notifications where recipient_id = ${memberId} and push_settled_at is null
      order by created_at desc limit ${PENDING_MAX}`)
    if (!waiting.length) return 0
    const ids = waiting.map((r) => r.id)
    // Settles everything waiting; only `pushed` is marked as pushed, and kept out of email.
    const settle = (pushed: string[] = []) =>
      this.db.execute(sql`
        update notifications set push_settled_at = now(),
          pushed_at = case when id = any(${pgUuids(pushed)}) then now() end
        where id = any(${pgUuids(ids)})`)

    const [member] = await this.db.select({ active: members.active }).from(members).where(eq(members.id, memberId))
    const browsers = member?.active
      ? await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.memberId, memberId))
      : []
    if (!browsers.length) {
      await settle()
      return 0
    }

    const { messages, pushed } = pushMessages(await this.eligible(memberId, ids))
    if (!messages.length) {
      await settle()
      return 0
    }

    const reached: string[] = []
    let retry: unknown = null
    for (const browser of browsers) {
      try {
        await this.deliver(this.sender, browser, messages)
        reached.push(browser.id)
      } catch (error) {
        if (error instanceof SubscriptionGoneError) {
          await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, browser.id))
        } else if (error instanceof PermanentPushError) {
          this.log.warn(`push to subscription ${browser.id} was refused for good: ${error.message}`)
        } else {
          retry ??= error
        }
      }
    }
    if (!reached.length && retry) throw retry

    // No browser took it (each one gone or refusing): settled unpushed, so it is emailed.
    if (!reached.length) {
      await settle()
      return 0
    }
    await settle(pushed)
    await this.db.update(pushSubscriptions).set({ lastPushedAt: new Date() }).where(inArray(pushSubscriptions.id, reached))
    return messages.length
  }

  /**
   * One browser's messages, in order. A browser that took the first and failed on
   * a later one counts as reached: sending them all again would repeat the first.
   */
  private async deliver(sender: PushSender, browser: PushTarget, messages: PushMessage[]): Promise<void> {
    let sent = 0
    for (const message of messages) {
      try {
        await sender.send(browser, message)
        sent++
      } catch (error) {
        if (sent && !(error instanceof SubscriptionGoneError)) return
        throw error
      }
    }
  }

  /**
   * What the member would still be shown in the app, unread and not opted out
   * of: the waiting notifications, then the likes, reposts and follows already
   * pushed that the new ones are counted in with. Newest first within each.
   */
  private async eligible(memberId: string, ids: string[]): Promise<PushItem[]> {
    const optional = sql.join(OPTIONAL_NOTIFICATION_KINDS.map((k) => sql`${k}`), sql`, `)
    const excerptKinds = sql.join(KINDS_WITH_EXCERPT.map((k) => sql`${k}`), sql`, `)
    const { rows } = await this.db.execute<{
      id: string
      kind: NotificationKind
      actor_handle: string | null
      post_id: string | null
      post_text: string | null
      community_name: string | null
      detail: string | null
      idea_kind: string | null
      idea_yours: boolean
      pending: boolean
    }>(sql`
      select n.id, n.kind, a.handle as actor_handle, n.post_id,
        -- The text of a post is read only for the kinds that quote it.
        case when n.kind in (${excerptKinds}) then p.text end as post_text,
        c.name as community_name, n.detail, i.kind as idea_kind, coalesce(p.author_id = n.recipient_id, false) as idea_yours, n.push_settled_at is null as pending
      ${joins}
      where ${visible(memberId)} and n.read_at is null
        and (n.kind not in (${optional})
          or not exists(select 1 from notification_opt_outs o where o.member_id = n.recipient_id and o.kind = n.kind))
        and (n.id = any(${pgUuids(ids)})
          or (n.pushed_at is not null and n.kind in ('like', 'repost', 'follow')
            and n.created_at > now() - make_interval(secs => ${COUNTED_IN_S})))
      order by n.push_settled_at is null desc, n.created_at desc, n.id desc
      limit ${READ_MAX}`)
    return rows.map((r) => ({
      id: r.id,
      pending: r.pending,
      kind: r.kind,
      actor: r.actor_handle,
      postId: r.post_id,
      excerpt: r.post_text ? excerpt(r.post_text, EXCERPT_MAX) : null,
      community: r.community_name,
      idea: r.idea_kind ? { status: r.detail, kind: r.idea_kind, yours: r.idea_yours } : null,
    }))
  }
}

/** A list of IDs as one Postgres uuid[] parameter. */
const pgUuids = (ids: string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`
