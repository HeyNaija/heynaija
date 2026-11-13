import { type Db, members, notifications, OPTIONAL_NOTIFICATION_KINDS, type PushDeviceService, pushDevices, pushSubscriptions } from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { EXCERPT_MAX, KINDS_WITH_EXCERPT } from '../email/digest.js'
import { GistsGate } from '../gists/gists-enabled.guard.js'
import { type ChallengeColumns, challengeColumns, challengeOf, excerpt, gistsOpenTo, joins, type NotificationKind, postShown, visible } from '../notifications/notifications.service.js'
import { DB } from '../tokens.js'
import { type PushItem, pushMessages } from './push-message.js'
import {
  APP_PUSH_SENDER,
  type AppPushSender,
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
// Browsers kept per member; subscribing past it drops the oldest.
const SUBSCRIPTIONS_PER_MEMBER = 10
// Installations of the app kept per member; registering past it drops the oldest.
const DEVICES_PER_MEMBER = 10
// How far back already-pushed likes, reposts and follows are counted in.
const COUNTED_IN_S = 24 * 60 * 60
// Notifications one push reads, waiting and counted in together.
const READ_MAX = 300

/**
 * Push notifications (docs/adr/0011). A notification is written by whatever
 * happened and never waits on a push. Every few seconds `sweep` passes over what
 * nothing will be pushed for and asks for one push per member with something
 * waiting; `send` then decides what to say and sends it to each of the member's
 * browsers and installations of the app (docs/adr/0023). As with email,
 * everything is decided from what is true at that moment. What a browser or the
 * app took is marked `pushed_at`, and email leaves it out.
 */
@Injectable()
export class PushNotificationsService {
  private readonly log = new Logger(PushNotificationsService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PUSH_JOBS) private readonly jobs: PushJobs,
    @Optional() @Inject(PUSH_SENDER) private readonly sender: PushSender | null = null,
    @Optional() @Inject(GistsGate) private readonly gate: Pick<GistsGate, 'access'> | null = null,
    @Optional() @Inject(APP_PUSH_SENDER) private readonly apps: AppPushSender | null = null,
  ) {}

  /** False when neither VAPID keys, FCM's service account nor the Apple key are configured: nothing is pushed. */
  get enabled(): boolean {
    return this.sender !== null || this.apps !== null
  }

  /** The push services the apps can register with: "fcm" with FCM's service account, "apns" and "apns_sandbox" with the Apple key. */
  get appServices(): readonly PushDeviceService[] {
    return this.apps?.services ?? []
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
      await tx.execute(sql`
        delete from push_subscriptions
        where member_id = ${memberId}
          and id not in (
            select id from push_subscriptions where member_id = ${memberId}
            order by (id = ${row!.id}) desc, created_at desc, id desc
            limit ${SUBSCRIPTIONS_PER_MEMBER})`)
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
   * Starts pushing the member's notifications to an installation of the app,
   * which sends its token and key each time it starts signed in. A token is one
   * installation: if someone else was signed in there, it is now this member's,
   * with a fresh start date. A member has at most DEVICES_PER_MEMBER; the oldest go.
   */
  async register(memberId: string, service: PushDeviceService, token: string, key: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(pushDevices)
        .values({ memberId, service, token, key })
        .onConflictDoUpdate({
          target: [pushDevices.service, pushDevices.token],
          set: {
            memberId,
            key,
            createdAt: sql`case when push_devices.member_id = excluded.member_id then push_devices.created_at else now() end`,
            lastPushedAt: sql`case when push_devices.member_id = excluded.member_id then push_devices.last_pushed_at end`,
          },
        })
        .returning({ id: pushDevices.id })
      await tx.execute(sql`
        delete from push_devices
        where member_id = ${memberId}
          and id not in (
            select id from push_devices where member_id = ${memberId}
            order by (id = ${row!.id}) desc, created_at desc, id desc
            limit ${DEVICES_PER_MEMBER})`)
    })
  }

  /** Signing out of the app: stops pushing to it, if it is still the member's. */
  async unregister(memberId: string, service: PushDeviceService, token: string): Promise<void> {
    await this.db
      .delete(pushDevices)
      .where(and(eq(pushDevices.service, service), eq(pushDevices.token, token), eq(pushDevices.memberId, memberId)))
  }

  /**
   * Run every few seconds. Passes over what nothing will be pushed for, then asks
   * for a push for each member with something waiting. Returns how many it asked for.
   */
  async sweep(): Promise<number> {
    // Settled so it is never looked at again: read in the app already, too old, or
    // for a member who is suspended or has no browser or app to push to.
    // Subscribing later does not bring these back.
    const places = [
      this.sender && sql`exists(select 1 from push_subscriptions s where s.member_id = n.recipient_id)`,
      this.apps && sql`exists(select 1 from push_devices d where d.member_id = n.recipient_id and d.service = any(${pgTexts(this.apps.services)}))`,
    ].filter((place) => place !== null)
    await this.db.execute(sql`
      update notifications n set push_settled_at = now()
      where n.push_settled_at is null
        and (n.read_at is not null
          or n.created_at < now() - make_interval(secs => ${STALE_AFTER_S})
          or exists(select 1 from members m where m.id = n.recipient_id and not m.active)
          or not (${places.length ? sql.join(places, sql` or `) : sql`false`}))`)

    const { rows } = await this.db.execute<{ id: string }>(sql`
      select distinct n.recipient_id as id from notifications n
      where n.push_settled_at is null
      limit ${DUE_PER_SWEEP}`)
    for (const { id } of rows) await this.jobs.push(id)
    return rows.length
  }

  /**
   * Pushes what is waiting for one member to each of their browsers and apps, if
   * anything in it is still worth telling them. Returns how many push
   * notifications each was sent. Throws when none could be reached, leaving the
   * notifications waiting, so that the job is retried.
   */
  async send(memberId: string): Promise<number> {
    if (!this.enabled) return 0
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

    const places = await this.placesOf(memberId)
    if (!places.length) {
      await settle()
      return 0
    }

    const { messages, pushed } = pushMessages(await this.eligible(memberId, ids))
    if (!messages.length) {
      await settle()
      return 0
    }

    // Nothing took it (each one gone or refusing): settled unpushed, so it is emailed.
    if (!(await this.reach(places, messages))) {
      await settle()
      return 0
    }
    await settle(pushed)
    return messages.length
  }

  /**
   * Pushes messages that are not notifications (the weekly highlights, ADR 0027)
   * to each of the member's browsers and apps. True when at least one took them;
   * false when the member has nowhere to push to, is suspended, or every place is
   * gone or refusing. Throws when none could be reached and trying again may work.
   */
  async sendTo(memberId: string, messages: PushMessage[]): Promise<boolean> {
    if (!messages.length) return false
    const places = await this.placesOf(memberId)
    return places.length > 0 && (await this.reach(places, messages))
  }

  /** The member's browsers and installations of the app that can be pushed to now: none for a suspended member, or with push off. */
  private async placesOf(memberId: string): Promise<Place[]> {
    const { sender: web, apps } = this
    const [member] = await this.db.select({ active: members.active }).from(members).where(eq(members.id, memberId))
    const places: Place[] = []
    if (member?.active && web) {
      const browsers = await this.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.memberId, memberId))
        .orderBy(desc(pushSubscriptions.createdAt))
        .limit(SUBSCRIPTIONS_PER_MEMBER)
      for (const browser of browsers) {
        places.push({ kind: 'browser', id: browser.id, send: (message) => web.send(browser, message) })
      }
    }
    if (member?.active && apps) {
      const devices = await this.db
        .select()
        .from(pushDevices)
        // An installation whose push service is not configured here (its key was taken away) waits until it is.
        .where(and(eq(pushDevices.memberId, memberId), inArray(pushDevices.service, [...apps.services])))
        .orderBy(desc(pushDevices.createdAt))
        .limit(DEVICES_PER_MEMBER)
      for (const device of devices) {
        places.push({ kind: 'app', id: device.id, send: (message) => apps.send({ service: device.service, token: device.token, key: device.key, memberId }, message) })
      }
    }
    return places
  }

  /**
   * Sends the messages to each place and records which took them. A place its push
   * service no longer knows is forgotten. True when at least one took them. Throws
   * when none did and one of them failed in a way worth trying again.
   */
  private async reach(places: Place[], messages: PushMessage[]): Promise<boolean> {
    const reached: Place[] = []
    let retry: unknown = null
    for (const place of places) {
      try {
        await this.deliver(place, messages)
        reached.push(place)
      } catch (error) {
        if (error instanceof SubscriptionGoneError) {
          if (place.kind === 'browser') await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, place.id))
          else await this.db.delete(pushDevices).where(eq(pushDevices.id, place.id))
        } else if (error instanceof PermanentPushError) {
          this.log.warn(`push to ${place.kind === 'browser' ? 'subscription' : 'app'} ${place.id} was refused for good: ${error.message}`)
        } else {
          retry ??= error
        }
      }
    }
    if (!reached.length && retry) throw retry
    if (!reached.length) return false

    const now = new Date()
    const browsers = reached.filter((place) => place.kind === 'browser').map((place) => place.id)
    const devices = reached.filter((place) => place.kind === 'app').map((place) => place.id)
    if (browsers.length) await this.db.update(pushSubscriptions).set({ lastPushedAt: now }).where(inArray(pushSubscriptions.id, browsers))
    if (devices.length) await this.db.update(pushDevices).set({ lastPushedAt: now }).where(inArray(pushDevices.id, devices))
    return true
  }

  /**
   * One browser's or app's messages, in order. One that took the first and failed
   * on a later one counts as reached: sending them all again would repeat the first.
   */
  private async deliver(place: Place, messages: PushMessage[]): Promise<void> {
    let sent = 0
    for (const message of messages) {
      try {
        await place.send(message)
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
    const gistsOn = await gistsOpenTo(this.gate, memberId)
    const shown = postShown(memberId, gistsOn)
    const optional = sql.join(OPTIONAL_NOTIFICATION_KINDS.map((k) => sql`${k}`), sql`, `)
    const excerptKinds = sql.join(KINDS_WITH_EXCERPT.map((k) => sql`${k}`), sql`, `)
    const { rows } = await this.db.execute<{
      id: string
      kind: NotificationKind
      actor_handle: string | null
      post_id: string | null
      gist_id: string | null
      post_text: string | null
      community_name: string | null
      detail: string | null
      idea_kind: string | null
      idea_yours: boolean
      pending: boolean
    } & ChallengeColumns>(sql`
      select n.id, n.kind, a.handle as actor_handle, case when ${shown} then n.post_id end as post_id, case when ${shown} then p.gist_id end as gist_id,
        -- The text of a post is read only for the kinds that quote it.
        case when n.kind in (${excerptKinds}) then p.text end as post_text,
        c.name as community_name, n.detail, i.kind as idea_kind, coalesce(p.author_id = n.recipient_id, false) as idea_yours, ${challengeColumns}, n.push_settled_at is null as pending
      ${joins}
      where ${visible(memberId, gistsOn)} and n.read_at is null
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
      gistId: r.gist_id,
      excerpt: r.post_text ? excerpt(r.post_text, EXCERPT_MAX) : null,
      community: r.community_name,
      idea: r.idea_kind ? { status: r.detail, kind: r.idea_kind, yours: r.idea_yours } : null,
      challenge: challengeOf(r),
      game: r.game_id ? { id: r.game_id } : null,
    }))
  }
}

/** A browser or an installation of the app, ready to be sent a member's messages. */
type Place = { kind: 'browser' | 'app'; id: string; send: (message: PushMessage) => Promise<void> }

/** A list of IDs as one Postgres uuid[] parameter. */
const pgUuids = (ids: string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`

/** A list of plain words (push services) as one Postgres text[] parameter. */
const pgTexts = (words: readonly string[]) => sql`${`{${words.join(',')}}`}::text[]`
