import { communities, communityMemberships, type Db, members } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm'
import { DB } from '../tokens.js'

export type CommunitySummary = {
  id: string
  slug: string
  name: string
  description: string
  memberCount: number
  /** Always false for anonymous viewers. */
  viewerIsMember: boolean
}

export type CommunityDetail = CommunitySummary & {
  rules: string
  /** Handles of the people who moderate it. */
  moderators: string[]
}

// Written out so the outer community is unambiguous inside the subqueries.
const outerId = sql`"communities"."id"`

@Injectable()
export class CommunitiesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private summary(viewerId: string | null) {
    return {
      id: communities.id,
      slug: communities.slug,
      name: communities.name,
      description: communities.description,
      // Active members only, matching every other count in the app.
      memberCount: sql<number>`(select count(*)::int from community_memberships cm join members m on m.id = cm.member_id and m.active where cm.community_id = ${outerId})`,
      viewerIsMember: viewerId
        ? sql<boolean>`exists(select 1 from community_memberships cm where cm.community_id = ${outerId} and cm.member_id = ${viewerId})`
        : sql<boolean>`false`,
    }
  }

  list(viewerId: string | null): Promise<CommunitySummary[]> {
    return this.db
      .select(this.summary(viewerId))
      .from(communities)
      .where(eq(communities.active, true))
      .orderBy(asc(communities.name))
  }

  /** Active communities whose name or description mentions `query`. */
  search(viewerId: string | null, query: string, limit: number): Promise<CommunitySummary[]> {
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    return this.db
      .select(this.summary(viewerId))
      .from(communities)
      .where(
        and(
          eq(communities.active, true),
          or(ilike(communities.name, pattern), ilike(communities.description, pattern)),
        ),
      )
      .orderBy(asc(communities.name))
      .limit(limit)
  }

  async detail(viewerId: string | null, slug: string): Promise<CommunityDetail | null> {
    const [row] = await this.db
      .select({ ...this.summary(viewerId), rules: communities.rules })
      .from(communities)
      .where(and(eq(communities.slug, slug), eq(communities.active, true)))
    if (!row) return null

    const moderators = await this.db
      .select({ handle: members.handle })
      .from(communityMemberships)
      .innerJoin(members, eq(members.id, communityMemberships.memberId))
      .where(
        and(
          eq(communityMemberships.communityId, row.id),
          eq(communityMemberships.role, 'moderator'),
          eq(members.active, true),
        ),
      )
      .orderBy(asc(members.handle))
    return { ...row, moderators: moderators.map((m) => m.handle) }
  }

  private async idForSlug(slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: communities.id })
      .from(communities)
      .where(and(eq(communities.slug, slug), eq(communities.active, true)))
    return row?.id ?? null
  }

  /** Idempotent. False if there is no such community. */
  async join(memberId: string, slug: string): Promise<boolean> {
    const communityId = await this.idForSlug(slug)
    if (!communityId) return false
    await this.db.insert(communityMemberships).values({ communityId, memberId }).onConflictDoNothing()
    return true
  }

  /** Idempotent. False if there is no such community. Posts already made stay. */
  async leave(memberId: string, slug: string): Promise<boolean> {
    const communityId = await this.idForSlug(slug)
    if (!communityId) return false
    await this.db
      .delete(communityMemberships)
      .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.memberId, memberId)))
    return true
  }
}
