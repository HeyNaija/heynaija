import { type Db, kenoRounds, kenoTickets } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import type { Env } from '../../env.js'
import { FeatureFlags } from '../../flags/feature-flags.js'
import { DB, ENV } from '../../tokens.js'
import type { TokenBox } from '../core/token-box.js'
import { drawNumbers, hitsOf, KENO_MAX, newSeed, seedHash } from './draw.js'
import { recordEvents } from '../core/scoring.js'
import { type BoardRow as SharedRow, leaderboard } from '../core/leaderboards.js'
import { ensureSeason, lagosDayStart, lagosMonth } from '../core/seasons.js'
import { KENO_TOKEN_BOX } from './keno-tokens.js'
import { CURRENT_TABLE, PAYOUT_TABLES, type PayoutTable, pointsFor } from './payouts.js'

// Keno, free to play (docs/games/GAMES.md, docs/adr/0028 phase 4). No money
// anywhere: tokens are free each day and points can never be bought, sent or
// swapped for anything.

/** Tickets stop going into a round this long before it is drawn; later ones go into the next. */
export const KENO_CLOSE_MS = 15_000
/** A round drawn this long after its time was drawn late (the API was down), and says so. */
const LATE_MS = 60_000
const PAGE = 30
const BOARD_SIZE = 50

export type KenoErrorCode = 'invalid' | 'no_tokens' | 'not_found'

export class KenoError extends Error {
  constructor(
    readonly code: KenoErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type TicketView = { id: string; round: number; numbers: number[]; hits: number | null; points: number | null; createdAt: Date }

export type RoundView = {
  number: number
  drawsAt: Date
  seedHash: string
  /** Set once drawn: the seed, and the numbers in the order they came out. */
  seed: string | null
  numbers: number[] | null
  drawnAt: Date | null
  /** Drawn well after its time, because the API was down then. */
  late: boolean
}

export type PlayView = {
  /** The round a ticket bought now goes into, and when it stops taking them. */
  open: RoundView & { closesAt: Date }
  last: RoundView | null
  openTickets: TicketView[]
  lastTickets: TicketView[]
  tokens: { left: number; daily: number; resetsAt: Date }
  serverTime: Date
  drawEveryMs: number
  /** The points table new tickets are played under. */
  payouts: { version: string; table: PayoutTable }
}

export type BoardRow = { rank: number; handle: string; displayName: string | null; avatar: string | null; points: number; you: boolean }

const roundView = (r: typeof kenoRounds.$inferSelect): RoundView => ({
  number: r.number,
  drawsAt: r.drawsAt,
  seedHash: r.seedHash,
  seed: r.drawnAt ? r.seed : null,
  numbers: r.drawnAt ? (r.numbers ?? null) : null,
  drawnAt: r.drawnAt,
  late: Boolean(r.drawnAt && r.drawnAt.getTime() - r.drawsAt.getTime() > LATE_MS),
})

const ticketView = (t: typeof kenoTickets.$inferSelect): TicketView => ({
  id: t.id,
  round: t.roundNumber,
  numbers: t.numbers,
  hits: t.hits,
  points: t.points,
  createdAt: t.createdAt,
})

/** What a sealed seed is bound to: the round's time, which the row has from the start. */
const sealedFor = (drawsAt: Date) => `keno-round:${drawsAt.toISOString()}`

const list = (values: (string | number)[]) => sql.join(values.map((v) => sql`${v}`), sql`, `)

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * The shared draws, tickets and standings. Rounds are made ahead, each with its
 * commitment, so a round's hash is public before any ticket for it is bought;
 * `tick()` draws whatever is due and is safe to run any number of times, from any
 * number of processes.
 */
@Injectable()
export class KenoService {
  private readonly logger = new Logger('Keno')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'KENO_DRAW_EVERY_MS' | 'KENO_DAILY_TOKENS'>,
    @Inject(KENO_TOKEN_BOX) private readonly box: TokenBox | null,
    @Inject(FeatureFlags) private readonly flags: Pick<FeatureFlags, 'onForAnyone'>,
  ) {}

  // --- Draws ------------------------------------------------------------------

  /** The draw times after `now`: on the clock's multiples of the interval (:00, :05, … for five minutes). */
  private slotsAfter(now: Date, count: number): Date[] {
    const every = this.env.KENO_DRAW_EVERY_MS
    const first = Math.floor(now.getTime() / every) * every + every
    return Array.from({ length: count }, (_, i) => new Date(first + i * every))
  }

  /**
   * Makes the next two rounds if they are not there yet, each with a fresh seed
   * and its hash. Two, so that in the last seconds before a draw (when tickets go
   * into the round after) that round and its hash already exist.
   */
  async ensureRounds(now = new Date(), q: Db | Tx = this.db): Promise<void> {
    const slots = this.slotsAfter(now, 2)
    // Only the missing ones: an insert that meets an existing round still uses up a round number.
    const have = await q.select({ drawsAt: kenoRounds.drawsAt }).from(kenoRounds).where(inArray(kenoRounds.drawsAt, slots))
    const missing = slots.filter((slot) => !have.some((r) => r.drawsAt.getTime() === slot.getTime()))
    if (!missing.length) return
    const rows = missing.map((drawsAt) => {
      const seed = newSeed()
      return { drawsAt, seedHash: seedHash(seed), seedSealed: this.box ? this.box.seal(seed, sealedFor(drawsAt)) : seed }
    })
    await q.insert(kenoRounds).values(rows).onConflictDoNothing({ target: kenoRounds.drawsAt })
  }

  /**
   * Draws every round that is due, then makes sure the next ones exist. Each draw
   * is one transaction that takes its round with SKIP LOCKED, so two processes never
   * draw the same round, and a round drawn is never drawn again. Does nothing
   * while Games is off for everyone. Returns the rounds drawn.
   */
  async tick(now = new Date()): Promise<number[]> {
    if (!(await this.flags.onForAnyone('games'))) return []
    const drawn: number[] = []
    for (;;) {
      const number = await this.db.transaction(async (tx) => {
        const [round] = await tx
          .select()
          .from(kenoRounds)
          .where(and(isNull(kenoRounds.drawnAt), lte(kenoRounds.drawsAt, now)))
          .orderBy(asc(kenoRounds.drawsAt))
          .limit(1)
          .for('update', { skipLocked: true })
        if (!round) return null
        await this.draw(tx, round, now)
        return round.number
      })
      if (number === null) break
      drawn.push(number)
    }
    await this.ensureRounds(now)
    if (drawn.length) this.logger.log(`drew Keno round${drawn.length > 1 ? 's' : ''} ${drawn.join(', ')}`)
    return drawn
  }

  /** Reveals the round's seed, keeps its numbers and scores every ticket in it, with the members' stats. */
  private async draw(tx: Tx, round: typeof kenoRounds.$inferSelect, now: Date): Promise<void> {
    const seed = this.openSeed(round)
    if (seedHash(seed) !== round.seedHash) throw new Error(`Keno round ${round.number}: the seed does not match its hash`)
    const numbers = drawNumbers(seed, round.number)
    await tx.update(kenoRounds).set({ seed, numbers, drawnAt: now, seedSealed: '' }).where(eq(kenoRounds.number, round.number))

    const tickets = await tx.select().from(kenoTickets).where(eq(kenoTickets.roundNumber, round.number))
    if (!tickets.length) return
    const scored = tickets.map((t) => {
      const hits = hitsOf(t.numbers, numbers)
      return { ...t, hits, points: pointsFor(t.tableVersion, t.numbers.length, hits) }
    })
    await tx.execute(sql`
      update games.keno_tickets t set hits = s.hits, points = s.points
      from (select unnest(array[${list(scored.map((t) => t.id))}]::uuid[]) as id,
                   unnest(array[${list(scored.map((t) => t.hits))}]::int[]) as hits,
                   unnest(array[${list(scored.map((t) => t.points))}]::int[]) as points) s
      where t.id = s.id`)

    // Per member: all-time stats, this month's points, and one event for the round.
    const byMember = new Map<string, { tickets: number; points: number; bestHits: number }>()
    for (const t of scored) {
      const m = byMember.get(t.memberId) ?? { tickets: 0, points: 0, bestHits: 0 }
      m.tickets++
      m.points += t.points
      m.bestHits = Math.max(m.bestHits, t.hits)
      byMember.set(t.memberId, m)
    }
    const season = await ensureSeason(tx, now)
    for (const [memberId, m] of byMember) {
      await tx.execute(sql`
        insert into games.game_profiles (member_id, game, stats, created_at, updated_at)
        values (${memberId}, 'keno', jsonb_build_object('rounds', 1, 'tickets', ${m.tickets}::int, 'points', ${m.points}::int, 'bestHits', ${m.bestHits}::int), ${now}, ${now})
        on conflict (member_id, game) do update set
          stats = games.game_profiles.stats || jsonb_build_object(
            'rounds', coalesce((games.game_profiles.stats->>'rounds')::int, 0) + 1,
            'tickets', coalesce((games.game_profiles.stats->>'tickets')::int, 0) + ${m.tickets}::int,
            'points', coalesce((games.game_profiles.stats->>'points')::int, 0) + ${m.points}::int,
            'bestHits', greatest(coalesce((games.game_profiles.stats->>'bestHits')::int, 0), ${m.bestHits}::int)),
          updated_at = ${now}`)
      await tx.execute(sql`
        insert into games.season_scores (season_id, member_id, game, points, updated_at)
        values (${season.id}, ${memberId}, 'keno', ${m.points}::int, ${now})
        on conflict (season_id, member_id, game) do update set
          points = games.season_scores.points + excluded.points,
          updated_at = case when excluded.points > 0 then excluded.updated_at else games.season_scores.updated_at end`)
    }
    // One event per member for the round, with its Game Score XP (docs/adr/0028, phase 5).
    await recordEvents(
      tx,
      [...byMember].map(([memberId, m]) => ({
        game: 'keno',
        kind: 'keno_round_played',
        memberId,
        data: { round: round.number, tickets: m.tickets, points: m.points, bestHits: m.bestHits },
        createdAt: now,
      })),
    )
    // Keno competitions whose play window this round falls in: their entrants' points go on (phase 5).
    await tx.execute(sql`
      update games.competition_entries e set score = coalesce(e.score, 0) + s.points
      from (select member_id, sum(points)::int as points from games.keno_tickets where round_number = ${round.number} group by member_id) s,
           games.competitions c
      where e.competition_id = c.id and e.member_id = s.member_id
        and c.game = 'keno' and c.format = 'keno_points' and c.status in ('open', 'live')
        and c.starts_at <= ${round.drawsAt} and c.ends_at > ${round.drawsAt}`)
  }

  /** The round's seed: opened from its box, or as it is if it was made without GAMES_TOKEN_KEY. */
  private openSeed(round: typeof kenoRounds.$inferSelect): string {
    if (!round.seedSealed.startsWith('v1.')) return round.seedSealed
    if (!this.box) throw new Error(`Keno round ${round.number} was sealed, and GAMES_TOKEN_KEY is not set`)
    return this.box.open(round.seedSealed, sealedFor(round.drawsAt))
  }

  // --- Playing ----------------------------------------------------------------

  /**
   * Buys a ticket with one of today's tokens for the next round still taking them.
   * The member's lock keeps two tickets bought at once from both taking the last token.
   */
  async play(memberId: string, picks: number[], now = new Date()): Promise<TicketView> {
    const numbers = [...new Set(picks)].sort((a, b) => a - b)
    if (numbers.length !== picks.length || numbers.length < 1 || numbers.length > 10 || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > KENO_MAX)) {
      throw new KenoError('invalid', 'Pick 1 to 10 different numbers from 1 to 80.')
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`keno/${memberId}`}, 0))`)
      if ((await this.usedToday(tx, memberId, now)) >= this.env.KENO_DAILY_TOKENS) {
        throw new KenoError('no_tokens', `You've used today's ${this.env.KENO_DAILY_TOKENS} tokens. More at midnight.`)
      }
      const round = await this.openRound(tx, now)
      const [ticket] = await tx.insert(kenoTickets).values({ memberId, roundNumber: round.number, numbers, tableVersion: CURRENT_TABLE, createdAt: now }).returning()
      return ticketView(ticket!)
    })
  }

  private async usedToday(q: Db | Tx, memberId: string, now: Date): Promise<number> {
    const [row] = await q
      .select({ n: sql<number>`count(*)::int` })
      .from(kenoTickets)
      .where(and(eq(kenoTickets.memberId, memberId), sql`${kenoTickets.createdAt} >= ${lagosDayStart(now)}`))
    return row?.n ?? 0
  }

  /** The first undrawn round more than KENO_CLOSE_MS away, made first if need be. */
  private async openRound(q: Db | Tx, now: Date): Promise<typeof kenoRounds.$inferSelect> {
    const find = () =>
      q
        .select()
        .from(kenoRounds)
        .where(and(isNull(kenoRounds.drawnAt), gt(kenoRounds.drawsAt, new Date(now.getTime() + KENO_CLOSE_MS))))
        .orderBy(asc(kenoRounds.drawsAt))
        .limit(1)
    let [round] = await find()
    if (!round) {
      await this.ensureRounds(now, q)
      ;[round] = await find()
    }
    return round!
  }

  /** The play page: the open round, the last one drawn, the member's tickets in each, and tokens left. */
  async playView(memberId: string, now = new Date()): Promise<PlayView> {
    const open = await this.openRound(this.db, now)
    const [last] = await this.db.select().from(kenoRounds).where(sql`${kenoRounds.drawnAt} is not null`).orderBy(desc(kenoRounds.drawsAt)).limit(1)
    const mine = (round: number) =>
      this.db
        .select()
        .from(kenoTickets)
        .where(and(eq(kenoTickets.memberId, memberId), eq(kenoTickets.roundNumber, round)))
        .orderBy(asc(kenoTickets.createdAt))
    const used = await this.usedToday(this.db, memberId, now)
    return {
      open: { ...roundView(open), closesAt: new Date(open.drawsAt.getTime() - KENO_CLOSE_MS) },
      last: last ? roundView(last) : null,
      openTickets: (await mine(open.number)).map(ticketView),
      lastTickets: last ? (await mine(last.number)).map(ticketView) : [],
      tokens: { left: Math.max(0, this.env.KENO_DAILY_TOKENS - used), daily: this.env.KENO_DAILY_TOKENS, resetsAt: new Date(lagosDayStart(now).getTime() + 86_400_000) },
      serverTime: now,
      drawEveryMs: this.env.KENO_DRAW_EVERY_MS,
      payouts: { version: CURRENT_TABLE, table: PAYOUT_TABLES[CURRENT_TABLE]! },
    }
  }

  /** The member's tickets, newest first, a page at a time. */
  async tickets(memberId: string, before?: Date): Promise<{ tickets: TicketView[]; next: string | null }> {
    const rows = await this.db
      .select()
      .from(kenoTickets)
      .where(and(eq(kenoTickets.memberId, memberId), before ? lt(kenoTickets.createdAt, before) : undefined))
      .orderBy(desc(kenoTickets.createdAt))
      .limit(PAGE + 1)
    const page = rows.slice(0, PAGE)
    return { tickets: page.map(ticketView), next: rows.length > PAGE ? page.at(-1)!.createdAt.toISOString() : null }
  }

  // --- Checking rounds ----------------------------------------------------------

  async round(number: number): Promise<RoundView> {
    const [r] = await this.db.select().from(kenoRounds).where(eq(kenoRounds.number, number))
    if (!r) throw new KenoError('not_found', 'There is no round with that number.')
    return roundView(r)
  }

  /** Rounds drawn, newest first. */
  async rounds(before?: number): Promise<{ rounds: RoundView[]; next: number | null }> {
    const rows = await this.db
      .select()
      .from(kenoRounds)
      .where(and(sql`${kenoRounds.drawnAt} is not null`, before ? lt(kenoRounds.number, before) : undefined))
      .orderBy(desc(kenoRounds.number))
      .limit(PAGE + 1)
    const page = rows.slice(0, PAGE)
    return { rounds: page.map(roundView), next: rows.length > PAGE ? page.at(-1)!.number : null }
  }

  // --- Standings ----------------------------------------------------------------

  /**
   * The Keno board by points, this Lagos month or of all time: the shared
   * leaderboards (games/core/leaderboards.ts), which leave out blocks, mutes and
   * inactive members and always give the viewer's own row.
   */
  async leaderboard(viewerId: string, period: 'month' | 'all', now = new Date(), limit = BOARD_SIZE): Promise<{ period: 'month' | 'all'; season: string | null; rows: BoardRow[]; you: BoardRow | null }> {
    const view = await leaderboard(this.db, viewerId, { board: 'keno', period: period === 'all' ? 'all' : lagosMonth(now).slug, limit, now })
    const row = (r: SharedRow): BoardRow => ({ rank: r.rank, handle: r.handle, displayName: r.displayName, avatar: r.avatar, points: r.value, you: r.you })
    return { period, season: period === 'month' ? view.period : null, rows: view.rows.map(row), you: view.you ? row(view.you) : null }
  }
}
