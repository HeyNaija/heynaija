import { blocks, type Db, follows, members, mutes, profileBadges, releasedHandles } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, ilike, like, ne, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { packCursor, unpackCursor } from '../cursor.js'
import type { Env } from '../env.js'
import { avatarPath } from '../media/media.service.js'
import { notify } from '../notifications/notifications.service.js'
import { cleanLine, cleanLines, graphemes } from '../text.js'
import { DB, ENV } from '../tokens.js'
import { isFounder } from './badges.js'

export const DISPLAY_NAME_MAX = 50
export const BIO_MAX = 160
/** How long a handle given up by renaming stays its previous owner's to take back. */
export const HANDLE_HOLD_DAYS = 30

const held = sql`${releasedHandles.releasedAt} > now() - make_interval(days => ${HANDLE_HOLD_DAYS})`

/**
 * Who each of `handles` leads to now, as /u/<handle> would: the active member
 * who has it, or else the active member who gave it up in the last
 * HANDLE_HOLD_DAYS. Handles that lead nobody are left out. Takes a transaction.
 */
export async function membersForHandles(db: Pick<Db, 'execute'>, handles: string[]): Promise<Map<string, string>> {
  if (!handles.length) return new Map()
  const { rows } = await db.execute<{ handle: string; member_id: string | null }>(sql`
    select h.handle, coalesce(
      (select m.id from members m where m.handle = h.handle and m.active
        order by m.last_seen_at desc nulls last limit 1),
      (select r.member_id from released_handles r join members m on m.id = r.member_id
        where r.handle = h.handle and r.released_at > now() - make_interval(days => ${HANDLE_HOLD_DAYS})
          and m.active and m.handle <> h.handle)
    ) as member_id
    from unnest(${sql.param(handles)}::text[]) as h(handle)`)
  return new Map(rows.flatMap((r) => (r.member_id ? [[r.handle, r.member_id] as const] : [])))
}

/** The database, or a transaction on it. */
export type Queries = Pick<Db, 'select' | 'insert' | 'execute'>

const atMost = (max: number) => (t: string) => t.length <= max * 16 && graphemes(t) <= max

/** What a member can say about themselves. An empty name means "just my handle". */
export const profileInput = z.object({
  displayName: z
    .string()
    .transform(cleanLine)
    .refine(atMost(DISPLAY_NAME_MAX), `name is longer than ${DISPLAY_NAME_MAX} characters`)
    .transform((t) => t || null),
  bio: z.string().transform(cleanLines).refine(atMost(BIO_MAX), `bio is longer than ${BIO_MAX} characters`),
})

export type MemberSummary = {
  handle: string
  displayName: string | null
  avatar: string | null
  /** One of the people who founded HeyNaija. */
  founder: boolean
}

/** A member offered while typing an @mention. */
export type MentionSuggestion = MemberSummary & {
  /** The viewer follows them; they are listed first (after the exact handle). */
  following: boolean
}

/** How many @mention suggestions come in one page. */
export const MENTION_SUGGEST_MAX = 10

/** A page of @mention suggestions; `cursor` asks for the next, null at the end. */
export type MentionPage = { members: MentionSuggestion[]; cursor: string | null }

// The longest sort key is a lower-cased name: at most this many UTF-16 units (see atMost).
const MENTION_KEY_MAX = DISPLAY_NAME_MAX * 16
/** How long a cursor can be: its JSON in UTF-8 (at most 3 bytes a unit, as names have no control characters), in base64url. */
export const MENTION_CURSOR_MAX = Math.ceil((MENTION_KEY_MAX * 3 + 64) / 3) * 4

// Where a page stopped: the part of the list (exact and followed, by handle, by name) and its sort keys there.
const mentionCursor = z.tuple([z.number().int().min(0).max(2), z.string().max(MENTION_KEY_MAX), z.string().max(40)])

export type Profile = {
  id: string
  handle: string
  displayName: string | null
  bio: string
  /** Path of the profile photo without the size suffix, or null. */
  avatar: string | null
  joinedAt: Date
  postCount: number
  followerCount: number
  followingCount: number
  isSelf: boolean
  /** Always false for anonymous viewers. */
  viewerFollows: boolean
  viewerBlocks: boolean
  viewerMutes: boolean
  /** Whether to show the green "NIN identity verified" tick. */
  identityBadge: boolean
  /** One of the people who founded HeyNaija (`pnpm founder:grant`), for good. */
  founderBadge: boolean
}

export class CannotFollowSelfError extends Error {}
export class NoSuchMemberError extends Error {}

// Written out because Drizzle drops the table name from `${members.id}` in a query
// without joins, and inside a subquery a bare "id" would bind to the inner table.
const outerId = sql`"members"."id"`

@Injectable()
export class MembersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    // Tests that never touch badges may leave this out: badges then stay hidden.
    @Inject(ENV) private readonly env: Pick<Env, 'NIN_VERIFICATION_ENABLED'> = { NIN_VERIFICATION_ENABLED: false },
  ) {}

  /** Active members only: a suspended member's profile is not found. */
  private async idForHandle(handle: string, db: Queries = this.db): Promise<string | null> {
    const [row] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.handle, handle), eq(members.active, true)))
      // Kratos keeps handles unique (they are credential identifiers in its
      // identity schema); our copy can briefly lag a rename, in which case the
      // member seen most recently is the current owner.
      .orderBy(sql`${members.lastSeenAt} desc nulls last`)
      .limit(1)
    return row?.id ?? null
  }

  async profile(viewerId: string | null, handle: string): Promise<Profile | null> {
    const id = await this.idForHandle(handle)
    if (!id) return null

    // Counts only include active members, matching what the lists would show.
    const [row] = await this.db
      .select({
        id: members.id,
        handle: members.handle,
        displayName: members.displayName,
        bio: members.bio,
        avatarMediaId: members.avatarMediaId,
        joinedAt: members.createdAt,
        postCount: sql<number>`(select count(*)::int from posts p where p.author_id = ${outerId} and p.deleted_at is null)`,
        followerCount: sql<number>`(select count(*)::int from follows f join members m on m.id = f.follower_id and m.active where f.followee_id = ${outerId})`,
        followingCount: sql<number>`(select count(*)::int from follows f join members m on m.id = f.followee_id and m.active where f.follower_id = ${outerId})`,
        viewerFollows: viewerId
          ? sql<boolean>`exists(select 1 from follows f where f.follower_id = ${viewerId} and f.followee_id = ${outerId})`
          : sql<boolean>`false`,
        viewerBlocks: viewerId
          ? sql<boolean>`exists(select 1 from blocks b where b.blocker_id = ${viewerId} and b.blocked_id = ${outerId})`
          : sql<boolean>`false`,
        viewerMutes: viewerId
          ? sql<boolean>`exists(select 1 from mutes mu where mu.muter_id = ${viewerId} and mu.muted_id = ${outerId})`
          : sql<boolean>`false`,
        blockedByThem: viewerId
          ? sql<boolean>`exists(select 1 from blocks b where b.blocker_id = ${outerId} and b.blocked_id = ${viewerId})`
          : sql<boolean>`false`,
        // The green identity tick: only from a profile_badges row, which
        // GovernanceService writes for a reviewed, current verification the
        // member chose to show, and never while verification is switched off.
        identityBadge: this.env.NIN_VERIFICATION_ENABLED
          ? sql<boolean>`exists(select 1 from profile_badges pb where pb.member_id = ${outerId} and pb.kind = 'nin_identity_verified' and (pb.expires_at is null or pb.expires_at > now()))`
          : sql<boolean>`false`,
        founderBadge: isFounder(outerId),
      })
      .from(members)
      .where(eq(members.id, id))
    // To someone they have blocked, a member simply does not exist.
    if (!row || row.blockedByThem) return null
    const { blockedByThem: _hidden, avatarMediaId, ...profile } = row
    return { ...profile, avatar: avatarPath(avatarMediaId), isSelf: row.id === viewerId }
  }

  /**
   * Whether `handle` was given up in the last HANDLE_HOLD_DAYS by someone other
   * than `memberId` (null for someone signing up), so it is not theirs to take.
   */
  async handleHeld(handle: string, memberId: string | null): Promise<boolean> {
    const [hold] = await this.db
      .select({ memberId: releasedHandles.memberId })
      .from(releasedHandles)
      .where(and(eq(releasedHandles.handle, handle), held))
    return Boolean(hold && hold.memberId !== memberId)
  }

  /**
   * Holds `handle` for `memberId`, who is about to rename away from it, or whose
   * account is being erased. Called before Kratos saves the rename: if the save
   * fails they keep the handle, and a hold on a handle its owner still has
   * changes nothing. Runs in `db` when given a transaction (the erase).
   */
  async holdHandle(memberId: string, handle: string, db: Queries = this.db): Promise<void> {
    // A member the API has never seen has no row to hold it for (and no links yet).
    const [member] = await db.select({ id: members.id }).from(members).where(eq(members.id, memberId))
    if (!member) return
    await db
      .insert(releasedHandles)
      .values({ handle, memberId })
      .onConflictDoUpdate({ target: releasedHandles.handle, set: { memberId, releasedAt: sql`now()` } })
  }

  /**
   * For a handle nobody has now: the handle now used by the member who gave it up
   * in the last HANDLE_HOLD_DAYS, so /u/<old handle> can lead there. Null if
   * there is none, they are suspended, or they have blocked the viewer.
   */
  async movedTo(viewerId: string | null, handle: string): Promise<string | null> {
    const [row] = await this.db
      .select({ handle: members.handle })
      .from(releasedHandles)
      .innerJoin(members, eq(members.id, releasedHandles.memberId))
      .where(
        and(
          eq(releasedHandles.handle, handle),
          held,
          eq(members.active, true),
          ne(members.handle, handle),
          viewerId
            ? sql`not exists (select 1 from ${blocks} b where b.blocker_id = ${members.id} and b.blocked_id = ${viewerId})`
            : undefined,
        ),
      )
    return row?.handle ?? null
  }

  /** Replaces the member's name and bio with already-validated values. */
  async updateProfile(memberId: string, profile: z.infer<typeof profileInput>): Promise<void> {
    await this.db
      .update(members)
      .set({ displayName: profile.displayName, bio: profile.bio })
      .where(eq(members.id, memberId))
  }

  /**
   * Idempotent. False if there is no such member, or either has blocked the other.
   * Runs in `db` when given a transaction (the welcome flow follows several at once).
   */
  async follow(followerId: string, handle: string, db: Queries = this.db): Promise<boolean> {
    const followeeId = await this.idForHandle(handle, db)
    if (!followeeId) return false
    if (followeeId === followerId) throw new CannotFollowSelfError('you cannot follow yourself')
    if (await this.blockedEitherWay(followerId, followeeId, db)) return false
    await db.insert(follows).values({ followerId, followeeId }).onConflictDoNothing()
    await notify(db, [{ recipientId: followeeId, kind: 'follow', actorId: followerId }])
    return true
  }

  /** Idempotent. False if there is no such member. */
  async unfollow(followerId: string, handle: string): Promise<boolean> {
    const followeeId = await this.idForHandle(handle)
    if (!followeeId) return false
    await this.db
      .delete(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
    return true
  }

  private async blockedEitherWay(a: string, b: string, db: Queries = this.db): Promise<boolean> {
    const rows = await db
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
          and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  /**
   * Idempotent. Also ends any follow between the two, in both directions. False
   * if there is no such member (or it is the viewer themselves).
   */
  async block(blockerId: string, handle: string): Promise<boolean> {
    const blockedId = await this.idForHandle(handle)
    if (!blockedId || blockedId === blockerId) return false
    await this.db.transaction(async (tx) => {
      await tx.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing()
      await tx
        .delete(follows)
        .where(
          or(
            and(eq(follows.followerId, blockerId), eq(follows.followeeId, blockedId)),
            and(eq(follows.followerId, blockedId), eq(follows.followeeId, blockerId)),
          ),
        )
    })
    return true
  }

  /** Idempotent. Works even if the other member has since been suspended. */
  async unblock(blockerId: string, handle: string): Promise<void> {
    const blocked = this.db.select({ id: members.id }).from(members).where(eq(members.handle, handle))
    await this.db.delete(blocks).where(and(eq(blocks.blockerId, blockerId), sql`${blocks.blockedId} in ${blocked}`))
  }

  /** Idempotent. False if there is no such member (or it is the viewer themselves). */
  async mute(muterId: string, handle: string): Promise<boolean> {
    const mutedId = await this.idForHandle(handle)
    if (!mutedId || mutedId === muterId) return false
    await this.db.insert(mutes).values({ muterId, mutedId }).onConflictDoNothing()
    return true
  }

  /** Idempotent. */
  async unmute(muterId: string, handle: string): Promise<void> {
    const muted = this.db.select({ id: members.id }).from(members).where(eq(members.handle, handle))
    await this.db.delete(mutes).where(and(eq(mutes.muterId, muterId), sql`${mutes.mutedId} in ${muted}`))
  }

  /**
   * Active members whose handle starts with `query`, or whose name contains it.
   * Handle matches come first.
   */
  async search(query: string, limit: number): Promise<MemberSummary[]> {
    // Handles are [a-z0-9_]; anything else cannot match, and "_" must not act as a wildcard.
    const handlePrefix = query.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '')
    const name = cleanLine(query.replace(/^@/, ''))
    if (!handlePrefix && !name) return []
    const escape = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`)
    const byHandle = handlePrefix ? like(members.handle, `${escape(handlePrefix)}%`) : undefined
    const byName = name ? ilike(members.displayName, `%${escape(name)}%`) : undefined
    const rows = await this.db
      .select({
        handle: members.handle,
        displayName: members.displayName,
        avatarMediaId: members.avatarMediaId,
        founder: isFounder(outerId),
      })
      .from(members)
      .where(and(or(byHandle, byName), eq(members.active, true)))
      .orderBy(...(byHandle ? [sql`${byHandle} desc`] : []), asc(members.handle))
      .limit(limit)
    return rows.map(({ avatarMediaId, ...r }) => ({ ...r, avatar: avatarPath(avatarMediaId) }))
  }

  /**
   * Members for an @mention: the one whose handle is exactly what was typed,
   * then everyone the viewer follows, then others by handle, then by name; each
   * part pages along its own index.
   */
  async suggestMentions(viewerId: string, prefix: string, cursor?: string, limit = MENTION_SUGGEST_MAX): Promise<MentionPage> {
    const p = prefix.toLowerCase()
    if (!/^[a-z0-9_]{1,20}$/.test(p)) return { members: [], cursor: null }
    const [part, key, tie] = cursor ? unpackCursor(mentionCursor, cursor) : [0, '', '']
    // Skips parts already done, and in the current one starts after the cursor.
    const from = (n: number, keys: SQL, k: SQL) =>
      !cursor || n > part ? sql`true` : n < part ? sql`false` : sql`${k} >= ${key} and ${keys} > (${key}, ${tie})`
    // "_" is a LIKE wildcard; nothing else in a handle is.
    const starts = `${p.replace(/_/g, '\\_')}%`
    const wordStarts = `% ${starts}`
    const handle = sql`m.handle collate "C"`
    const name = sql`lower(m.display_name) collate "C"`
    // Within part 0: the exact handle ('0'), then followed handle starts ('1'), then followed name words ('2').
    const order = sql`case when ${handle} like ${starts} then '1' else '2' end`
    const visible = sql`m.active and m.id <> ${viewerId}
      and not exists(select 1 from blocks b where (b.blocker_id = m.id and b.blocked_id = ${viewerId})
        or (b.blocker_id = ${viewerId} and b.blocked_id = m.id))`
    const unfollowed = sql`not exists(select 1 from follows nf where nf.follower_id = ${viewerId} and nf.followee_id = m.id)`
    const { rows } = await this.db.execute<{
      part: number
      key: string
      tie: string
      following: boolean
      handle: string
      display_name: string | null
      avatar_media_id: string | null
      founder: boolean
    }>(sql`
      with found as (
        (select m.id, 0 as part, '0'::text as key, m.handle as tie, not ${unfollowed} as following from members m
          where m.handle = ${p} and ${visible}
            and ${from(0, sql`('0'::text, ${handle})`, sql`'0'::text`)}
          limit ${limit + 1})
        union all
        (select m.id, 0, ${order}, m.handle, true from follows f join members m on m.id = f.followee_id
          where f.follower_id = ${viewerId} and m.handle <> ${p} and ${visible}
            and (${handle} like ${starts} or ' ' || lower(m.display_name) like ${wordStarts})
            and ${from(0, sql`(${order} collate "C", ${handle})`, order)}
          order by ${order} collate "C", ${handle} limit ${limit + 1})
        union all
        (select m.id, 1, m.handle, '', false from members m
          where ${visible} and ${unfollowed} and m.handle <> ${p} and ${handle} like ${starts}
            and ${from(1, sql`(${handle}, ''::text)`, handle)}
          order by ${handle} limit ${limit + 1})
        union all
        (select m.id, 2, lower(m.display_name), m.handle, false from members m
          where ${visible} and ${unfollowed} and m.display_name is not null and ${name} like ${starts} and ${handle} not like ${starts}
            and ${from(2, sql`(${name}, ${handle})`, name)}
          order by ${name}, ${handle} limit ${limit + 1})
      )
      select f.part, f.key, f.tie, f.following, m.handle, m.display_name, m.avatar_media_id, ${isFounder(sql`m.id`)} as founder
      from found f join members m on m.id = f.id
      order by f.part, f.key collate "C", f.tie collate "C"
      limit ${limit + 1}`)
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      members: page.map((r) => ({
        handle: r.handle,
        displayName: r.display_name,
        avatar: avatarPath(r.avatar_media_id),
        founder: r.founder,
        following: r.following,
      })),
      cursor: rows.length > limit && last ? packCursor([last.part, last.key, last.tie]) : null,
    }
  }

  /**
   * Gives `handle` the Founder badge, or takes it away (the founder:grant and
   * founder:revoke commands; there is no UI for this). Returns whether anything
   * changed.
   */
  async setFounder(handle: string, on: boolean): Promise<boolean> {
    const [member] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.handle, handle))
      .orderBy(sql`${members.lastSeenAt} desc nulls last`)
      .limit(1)
    if (!member) throw new NoSuchMemberError(`no member @${handle} (they must have signed in at least once)`)
    const changed = on
      ? await this.db.insert(profileBadges).values({ memberId: member.id, kind: 'founder' }).onConflictDoNothing().returning()
      : await this.db
          .delete(profileBadges)
          .where(and(eq(profileBadges.memberId, member.id), eq(profileBadges.kind, 'founder')))
          .returning()
    return changed.length > 0
  }
}
