import { type Db, gameEvents } from '@heynaija/db'
import { sql } from 'drizzle-orm'
import { ensureSeason } from './seasons.js'

// The HeyNaija Game Score (docs/games/GAMES.md, docs/adr/0018 phase 5): XP from
// playing, winning and placing in competitions, added up per season (a Lagos month)
// and for all time. Every rule is here, and the "How games scoring works" page reads
// these same numbers from the API, so the page and the scoring cannot disagree.

export const XP_RULES = {
  chess: {
    /** A game that was played to an end (not aborted). */
    finished: 10,
    win: 10,
    draw: 5,
  },
  keno: {
    /** Each round you had at least one ticket in. */
    round: 2,
    /** Plus 1 XP for every this many points scored in the round … */
    pointsPerXp: 10,
    /** … up to this much a round. */
    pointsXpMax: 20,
  },
  competition: {
    /** Everyone who took part, whatever their place. */
    entered: 5,
    /** And for a place: 1st, 2nd, 3rd. */
    places: [100, 60, 40],
    /** 4th to 10th. */
    topTen: 20,
  },
} as const

export type ScoredEvent = { game: string; kind: string; data: Record<string, unknown> }

/** The XP an event gives under the rules above; 0 for anything they do not cover. */
export function xpFor(e: ScoredEvent): number {
  switch (e.kind) {
    case 'chess_game_finished': {
      const outcome = e.data.outcome
      if (outcome === 'aborted') return 0
      const r = XP_RULES.chess
      return r.finished + (outcome === 'won' ? r.win : outcome === 'drawn' ? r.draw : 0)
    }
    case 'keno_round_played': {
      const r = XP_RULES.keno
      const points = Number(e.data.points ?? 0)
      return r.round + Math.min(r.pointsXpMax, Math.floor(Math.max(0, points) / r.pointsPerXp))
    }
    case 'competition_placed': {
      const r = XP_RULES.competition
      const place = Number(e.data.placement ?? 0)
      return r.entered + (place >= 1 && place <= 3 ? r.places[place - 1]! : place >= 4 && place <= 10 ? r.topTen : 0)
    }
    default:
      return 0
  }
}

export type NewEvent = ScoredEvent & { memberId: string | null; competitionId?: string | null; createdAt: Date }

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Queries = Pick<Db, 'execute' | 'select' | 'insert'>

/**
 * Adds an event's XP to the member's totals: their score in that game this season
 * (`season_scores.xp`) and of all time (`game_profiles.stats.xp`), and their Game
 * Score this season and of all time (`xp_totals`). Call it only in the transaction that sets the event's `xp`, so
 * an event is counted exactly once.
 */
async function addToTotals(q: Queries, memberId: string, game: string, xp: number, at: Date): Promise<void> {
  if (xp <= 0) return
  const season = await ensureSeason(q, at)
  await q.execute(sql`
    insert into games.season_scores (season_id, member_id, game, xp, updated_at)
    values (${season.id}, ${memberId}, ${game}, ${xp}::int, ${at})
    on conflict (season_id, member_id, game) do update set xp = games.season_scores.xp + excluded.xp, updated_at = excluded.updated_at`)
  await q.execute(sql`
    insert into games.xp_totals (member_id, period, xp, updated_at)
    values (${memberId}, ${season.slug}, ${xp}::int, ${at}), (${memberId}, 'all', ${xp}::int, ${at})
    on conflict (member_id, period) do update set xp = games.xp_totals.xp + excluded.xp, updated_at = excluded.updated_at`)
  // And their all-time XP in this game, beside the game's own stats.
  await q.execute(sql`
    insert into games.game_profiles (member_id, game, stats, created_at, updated_at)
    values (${memberId}, ${game}, jsonb_build_object('xp', ${xp}::int), ${at}, ${at})
    on conflict (member_id, game) do update set
      stats = games.game_profiles.stats || jsonb_build_object('xp', coalesce((games.game_profiles.stats->>'xp')::int, 0) + ${xp}::int),
      updated_at = excluded.updated_at`)
}

/** Writes game events with their XP, and adds it to the totals, all in `tx`. */
export async function recordEvents(tx: Tx | Queries, events: NewEvent[]): Promise<void> {
  for (const e of events) {
    const xp = e.memberId ? xpFor(e) : 0
    await tx.insert(gameEvents).values({ game: e.game, kind: e.kind, memberId: e.memberId, competitionId: e.competitionId ?? null, data: e.data, xp, createdAt: e.createdAt })
    if (e.memberId) await addToTotals(tx, e.memberId, e.game, xp, e.createdAt)
  }
}

/**
 * Scores events written before XP existed: a batch at a time, each event taken
 * with SKIP LOCKED and given its XP in the same transaction that adds it to the
 * totals, so running this again, or in two processes at once, counts nothing
 * twice. Returns how many events it scored.
 */
export async function scoreUnscored(db: Db, batch = 200): Promise<number> {
  let scored = 0
  for (;;) {
    const n = await db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ id: string; game: string; kind: string; member_id: string | null; data: Record<string, unknown>; created_at: Date | string }>(sql`
        select id, game, kind, member_id, data, created_at from games.game_events
        where xp is null order by created_at limit ${batch} for update skip locked`)
      for (const r of rows) {
        const xp = r.member_id ? xpFor({ game: r.game, kind: r.kind, data: r.data }) : 0
        await tx.execute(sql`update games.game_events set xp = ${xp}::int where id = ${r.id}`)
        if (r.member_id) await addToTotals(tx, r.member_id, r.game, xp, new Date(r.created_at))
      }
      return rows.length
    })
    scored += n
    if (n < batch) return scored
  }
}
