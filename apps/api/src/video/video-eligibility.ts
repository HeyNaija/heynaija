import { type Db, media, members, moderationActions } from '@heynaija/db'
import { and, count, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { VideoConfig } from './video-config.js'
import { VideoError } from './video-error.js'

/** Moderation actions that count as "upheld" against the account for the trust rule (ADR 4.7). */
const UPHELD_AGAINST_MEMBER = ['suspend_member', 'remove_avatar', 'clear_profile'] as const

/**
 * The trust rules of ADR 0019 section 4.7: account age, nothing upheld or blocked
 * lately, and the live-video cap. The allow-list is the feature flag's. Checked when
 * an upload starts AND again when the video is attached to a post, because both can
 * change in between.
 */
export async function assertVideoEligible(q: Pick<Db, 'select'>, ownerId: string, cfg: VideoConfig): Promise<void> {
  const [member] = await q.select({ createdAt: members.createdAt }).from(members).where(eq(members.id, ownerId))
  if (!member) throw new VideoError('not_found', 'no such member')
  const oldEnough = Date.now() - member.createdAt.getTime() >= cfg.minAccountAgeDays * 86_400_000
  if (!oldEnough) {
    throw new VideoError('not_eligible', `videos can be posted once an account is ${cfg.minAccountAgeDays} days old`)
  }

  const since = new Date(Date.now() - cfg.upheldLookbackDays * 86_400_000)
  const [upheld] = await q
    .select({ n: count() })
    .from(moderationActions)
    .where(
      and(
        gt(moderationActions.createdAt, since),
        or(
          and(inArray(moderationActions.action, [...UPHELD_AGAINST_MEMBER]), eq(moderationActions.memberId, ownerId)),
          and(
            eq(moderationActions.action, 'remove_post'),
            sql`${moderationActions.postId} in (select id from posts where author_id = ${ownerId})`,
          ),
        ),
      ),
    )
  const [blocked] = await q
    .select({ n: count() })
    .from(media)
    .where(and(eq(media.ownerId, ownerId), eq(media.status, 'blocked'), gt(media.createdAt, since)))
  if ((upheld?.n ?? 0) + (blocked?.n ?? 0) > 0) {
    throw new VideoError('not_eligible', 'video is not available to this account right now')
  }

  const [live] = await q
    .select({ n: count() })
    .from(media)
    .where(and(eq(media.ownerId, ownerId), eq(media.kind, 'post_video'), eq(media.status, 'ready'), isNotNull(media.postId)))
  if ((live?.n ?? 0) >= cfg.maxLivePerMember) {
    throw new VideoError('too_many_videos', `you can have at most ${cfg.maxLivePerMember} videos; delete a post with one first`)
  }
}
