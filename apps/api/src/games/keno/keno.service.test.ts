import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, gameEvents, gameProfiles, kenoRounds, kenoTickets, members, seasonScores } from '@heynaija/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../../test-db.js'
import { TokenBox } from '../core/token-box.js'
import { drawNumbers, hitsOf, seedHash } from './draw.js'
import { lagosDayStart, lagosMonth } from '../core/seasons.js'
import { KENO_CLOSE_MS, KenoError, KenoService } from './keno.service.js'
import { PAYOUT_TABLES, pointsFor } from './payouts.js'

const EVERY = 300_000
const env = { KENO_DRAW_EVERY_MS: EVERY, KENO_DAILY_TOKENS: 20 }
const box = new TokenBox('e'.repeat(64))
let gamesOn = true
const flags = { onForAnyone: async () => gamesOn }

let keno: KenoService
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()

// 3 November 2026, 10:02 in Lagos (09:02 UTC): the next draw is at 09:05 UTC.
const t0 = new Date('2026-11-03T09:02:00Z')
const at = (ms: number) => new Date(t0.getTime() + ms)

before(migrate)
beforeEach(async () => {
  await reset()
  gamesOn = true
  await db.insert(members).values([
    { id: ada, handle: 'ada', displayName: 'Ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
  keno = new KenoService(db, env, box, flags)
})
after(() => pool.end())

const refusal = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (err) {
    if (err instanceof KenoError) return err.code
    throw err
  }
  assert.fail('expected a KenoError')
}

test('the numbers come from the seed and the round, the same every time: 20 different numbers from 1 to 80', () => {
  // The web app's checker is tested against these same examples (keno/_components/fair.test.ts).
  const zeros = '0'.repeat(64)
  assert.equal(seedHash(zeros), '60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55')
  assert.deepEqual(drawNumbers(zeros, 1), [78, 68, 76, 35, 65, 69, 73, 61, 53, 44, 24, 6, 41, 55, 23, 67, 57, 66, 46, 29])
  assert.deepEqual(drawNumbers('heynaija', 1234), [37, 36, 25, 46, 45, 35, 7, 2, 34, 61, 78, 15, 54, 12, 76, 70, 77, 20, 53, 42])
  assert.notDeepEqual(drawNumbers(zeros, 2), drawNumbers(zeros, 1), 'another round, other numbers')
  for (let round = 1; round <= 200; round++) {
    const drawn = drawNumbers(`seed-${round}`, round)
    assert.equal(drawn.length, 20)
    assert.equal(new Set(drawn).size, 20)
    assert.ok(drawn.every((n) => Number.isInteger(n) && n >= 1 && n <= 80))
  }
  assert.equal(hitsOf([1, 2, 3], [3, 2, 9]), 2)
})

test('points come from the ticket’s table; a table that does not exist is an error, not zero', () => {
  assert.equal(pointsFor('v1', 1, 1), 3)
  assert.equal(pointsFor('v1', 6, 4), 5)
  assert.equal(pointsFor('v1', 10, 0), 5)
  assert.equal(pointsFor('v1', 10, 4), 0)
  assert.equal(pointsFor('v1', 4, 1), 0)
  assert.throws(() => pointsFor('v0', 1, 1))
  for (const table of Object.values(PAYOUT_TABLES)) assert.deepEqual(Object.keys(table).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('Lagos days and months: midnight in Lagos is 23:00 UTC the day before', () => {
  assert.equal(lagosDayStart(new Date('2026-11-03T22:59:00Z')).toISOString(), '2026-11-02T23:00:00.000Z')
  assert.equal(lagosDayStart(new Date('2026-11-03T23:00:00Z')).toISOString(), '2026-11-03T23:00:00.000Z')
  assert.deepEqual(lagosMonth(new Date('2026-11-30T23:30:00Z')).slug, '2026-12')
  assert.equal(lagosMonth(t0).startsAt.toISOString(), '2026-10-31T23:00:00.000Z')
})

test('rounds are made ahead with only their hash showing; the seed is sealed until the draw', async () => {
  await keno.ensureRounds(t0)
  await keno.ensureRounds(t0)
  const rounds = await db.select().from(kenoRounds).orderBy(kenoRounds.drawsAt)
  assert.deepEqual(
    rounds.map((r) => r.drawsAt.toISOString()),
    ['2026-11-03T09:05:00.000Z', '2026-11-03T09:10:00.000Z'],
    'the next two draw times on the five-minute clock, made once',
  )
  assert.match(rounds[0]!.seedSealed, /^v1\./)
  const view = await keno.round(rounds[0]!.number)
  assert.deepEqual([view.seed, view.numbers, view.drawnAt], [null, null, null])
  assert.equal(view.seedHash, rounds[0]!.seedHash)
})

test('a draw reveals the seed, and its numbers are the ones the seed gives; it is drawn once however often tick runs', async () => {
  await keno.ensureRounds(t0)
  const [first] = await keno.tick(at(3 * 60_000))
  assert.equal(first, 1)
  const [again] = await Promise.all([keno.tick(at(3 * 60_000)), keno.tick(at(3 * 60_000))])
  assert.deepEqual(again, [])
  const round = await keno.round(1)
  assert.ok(round.seed && round.numbers)
  assert.equal(seedHash(round.seed), round.seedHash)
  assert.deepEqual(round.numbers, drawNumbers(round.seed, 1))
  assert.equal(round.late, false)
  // The rounds after it exist, ready for tickets, numbered on with no gaps.
  assert.equal((await db.select().from(kenoRounds).where(isNull(kenoRounds.drawnAt))).length, 2)
  await keno.tick(at(4 * 60_000))
  assert.deepEqual((await db.select({ n: kenoRounds.number }).from(kenoRounds).orderBy(kenoRounds.number)).map((r) => r.n), [1, 2, 3])
})

test('a round missed while the API was down is drawn when it comes back, with its tickets, and says it was late', async () => {
  await keno.play(ada, [5], t0)
  const drawn = await keno.tick(at(60 * 60_000))
  assert.deepEqual(drawn, [1, 2], 'both rounds made ahead were due')
  assert.equal((await keno.round(1)).late, true)
  const [ticket] = await db.select().from(kenoTickets)
  assert.notEqual(ticket!.hits, null)
})

test('nothing is drawn, and no rounds pile up, while Games is off for everyone', async () => {
  gamesOn = false
  assert.deepEqual(await keno.tick(t0), [])
  assert.equal((await db.select().from(kenoRounds)).length, 0)
})

test('tickets are scored from the table they were played under, and the stats, month and events follow', async () => {
  await keno.ensureRounds(t0)
  const [r1] = await db.select().from(kenoRounds).orderBy(kenoRounds.drawsAt).limit(1)
  // Knowing the seed (tests only), pick numbers that will be drawn.
  const seed = box.open(r1!.seedSealed, `keno-round:${r1!.drawsAt.toISOString()}`)
  const drawn = drawNumbers(seed, r1!.number)
  const missed = Array.from({ length: 80 }, (_, i) => i + 1).filter((n) => !drawn.includes(n))
  await keno.play(ada, drawn.slice(0, 4), t0) // 4 of 4: 100
  await keno.play(ada, [drawn[0]!, missed[0]!], t0) // 1 of 2: 0
  await keno.play(bayo, [...drawn.slice(0, 3), ...missed.slice(0, 3)], t0) // 3 of 6: 1
  await keno.tick(at(3 * 60_000))

  const tickets = await db.select().from(kenoTickets).orderBy(kenoTickets.createdAt)
  assert.deepEqual(
    tickets.map((t) => [t.memberId, t.hits, t.points]).sort(),
    [
      [ada, 4, 100],
      [ada, 1, 0],
      [bayo, 3, 1],
    ].sort(),
  )
  const [profile] = await db.select().from(gameProfiles).where(and(eq(gameProfiles.memberId, ada), eq(gameProfiles.game, 'keno')))
  assert.deepEqual(profile!.stats, { rounds: 1, tickets: 2, points: 100, bestHits: 4, xp: 12 })
  const [score] = await db.select().from(seasonScores).where(eq(seasonScores.memberId, ada))
  assert.deepEqual([score!.game, score!.points, score!.xp], ['keno', 100, 12], 'XP: 2 for the round, 10 for 100 points')
  const events = await db.select().from(gameEvents).where(eq(gameEvents.kind, 'keno_round_played'))
  assert.equal(events.length, 2, 'one event per member per round')
  assert.deepEqual(events.find((e) => e.memberId === ada)!.data, { round: 1, tickets: 2, points: 100, bestHits: 4 })

  // A second round adds to the same rows.
  await keno.play(ada, [missed[0]!], at(4 * 60_000))
  await keno.tick(at(9 * 60_000))
  const [later] = await db.select().from(gameProfiles).where(and(eq(gameProfiles.memberId, ada), eq(gameProfiles.game, 'keno')))
  assert.equal((later!.stats as { rounds: number }).rounds, 2)
  assert.equal((later!.stats as { tickets: number }).tickets, 3)
})

test('20 tokens a Lagos day: the 21st ticket is refused, and they are back after midnight in Lagos', async () => {
  for (let i = 0; i < 20; i++) await keno.play(ada, [i + 1], t0)
  assert.equal(await refusal(() => keno.play(ada, [1], t0)), 'no_tokens')
  assert.equal((await keno.playView(ada, t0)).tokens.left, 0)
  assert.equal((await keno.playView(bayo, t0)).tokens.left, 20, 'tokens are each member’s own')
  // 22:59 UTC is still the same Lagos day; 23:00 UTC is the next one.
  assert.equal(await refusal(() => keno.play(ada, [1], new Date('2026-11-03T22:59:00Z'))), 'no_tokens')
  await keno.play(ada, [1], new Date('2026-11-03T23:00:00Z'))
  const view = await keno.playView(ada, new Date('2026-11-03T23:00:00Z'))
  assert.equal(view.tokens.left, 19)
  assert.equal(view.tokens.resetsAt.toISOString(), '2026-11-04T23:00:00.000Z')
})

test('two tickets bought at once cannot both take the last token', async () => {
  for (let i = 0; i < 19; i++) await keno.play(ada, [i + 1], t0)
  const results = await Promise.allSettled([keno.play(ada, [40], t0), keno.play(ada, [41], t0)])
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
  assert.equal((await db.select().from(kenoTickets).where(eq(kenoTickets.memberId, ada))).length, 20)
})

test('in the last 15 seconds before a draw a ticket goes into the round after', async () => {
  const early = await keno.play(ada, [1], t0)
  const late = await keno.play(ada, [2], new Date(Date.parse('2026-11-03T09:05:00Z') - KENO_CLOSE_MS + 1))
  assert.equal(early.round, 1)
  assert.equal(late.round, 2)
  const view = await keno.playView(ada, new Date(Date.parse('2026-11-03T09:05:00Z') - 5_000))
  assert.equal(view.open.number, 2)
  assert.equal(view.open.closesAt.toISOString(), '2026-11-03T09:09:45.000Z')
})

test('a ticket is 1 to 10 different numbers from 1 to 80', async () => {
  for (const picks of [[], [0], [81], [1, 1], [1.5], Array.from({ length: 11 }, (_, i) => i + 1)]) {
    assert.equal(await refusal(() => keno.play(ada, picks, t0)), 'invalid', JSON.stringify(picks))
  }
  const ticket = await keno.play(ada, [80, 3, 41], t0)
  assert.deepEqual(ticket.numbers, [3, 41, 80], 'kept in order')
})

test('the play page shows the last draw with the member’s tickets in it', async () => {
  await keno.play(ada, [1, 2, 3], t0)
  await keno.tick(at(3 * 60_000))
  const view = await keno.playView(ada, at(3 * 60_000))
  assert.equal(view.last!.number, 1)
  assert.equal(view.last!.numbers!.length, 20)
  assert.equal(view.lastTickets.length, 1)
  assert.notEqual(view.lastTickets[0]!.hits, null)
  assert.equal(view.open.number, 2)
  assert.deepEqual(view.openTickets, [])
  assert.equal((await keno.playView(bayo, at(3 * 60_000))).lastTickets.length, 0, 'only their own tickets')
  const history = await keno.tickets(ada)
  assert.equal(history.tickets.length, 1)
  assert.deepEqual((await keno.rounds()).rounds.map((r) => r.number), [1])
})

/** Points for a member this month and all time, as the draws would leave them. */
async function scored(memberId: string, points: number) {
  const month = lagosMonth(t0)
  // The same rows tick() writes.
  await db.execute(
    sql`insert into games.seasons (slug, starts_at, ends_at) values (${month.slug}, ${month.startsAt}, ${month.endsAt}) on conflict (slug) do nothing`,
  )
  const [season] = await db.execute<{ id: string }>(sql`select id from games.seasons where slug = ${month.slug}`).then((r) => r.rows)
  await db.insert(seasonScores).values({ seasonId: season!.id, memberId, game: 'keno', points })
  await db.insert(gameProfiles).values({ memberId, game: 'keno', stats: { points } })
}

test('the leaderboard ranks by points, leaves out blocks either way and inactive members, and always shows your row', async () => {
  const dayo = randomUUID()
  const eze = randomUUID()
  await db.insert(members).values([
    { id: dayo, handle: 'dayo' },
    { id: eze, handle: 'eze', active: false },
  ])
  await scored(ada, 50)
  await scored(bayo, 400)
  await scored(chi, 400)
  await scored(dayo, 900)
  await scored(eze, 5000)
  await db.insert(blocks).values({ blockerId: dayo, blockedId: ada })

  const month = await keno.leaderboard(ada, 'month', t0, 2)
  assert.equal(month.season, '2026-11')
  assert.deepEqual(
    month.rows.map((r) => [r.handle, r.rank, r.points]),
    [
      ['bayo', 1, 400],
      ['chi', 1, 400],
    ],
    'ties share a rank; dayo (blocked) and eze (suspended) are not there',
  )
  assert.deepEqual([month.you!.handle, month.you!.rank, month.you!.you], ['ada', 3, true], 'below the top, still shown')
  const forChi = await keno.leaderboard(chi, 'all', t0)
  assert.deepEqual(forChi.rows.map((r) => r.handle), ['dayo', 'bayo', 'chi', 'ada'])
  assert.equal((await keno.leaderboard(randomUUID(), 'month', t0)).you, null)
  // Next month starts empty.
  assert.deepEqual((await keno.leaderboard(ada, 'month', new Date('2026-12-01T00:00:00Z'))).rows, [])
})
