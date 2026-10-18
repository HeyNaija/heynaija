import { type Db, members } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import { CommunitiesService } from '../communities/communities.service.js'
import { avatarPath } from '../media/media.service.js'
import { CannotFollowSelfError, MembersService } from '../members/members.service.js'
import { DB } from '../tokens.js'

/** How many people the welcome flow suggests following. */
export const SUGGESTION_LIMIT = 12
/** Posting in this many days counts as being active. */
export const ACTIVE_WITHIN_DAYS = 30

/**
 * Why someone is suggested: they moderate a community the newcomer chose, they
 * posted in one lately, or (to fill the list) they posted anywhere lately.
 */
export type SuggestionReason =
  | { kind: 'moderator' | 'community'; community: { slug: string; name: string } }
  | { kind: 'recent'; community: null }

export type Suggestion = {
  handle: string
  displayName: string | null
  avatar: string | null
  bio: string
  reason: SuggestionReason
}

export type OnboardingChoices = { communities: string[]; follow: string[] }

const TIERS = ['moderator', 'community', 'recent'] as const

// Public activity only: a post that is still up, or a moderator role that every
// community page lists.
const live = sql`p.deleted_at is null and p.removed_at is null`
const recent = sql`p.created_at > now() - make_interval(days => ${ACTIVE_WITHIN_DAYS})`

/**
 * The welcome flow at /welcome: a newcomer picks communities, then people to
 * follow, and lands in a Following feed that already has something in it.
 * `members.onboarded_at` records that they finished or skipped it.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CommunitiesService) private readonly communities: CommunitiesService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  /**
   * Up to SUGGESTION_LIMIT people for `viewerId` to follow: who moderates the
   * communities in `slugs`, then who posted in them lately (most recent first),
   * then who posted anywhere lately. Never the viewer, a suspended member,
   * anyone either of them has blocked, or anyone they already follow or mute.
   */
  async suggestions(viewerId: string, slugs: string[]): Promise<Suggestion[]> {
    const { rows } = await this.db.execute<{
      handle: string
      display_name: string | null
      avatar_media_id: string | null
      bio: string
      tier: number
      slug: string | null
      name: string | null
    }>(sql`
      with chosen as (
        select id, slug, name from communities where active and slug = any(${sql.param(slugs)}::text[])
      ), candidates as (
        select cm.member_id, 0 as tier, c.slug, c.name,
          (select max(p.created_at) from posts p where p.author_id = cm.member_id and ${live}) as at
        from community_memberships cm join chosen c on c.id = cm.community_id
        where cm.role = 'moderator'
        union all
        select p.author_id, 1, c.slug, c.name, max(p.created_at)
        from posts p join chosen c on c.id = p.community_id
        where ${live} and ${recent}
        group by p.author_id, c.slug, c.name
        union all
        select p.author_id, 2, null, null, max(p.created_at)
        from posts p
        where ${live} and ${recent}
        group by p.author_id
      ), best as (
        select distinct on (member_id) member_id, tier, slug, name, at
        from candidates
        order by member_id, tier, at desc nulls last
      )
      select m.handle, m.display_name, m.avatar_media_id, m.bio, b.tier, b.slug, b.name
      from best b join members m on m.id = b.member_id
      where m.active and m.id <> ${viewerId}
        and not exists (select 1 from blocks bl where (bl.blocker_id = ${viewerId} and bl.blocked_id = m.id)
          or (bl.blocker_id = m.id and bl.blocked_id = ${viewerId}))
        and not exists (select 1 from mutes mu where mu.muter_id = ${viewerId} and mu.muted_id = m.id)
        and not exists (select 1 from follows f where f.follower_id = ${viewerId} and f.followee_id = m.id)
      order by b.tier, b.at desc nulls last, m.handle
      limit ${SUGGESTION_LIMIT}`)

    return rows.map((r) => {
      const kind = TIERS[r.tier]!
      return {
        handle: r.handle,
        displayName: r.display_name,
        avatar: avatarPath(r.avatar_media_id),
        bio: r.bio,
        reason:
          kind === 'recent' || !r.slug || !r.name
            ? { kind: 'recent', community: null }
            : { kind, community: { slug: r.slug, name: r.name } },
      }
    })
  }

  /**
   * Joins the chosen communities and follows the chosen people, all or nothing,
   * through the same code as joining or following one at a time, and marks the
   * member onboarded. Communities and people that are no longer there (or that
   * the member may not follow) are passed over. Says what was done.
   */
  async complete(memberId: string, choices: OnboardingChoices): Promise<{ joined: string[]; followed: string[] }> {
    return this.db.transaction(async (tx) => {
      const joined: string[] = []
      for (const slug of new Set(choices.communities)) {
        if (await this.communities.join(memberId, slug, tx)) joined.push(slug)
      }
      const followed: string[] = []
      for (const handle of new Set(choices.follow)) {
        try {
          if (await this.members.follow(memberId, handle, tx)) followed.push(handle)
        } catch (err) {
          // Thrown before anything is written, so the transaction carries on.
          if (!(err instanceof CannotFollowSelfError)) throw err
        }
      }
      await this.markOnboarded(memberId, tx)
      return { joined, followed }
    })
  }

  /** The member chose to find their own way. */
  async skip(memberId: string): Promise<void> {
    await this.markOnboarded(memberId, this.db)
  }

  /** Keeps the first time: going through the flow again changes nothing. */
  private async markOnboarded(memberId: string, db: Pick<Db, 'update'>): Promise<void> {
    await db
      .update(members)
      .set({ onboardedAt: sql`coalesce(${members.onboardedAt}, now())` })
      .where(eq(members.id, memberId))
  }
}
