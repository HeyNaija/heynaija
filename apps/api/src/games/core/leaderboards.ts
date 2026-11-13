import type { Db } from '@heynaija/db'
import { type SQL, sql } from 'drizzle-orm'
import { avatarPath } from '../../media/media.service.js'
import { blockedEitherWay } from '../../posts/posts.service.js'
import { lagosMonth } from './seasons.js'

// The Games leaderboards (docs/games/GAMES.md, docs/adr/0028 phase 5). Every board
// reads rows the scoring keeps up to date as games are played; nothing is added
// up here. Blocks either way, mutes and inactive members (suspended, deactivated,
// erased) are left out, as from feeds; members with nothing yet are not ranked;
// ties share a rank; and the viewer's own row is always given.

export const BOARDS = ['score', 'chess', 'keno'] as const
export type Board = (typeof BOARDS)[number]
export const FILTERS = ['everyone', 'following', 'community'] as const
export type Filter = (typeof FILTERS)[number]

/** "2026-11" for a season, or "all" for all time. */
export type Period = string

export type BoardRow = { rank: number; handle: string; displayName: string | null; avatar: string | null; value: number; you: boolean }
export type BoardView = {
  board: Board
  /** What the numbers are: XP, or Keno points. */
  unit: 'xp' | 'points'
  period: Period
  filter: Filter
  community: string | null
  rows: BoardRow[]
  you: BoardRow | null
}

export type BoardQuery = { board: Board; period?: Period; filter?: Filter; community?: string | null; limit?: number; now?: Date }

const isPeriod = (p: string) => p === 'all' || /^\d{4}-(0[1-9]|1[0-2])$/.test(p)

/** The rows a board ranks: member, value and when it last changed (earlier first among ties). */
function source(board: Board, period: Period): SQL {
  if (board === 'score') return sql`select member_id, xp as value, updated_at from games.xp_totals where period = ${period}`
  const column = board === 'keno' ? 'points' : 'xp'
  if (period === 'all') {
    return sql`select member_id, coalesce((stats->>${column})::int, 0) as value, updated_at from games.game_profiles where game = ${board}`
  }
  return sql`
    select ss.member_id, ss.${sql.raw(column)} as value, ss.updated_at
    from games.season_scores ss join games.seasons s on s.id = ss.season_id
    where s.slug = ${period} and ss.game = ${board}`
}

type Row = { member_id: string; value: number; handle: string; display_name: string | null; avatar_media_id: string | null; rank: string | number }

export async function leaderboard(db: Db, viewerId: string, q: BoardQuery): Promise<BoardView> {
  const now = q.now ?? new Date()
  const period = q.period && isPeriod(q.period) ? q.period : lagosMonth(now).slug
  const filter = q.filter ?? 'everyone'
  const community = filter === 'community' ? (q.community ?? null) : null
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 100)
  const narrowed =
    filter === 'following'
      ? sql`and (m.id = ${viewerId} or exists(select 1 from follows f where f.follower_id = ${viewerId} and f.followee_id = m.id))`
      : filter === 'community'
        ? sql`and exists(select 1 from community_memberships cm join communities c on c.id = cm.community_id where c.slug = ${community ?? ''} and cm.member_id = m.id)`
        : sql``
  const ranked = sql`
    with sc as (${source(q.board, period)}),
    eligible as (
      select sc.member_id, sc.value, sc.updated_at, m.handle, m.display_name, m.avatar_media_id
      from sc join members m on m.id = sc.member_id
      where sc.value > 0 and m.active and m.deleted_at is null
        and (m.id = ${viewerId} or (
          not ${blockedEitherWay(viewerId, sql`m.id`)}
          and not exists(select 1 from mutes mu where mu.muter_id = ${viewerId} and mu.muted_id = m.id)))
        ${narrowed}
    )
    select *, rank() over (order by value desc) as rank from eligible`
  const top = await db.execute<Row>(sql`select * from (${ranked}) r order by rank, updated_at, handle limit ${limit}`)
  const [me] = (await db.execute<Row>(sql`select * from (${ranked}) r where member_id = ${viewerId}`)).rows
  const row = (r: Row): BoardRow => ({
    rank: Number(r.rank),
    handle: r.handle,
    displayName: r.display_name,
    avatar: avatarPath(r.avatar_media_id),
    value: Number(r.value),
    you: r.member_id === viewerId,
  })
  return { board: q.board, unit: q.board === 'keno' ? 'points' : 'xp', period, filter, community, rows: top.rows.map(row), you: me ? row(me) : null }
}

/** Seasons that have any scores, newest first, for the season picker. */
export async function seasonsWithScores(db: Db): Promise<string[]> {
  const { rows } = await db.execute<{ slug: string }>(sql`
    select s.slug from games.seasons s where exists(select 1 from games.season_scores ss where ss.season_id = s.id) order by s.slug desc`)
  return rows.map((r) => r.slug)
}
