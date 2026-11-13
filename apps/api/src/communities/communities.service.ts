import { communities, communityMemberships, type Db, members, posts } from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { communityOpenTo, LabelNotAllowedError, seesAdultContent } from '../governance/adult-content.js'
import { communityPhotoPath, MEDIA_JOBS, type PlacementJobs } from '../media/media.service.js'
import type { Queries } from '../members/members.service.js'
import { NotACommunityModeratorError } from '../posts/posts.service.js'
import { DB } from '../tokens.js'
import { isSiteModerator, managesPhoto } from './photo-managers.js'

export type CommunitySummary = {
  id: string
  slug: string
  name: string
  description: string
  memberCount: number
  /** Path of the community's square photo without the size suffix; null shows the subject icon. */
  photo: string | null
  /** Always false for anonymous viewers. */
  viewerIsMember: boolean
}

export type CommunityDetail = CommunitySummary & {
  rules: string
  /** Marked sensitive (ADR 0020): only adults are sent it, and every post in it is marked. */
  sensitive: boolean
  /** Whether the viewer may mark it sensitive or take the mark off: its moderators and site moderators who count as adults. */
  viewerCanMarkSensitive: boolean
  /** Handles of the people who moderate it. */
  moderators: string[]
  /** Whether the viewer may add, replace or remove the photo: its moderators and site moderators. */
  viewerCanManagePhoto: boolean
  /** Whether the viewer is a site moderator, who can also take a photo down. */
  viewerIsSiteModerator: boolean
}

/** Swaps the stored media id for the path the web app serves it from. */
const withPhoto = <T extends { photoMediaId: string | null }>({ photoMediaId, ...rest }: T): Omit<T, 'photoMediaId'> & { photo: string | null } => ({
  ...rest,
  photo: communityPhotoPath(photoMediaId),
})

// Written out so the outer community is unambiguous inside the subqueries.
const outerId = sql`"communities"."id"`

/** Whether a post has pictures or a video, whose files move to match its mark (ADR 0025). */
const withMedia = sql<boolean>`exists(select 1 from media m where m.post_id = "posts"."id" and m.kind in ('post_image', 'post_video'))`

@Injectable()
export class CommunitiesService {
  private readonly log = new Logger(CommunitiesService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    // Moves posts' files when the community's mark changes. Optional so tests about communities alone need no queue.
    @Optional() @Inject(MEDIA_JOBS) private readonly placement?: PlacementJobs,
  ) {}

  private summary(viewerId: string | null) {
    return {
      photoMediaId: communities.photoMediaId,
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

  async list(viewerId: string | null): Promise<CommunitySummary[]> {
    const rows = await this.db
      .select(this.summary(viewerId))
      .from(communities)
      .where(and(eq(communities.active, true), communityOpenTo(viewerId)))
      .orderBy(asc(communities.name))
    return rows.map(withPhoto)
  }

  /** Active communities whose name or description mentions `query`. */
  async search(viewerId: string | null, query: string, limit: number): Promise<CommunitySummary[]> {
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const rows = await this.db
      .select(this.summary(viewerId))
      .from(communities)
      .where(
        and(
          eq(communities.active, true),
          communityOpenTo(viewerId),
          or(ilike(communities.name, pattern), ilike(communities.description, pattern)),
        ),
      )
      .orderBy(asc(communities.name))
      .limit(limit)
    return rows.map(withPhoto)
  }

  async detail(viewerId: string | null, slug: string): Promise<CommunityDetail | null> {
    const [row] = await this.db
      .select({
        ...this.summary(viewerId),
        rules: communities.rules,
        sensitive: communities.adultOnly,
        viewerCanManagePhoto: viewerId ? managesPhoto(viewerId) : sql<boolean>`false`,
        viewerCanMarkSensitive: viewerId ? sql<boolean>`(${managesPhoto(viewerId)} and ${seesAdultContent(viewerId)})` : sql<boolean>`false`,
        viewerIsSiteModerator: viewerId ? isSiteModerator(viewerId) : sql<boolean>`false`,
      })
      .from(communities)
      .where(and(eq(communities.slug, slug), eq(communities.active, true), communityOpenTo(viewerId)))
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
    return { ...withPhoto(row), moderators: moderators.map((m) => m.handle) }
  }

  /** Only a community `memberId` may see: one marked sensitive is not there for anyone who is not an adult. */
  private async idForSlug(slug: string, memberId: string, db: Queries = this.db): Promise<string | null> {
    const [row] = await db
      .select({ id: communities.id })
      .from(communities)
      .where(and(eq(communities.slug, slug), eq(communities.active, true), communityOpenTo(memberId)))
    return row?.id ?? null
  }

  /**
   * Idempotent. False if there is no such community, or none the member may see.
   * Runs in `db` when given a transaction (the welcome flow joins several at once).
   */
  async join(memberId: string, slug: string, db: Queries = this.db): Promise<boolean> {
    const communityId = await this.idForSlug(slug, memberId, db)
    if (!communityId) return false
    await db.insert(communityMemberships).values({ communityId, memberId }).onConflictDoNothing()
    return true
  }

  /**
   * Idempotent. False if there is no such community. Posts already made stay.
   * Leaving works even where the member may no longer see the community.
   */
  async leave(memberId: string, slug: string): Promise<boolean> {
    const [community] = await this.db
      .select({ id: communities.id })
      .from(communities)
      .where(and(eq(communities.slug, slug), eq(communities.active, true)))
    if (!community) return false
    await this.db
      .delete(communityMemberships)
      .where(and(eq(communityMemberships.communityId, community.id), eq(communityMemberships.memberId, memberId)))
    return true
  }

  /**
   * Marks the community sensitive (ADR 0020, question 8), or takes the mark off.
   * Only its moderators and site moderators may, and marking needs an adult.
   * Marked, every post in it carries the 'community' mark, which nobody but the
   * community's moderators takes off, and only adults see the community at all;
   * unmarked, posts keep only their own or a moderator's mark. Idempotent. False
   * if there is no such community, or none the member may see.
   */
  async setSensitive(memberId: string, slug: string, on: boolean): Promise<boolean> {
    const changed = await this.db.transaction(async (tx) => {
      // Locked, so a post written meanwhile takes the community's new mark (PostsService.create).
      const [community] = await tx
        .select({ id: communities.id, allowed: managesPhoto(memberId), adult: seesAdultContent(memberId) })
        .from(communities)
        .where(and(eq(communities.slug, slug), eq(communities.active, true), communityOpenTo(memberId)))
        .for('update')
      if (!community) return null
      if (!community.allowed) throw new NotACommunityModeratorError('only its moderators can mark a community sensitive')
      if (on && !community.adult) throw new LabelNotAllowedError('only adults can mark a community sensitive')
      await tx.update(communities).set({ adultOnly: on }).where(eq(communities.id, community.id))
      return tx
        .update(posts)
        .set({ adultLabel: on ? 'community' : null })
        .where(and(eq(posts.communityId, community.id), on ? isNull(posts.adultLabel) : eq(posts.adultLabel, 'community')))
        .returning({ id: posts.id, hasMedia: withMedia })
    })
    if (!changed) return false
    // Their pictures and video follow the mark: private while it is on (ADR 0025).
    // A queue that cannot take a job does not fail the request: the hourly sweep
    // moves files whose place and mark disagree.
    for (const { id } of changed.filter((post) => post.hasMedia)) {
      try {
        await this.placement?.placePostMedia(id)
      } catch (err) {
        this.log.error(`queueing the move of post ${id}'s media for its community's mark failed; the hourly sweep will move it: ${(err as Error).message}`)
      }
    }
    return true
  }
}
