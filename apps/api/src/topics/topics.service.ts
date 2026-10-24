import type { Db } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Refreshing } from '../refreshing.js'
import { DB } from '../tokens.js'

// The rules a topic trends by. They are sent with the topics, so the page that
// explains them to members always says what this code does.

/** Only uses from the last week count. */
export const TOPIC_WINDOW_DAYS = 7
/** Different members who must use a hashtag before it can trend: one person, or two, cannot make a topic. */
export const TOPIC_MIN_MEMBERS = 3
/** The most topics listed. */
export const TOPICS_MAX = 20
/** The ranking is the same for everyone, so it is worked out at most once a minute. */
export const TOPICS_TTL_MS = 60_000
// The recent uses read to choose how a topic is shown (see `label`).
const SPELLINGS_READ = 50

export type TopicRules = { windowDays: number; minMembers: number; refreshSeconds: number }

export type TrendingTopic = {
  /** The key every spelling of the hashtag shares (lower case). */
  tag: string
  /** How it is written in most of its recent uses, without the #: "EndSARS" rather than "endsars". */
  label: string
  /** Different members who used it in the window. */
  members: number
  /** Posts and replies it was used in, in the window. */
  posts: number
}

export type TrendingTopics = { topics: TrendingTopic[]; rules: TopicRules }

type Use = { text: string; start: number; length: number }

/** The spelling most `uses` have, the most recent of them on a tie (uses come newest first). */
export function label(tag: string, uses: Use[]): string {
  const counts = new Map<string, number>()
  for (const { text, start, length } of uses) {
    const written = text.slice(start + 1, start + length)
    counts.set(written, (counts.get(written) ?? 0) + 1)
  }
  let best = tag
  let most = 0
  for (const [written, count] of counts) {
    if (count > most) [best, most] = [written, count]
  }
  return best
}

@Injectable()
export class TopicsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private readonly ranking = new Refreshing(TOPICS_TTL_MS, () => this.rank())

  /**
   * The hashtags most members are using this week. A topic counts once per
   * member however often they use it, so many posts by a few people do not
   * outrank a few posts by many. The same for every reader: no one's blocks,
   * mutes or follows change it, and nothing about the reader is used.
   */
  async trending(): Promise<TrendingTopics> {
    return {
      topics: await this.ranking.get(),
      rules: { windowDays: TOPIC_WINDOW_DAYS, minMembers: TOPIC_MIN_MEMBERS, refreshSeconds: TOPICS_TTL_MS / 1000 },
    }
  }

  /**
   * Counts this week's uses of each hashtag in live posts and replies by active
   * members, keeps those used by at least `TOPIC_MIN_MEMBERS` people, and ranks
   * them by members, then posts, then the latest use.
   */
  private async rank(): Promise<TrendingTopic[]> {
    const since = new Date(Date.now() - TOPIC_WINDOW_DAYS * 86_400_000).toISOString()
    const counted = sql`post_hashtags ph join posts p on p.id = ph.post_id join members m on m.id = p.author_id and m.active
      where p.created_at > ${since} and p.deleted_at is null and p.removed_at is null`
    const { rows } = await this.db.execute<{ tag: string; members: number; posts: number; uses: Use[] | null }>(sql`
      with ranked as (
        select ph.tag, count(distinct p.author_id)::int as members, count(distinct p.id)::int as posts, max(p.created_at) as last_used
        from ${counted}
        group by ph.tag
        having count(distinct p.author_id) >= ${TOPIC_MIN_MEMBERS}
        order by members desc, posts desc, last_used desc, ph.tag
        limit ${TOPICS_MAX}
      )
      select r.tag, r.members, r.posts, (
        select json_agg(json_build_object('text', u.text, 'start', u.start, 'length', u.length))
        from (select p.text, ph.start, ph.length from ${counted} and ph.tag = r.tag
          order by p.created_at desc, ph.start limit ${SPELLINGS_READ}) u
      ) as uses
      from ranked r
      order by r.members desc, r.posts desc, r.last_used desc, r.tag`)
    return rows.map(({ tag, members, posts, uses }) => ({ tag, label: label(tag, uses ?? []), members, posts }))
  }
}
