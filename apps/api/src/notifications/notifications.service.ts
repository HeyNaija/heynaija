import { type Db, NOTIFICATION_KINDS, notificationOptOuts, OPTIONAL_NOTIFICATION_KINDS } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { decodeCursor, encodeCursor } from '../cursor.js'
import { avatarPath } from '../media/media.service.js'
import { DB } from '../tokens.js'

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** Other members' activity, which a member may stop being notified about. */
export type OptionalNotificationKind = (typeof OPTIONAL_NOTIFICATION_KINDS)[number]

/** For each kind a member may turn off, whether it is on. */
export type NotificationPreferences = Record<OptionalNotificationKind, boolean>

const isOptional = (kind: string): kind is OptionalNotificationKind =>
  (OPTIONAL_NOTIFICATION_KINDS as readonly string[]).includes(kind)

/** Every kind on except those in `off`. */
export const preferencesWithout = (off: readonly string[]): NotificationPreferences =>
  Object.fromEntries(OPTIONAL_NOTIFICATION_KINDS.map((kind) => [kind, !off.includes(kind)])) as NotificationPreferences

/** A moderation or account notice was asked to be turned off: members are always told those. */
export class NotOptionalError extends Error {}

export type NewNotification = {
  recipientId: string
  kind: NotificationKind
  actorId?: string | null
  postId?: string | null
  subjectId?: string | null
  communityId?: string | null
  detail?: string | null
}

/**
 * Records notifications in one statement, inside the caller's transaction when
 * given one. Nobody is notified about their own actions or about a kind they
 * turned off, and a like, repost, quote, mention or follow notifies only once.
 */
export async function notify(db: Pick<Db, 'execute'>, rows: NewNotification[]): Promise<void> {
  const wanted = rows.filter((r) => r.actorId !== r.recipientId)
  if (!wanted.length) return
  const values = sql.join(
    wanted.map(
      (r) => sql`(${r.recipientId}::uuid, ${r.kind}::text, ${r.actorId ?? null}::uuid, ${r.postId ?? null}::uuid,
        ${r.subjectId ?? null}::uuid, ${r.communityId ?? null}::uuid, ${r.detail ?? null}::text)`,
    ),
    sql`, `,
  )
  await db.execute(sql`
    insert into notifications (recipient_id, kind, actor_id, post_id, subject_id, community_id, detail)
    select * from (values ${values}) as v(recipient_id, kind, actor_id, post_id, subject_id, community_id, detail)
    where not exists(select 1 from notification_opt_outs o where o.member_id = v.recipient_id and o.kind = v.kind)
    on conflict do nothing`)
}

export type NotificationView = {
  id: string
  kind: NotificationKind
  createdAt: Date
  read: boolean
  /** Null for moderation decisions. */
  actor: { handle: string; displayName: string | null; avatar: string | null } | null
  /** The post concerned, with its text shortened. */
  post: { id: string; excerpt: string } | null
  /** report_resolved about an account: whose. */
  subjectHandle: string | null
  /** moderator_granted / moderator_revoked: which community. */
  community: { slug: string; name: string } | null
  detail: string | null
}

export type NotificationPage = { notifications: NotificationView[]; cursor: string | null }

const EXCERPT = 140

/**
 * Which of `viewer`'s notifications are still worth showing: the actor is active
 * and neither blocked nor muted, the post is still up, and a like, repost or
 * follow has not been taken back. A moderation decision about your own post
 * shows even though the post is down.
 */
const visible = (viewerId: string) => sql`
  n.recipient_id = ${viewerId}
  and (n.actor_id is null or (
    a.active
    and not exists(select 1 from blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = n.actor_id) or (b.blocker_id = n.actor_id and b.blocked_id = ${viewerId}))
    and not exists(select 1 from mutes mu where mu.muter_id = ${viewerId} and mu.muted_id = n.actor_id)))
  and (n.kind not in ('reply', 'like', 'repost', 'quote', 'mention', 'post_restored') or (p.deleted_at is null and p.removed_at is null))
  and (n.kind <> 'like' or exists(select 1 from likes l where l.post_id = n.post_id and l.member_id = n.actor_id))
  and (n.kind <> 'repost' or exists(select 1 from reposts r where r.post_id = n.post_id and r.member_id = n.actor_id))
  and (n.kind <> 'follow' or exists(select 1 from follows f where f.follower_id = n.actor_id and f.followee_id = ${viewerId}))`

const joins = sql`
  from notifications n
  left join members a on a.id = n.actor_id
  left join posts p on p.id = n.post_id
  left join members s on s.id = n.subject_id
  left join communities c on c.id = n.community_id`

@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Newest first, cursor-paginated. */
  async list(viewerId: string, limit: number, cursor?: string): Promise<NotificationPage> {
    let before = sql`true`
    if (cursor) {
      const [createdAt, id] = decodeCursor(cursor)
      before = sql`(n.created_at, n.id) < (${createdAt.toISOString()}::timestamptz, ${id}::uuid)`
    }
    const { rows } = await this.db.execute<{
      id: string
      kind: NotificationKind
      created_at: Date
      read_at: Date | null
      detail: string | null
      actor_handle: string | null
      actor_name: string | null
      actor_avatar: string | null
      post_id: string | null
      post_text: string | null
      subject_handle: string | null
      community_slug: string | null
      community_name: string | null
    }>(sql`
      select n.id, n.kind, n.created_at, n.read_at, n.detail,
        a.handle as actor_handle, a.display_name as actor_name, a.avatar_media_id as actor_avatar,
        p.id as post_id, p.text as post_text, s.handle as subject_handle,
        c.slug as community_slug, c.name as community_name
      ${joins}
      where ${visible(viewerId)} and ${before}
      order by n.created_at desc, n.id desc
      limit ${limit + 1}`)

    const page = rows.slice(0, limit).map(
      (r): NotificationView => ({
        id: r.id,
        kind: r.kind,
        createdAt: new Date(r.created_at),
        read: r.read_at !== null,
        actor: r.actor_handle
          ? { handle: r.actor_handle, displayName: r.actor_name, avatar: avatarPath(r.actor_avatar) }
          : null,
        post: r.post_id ? { id: r.post_id, excerpt: excerpt(r.post_text ?? '') } : null,
        subjectHandle: r.subject_handle,
        community: r.community_slug ? { slug: r.community_slug, name: r.community_name! } : null,
        detail: r.detail,
      }),
    )
    const last = page.at(-1)
    return { notifications: page, cursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null }
  }

  /** How many unread notifications would show. */
  async unreadCount(viewerId: string): Promise<number> {
    const { rows } = await this.db.execute<{ count: number }>(sql`
      select count(*)::int as count ${joins} where ${visible(viewerId)} and n.read_at is null`)
    return rows[0]?.count ?? 0
  }

  /**
   * Marks read everything up to `newestSeenId`, the newest notification the
   * member has seen, so one that arrives while they read stays unread. Compared
   * in SQL: the database keeps microseconds that a JavaScript date would lose.
   */
  async markRead(viewerId: string, newestSeenId: string): Promise<void> {
    await this.db.execute(sql`
      update notifications set read_at = now()
      where recipient_id = ${viewerId} and read_at is null
        and created_at <= (select created_at from notifications where id = ${newestSeenId} and recipient_id = ${viewerId})`)
  }

  /** Everything is on until the member turns it off. */
  async preferences(memberId: string): Promise<NotificationPreferences> {
    const off = await this.db
      .select({ kind: notificationOptOuts.kind })
      .from(notificationOptOuts)
      .where(eq(notificationOptOuts.memberId, memberId))
    return preferencesWithout(off.map((r) => r.kind))
  }

  /**
   * Turns kinds on (true) or off (false); kinds left out stay as they are. Only
   * other members' activity can be turned off: asking to turn off a moderation
   * or account notice changes nothing and throws NotOptionalError.
   */
  async setPreferences(
    memberId: string,
    changes: Partial<Record<NotificationKind, boolean>>,
  ): Promise<NotificationPreferences> {
    const entries = Object.entries(changes).filter(([, on]) => on !== undefined)
    const always = entries.map(([kind]) => kind).filter((kind) => !isOptional(kind))
    if (always.length) throw new NotOptionalError(`always sent: ${always.join(', ')}`)
    const turnedOff = entries.filter(([, on]) => !on).map(([kind]) => kind as OptionalNotificationKind)
    const turnedOn = entries.filter(([, on]) => on).map(([kind]) => kind as OptionalNotificationKind)
    await this.db.transaction(async (tx) => {
      if (turnedOff.length) {
        await tx
          .insert(notificationOptOuts)
          .values(turnedOff.map((kind) => ({ memberId, kind })))
          .onConflictDoNothing()
      }
      if (turnedOn.length) {
        await tx
          .delete(notificationOptOuts)
          .where(and(eq(notificationOptOuts.memberId, memberId), inArray(notificationOptOuts.kind, turnedOn)))
      }
    })
    return this.preferences(memberId)
  }
}

const excerpt = (text: string) => {
  // By code point, so an emoji is never cut in half.
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  return chars.length > EXCERPT ? `${chars.slice(0, EXCERPT - 1).join('').trimEnd()}…` : chars.join('')
}
