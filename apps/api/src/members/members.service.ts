import { blocks, type Db, follows, members, mutes, releasedHandles } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, ilike, like, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Env } from '../env.js'
import { avatarPath } from '../media/media.service.js'
import { notify } from '../notifications/notifications.service.js'
import { cleanLine, cleanLines, graphemes } from '../text.js'
import { DB, ENV } from '../tokens.js'

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

export type MemberSummary = { handle: string; displayName: string | null; avatar: string | null }

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
}

export class CannotFollowSelfError extends Error {}

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
    const [owner] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(memberId ? and(eq(members.handle, handle), ne(members.id, memberId)) : eq(members.handle, handle))
      .limit(1)
    if (owner) return true
    const [hold] = await this.db
      .select({ memberId: releasedHandles.memberId })
      .from(releasedHandles)
      .where(and(eq(releasedHandles.handle, handle), held))
    return Boolean(hold && hold.memberId !== memberId)
  }

  /** Current owner, if the handle is presently assigned rather than merely held. */
  async currentHandleOwner(handle: string): Promise<string | null> {
    const [owner] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.handle, handle))
      .limit(1)
    return owner?.id ?? null
  }

  /** Applies a provider-reported handle under application ownership policy. */
  async syncHandle(memberId: string, handle: string): Promise<void> {
    const [member] = await this.db.select({ handle: members.handle }).from(members).where(eq(members.id, memberId))
    if (!member || member.handle === handle) return
    if (await this.handleHeld(handle, memberId)) throw new Error('handle_unavailable')
    await this.holdHandle(memberId, member.handle)
    await this.db.update(members).set({ handle }).where(eq(members.id, memberId))
  }

  /**
   * Holds `handle` for `memberId`, who is about to rename away from it. Called
   * before Kratos saves the rename: if the save fails they keep the handle, and a
   * hold on a handle its owner still has changes nothing.
   */
  async holdHandle(memberId: string, handle: string): Promise<void> {
    // A member the API has never seen has no row to hold it for (and no links yet).
    const [member] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, memberId))
    if (!member) return
    await this.db
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
      .select({ handle: members.handle, displayName: members.displayName, avatarMediaId: members.avatarMediaId })
      .from(members)
      .where(and(or(byHandle, byName), eq(members.active, true)))
      .orderBy(...(byHandle ? [sql`${byHandle} desc`] : []), asc(members.handle))
      .limit(limit)
    return rows.map((r) => ({ handle: r.handle, displayName: r.displayName, avatar: avatarPath(r.avatarMediaId) }))
  }
}
