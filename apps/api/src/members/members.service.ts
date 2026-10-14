import { blocks, type Db, follows, members, mutes } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, ilike, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { avatarPath } from '../media/media.service.js'
import { notify } from '../notifications/notifications.service.js'
import { cleanLine, cleanLines, graphemes } from '../text.js'
import { DB } from '../tokens.js'

export const DISPLAY_NAME_MAX = 50
export const BIO_MAX = 160

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
}

export class CannotFollowSelfError extends Error {}

// Written out because Drizzle drops the table name from `${members.id}` in a query
// without joins, and inside a subquery a bare "id" would bind to the inner table.
const outerId = sql`"members"."id"`

@Injectable()
export class MembersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Active members only: a suspended member's profile is not found. */
  private async idForHandle(handle: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.handle, handle), eq(members.active, true)))
      // Handles are unique in Kratos; our copy can briefly lag a rename, in which
      // case the member seen most recently is the current owner.
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
      })
      .from(members)
      .where(eq(members.id, id))
    // To someone they have blocked, a member simply does not exist.
    if (!row || row.blockedByThem) return null
    const { blockedByThem: _hidden, avatarMediaId, ...profile } = row
    return { ...profile, avatar: avatarPath(avatarMediaId), isSelf: row.id === viewerId }
  }

  /** Replaces the member's name and bio with already-validated values. */
  async updateProfile(memberId: string, profile: z.infer<typeof profileInput>): Promise<void> {
    await this.db
      .update(members)
      .set({ displayName: profile.displayName, bio: profile.bio })
      .where(eq(members.id, memberId))
  }

  /** Idempotent. False if there is no such member. */
  async follow(followerId: string, handle: string): Promise<boolean> {
    const followeeId = await this.idForHandle(handle)
    if (!followeeId) return false
    if (followeeId === followerId) throw new CannotFollowSelfError('you cannot follow yourself')
    if (await this.blockedEitherWay(followerId, followeeId)) return false
    await this.db.insert(follows).values({ followerId, followeeId }).onConflictDoNothing()
    await notify(this.db, [{ recipientId: followeeId, kind: 'follow', actorId: followerId }])
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

  private async blockedEitherWay(a: string, b: string): Promise<boolean> {
    const rows = await this.db
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
