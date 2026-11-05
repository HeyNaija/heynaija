import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, follows, gameEvents, gameProfiles, gameSeasons, members, mutes, seasonScores, xpTotals } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../../test-db.js'
import { leaderboard, seasonsWithScores } from './leaderboards.js'
import { recordEvents, scoreUnscored, XP_RULES, xpFor } from './scoring.js'

const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const dayo = randomUUID()

// 3 November 2026, 10:00 in Lagos.
const nov = new Date('2026-11-03T09:00:00Z')

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada', displayName: 'Ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
    { id: dayo, handle: 'dayo' },
  ])
})
after(() => pool.end())

const chess = (memberId: string, outcome: string, at = nov) => ({ game: 'chess', kind: 'chess_game_finished', memberId, data: { outcome }, createdAt: at })
const keno = (memberId: string, points: number, at = nov) => ({ game: 'keno', kind: 'keno_round_played', memberId, data: { points }, createdAt: at })

async function total(memberId: string, period: string) {
  const [row] = await db.select().from(xpTotals).where(and(eq(xpTotals.memberId, memberId), eq(xpTotals.period, period)))
  return row?.xp ?? 0
}

test('every XP rule, as the explainer states it', () => {
  assert.equal(xpFor({ game: 'chess', kind: 'chess_game_finished', data: { outcome: 'won' } }), 20)
  assert.equal(xpFor({ game: 'chess', kind: 'chess_game_finished', data: { outcome: 'drawn' } }), 15)
  assert.equal(xpFor({ game: 'chess', kind: 'chess_game_finished', data: { outcome: 'lost' } }), 10)
  assert.equal(xpFor({ game: 'chess', kind: 'chess_game_finished', data: { outcome: 'aborted' } }), 0)
  assert.equal(xpFor({ game: 'keno', kind: 'keno_round_played', data: { points: 0 } }), 2)
  assert.equal(xpFor({ game: 'keno', kind: 'keno_round_played', data: { points: 49 } }), 6)
  assert.equal(xpFor({ game: 'keno', kind: 'keno_round_played', data: { points: 50_000 } }), 22, 'at most 20 for points')
  const placed = (placement: number) => xpFor({ game: 'keno', kind: 'competition_placed', data: { placement } })
  assert.deepEqual([1, 2, 3, 4, 10, 11].map(placed), [105, 65, 45, 25, 25, 5])
  assert.equal(xpFor({ game: 'keno', kind: 'something_else', data: {} }), 0)
  assert.deepEqual(XP_RULES.competition.places, [100, 60, 40])
})

test('events are written with their XP, and it adds up per game, per season and for all time', async () => {
  await db.transaction((tx) => recordEvents(tx, [chess(ada, 'won'), chess(ada, 'drawn'), keno(ada, 30), keno(bayo, 0)]))
  assert.equal(await total(ada, '2026-11'), 20 + 15 + 5)
  assert.equal(await total(ada, 'all'), 40)
  assert.equal(await total(bayo, '2026-11'), 2)
  const [season] = await db.select().from(gameSeasons).where(eq(gameSeasons.slug, '2026-11'))
  const scores = await db.select().from(seasonScores).where(and(eq(seasonScores.seasonId, season!.id), eq(seasonScores.memberId, ada)))
  assert.deepEqual(Object.fromEntries(scores.map((s) => [s.game, s.xp])), { chess: 35, keno: 5 })
  const [profile] = await db.select().from(gameProfiles).where(and(eq(gameProfiles.memberId, ada), eq(gameProfiles.game, 'chess')))
  assert.equal((profile!.stats as { xp: number }).xp, 35)
  assert.ok((await db.select().from(gameEvents)).every((e) => e.xp !== null))
})

test('the season is the Lagos month: 23:30 UTC on 30 November is already December in Lagos', async () => {
  await db.transaction((tx) => recordEvents(tx, [chess(ada, 'lost', new Date('2026-11-30T23:30:00Z'))]))
  assert.equal(await total(ada, '2026-12'), 10)
  assert.equal(await total(ada, '2026-11'), 0)
  assert.deepEqual(await seasonsWithScores(db), ['2026-12'])
})

test('events from before XP existed are scored once, however many times the backfill runs', async () => {
  await db.insert(gameEvents).values([
    { game: 'chess', kind: 'chess_game_finished', memberId: ada, data: { outcome: 'won' }, createdAt: nov },
    { game: 'keno', kind: 'keno_round_played', memberId: ada, data: { points: 100 }, createdAt: nov },
    { game: 'keno', kind: 'keno_round_played', memberId: null, data: {}, createdAt: nov },
  ])
  const [first, second] = await Promise.all([scoreUnscored(db, 1), scoreUnscored(db, 1)])
  assert.equal(first! + second!, 3)
  assert.equal(await scoreUnscored(db), 0)
  assert.equal(await total(ada, 'all'), 20 + 12)
})

/** Gives each member this much Game Score XP in November, through the real scoring. */
async function scored(xp: Record<string, number>) {
  for (const [memberId, n] of Object.entries(xp)) {
    // Ten XP a finished lost chess game.
    await db.transaction((tx) => recordEvents(tx, Array.from({ length: n / 10 }, () => chess(memberId, 'lost'))))
  }
}

test('the Game Score board: ranks, shared ties, blocks either way, mutes and inactive members left out, your row always', async () => {
  const eze = randomUUID()
  await db.insert(members).values({ id: eze, handle: 'eze', active: false })
  await scored({ [ada]: 10, [bayo]: 40, [chi]: 40, [dayo]: 90, [eze]: 500 })
  await db.insert(blocks).values({ blockerId: dayo, blockedId: ada })
  await db.insert(mutes).values({ muterId: ada, mutedId: chi })

  const board = await leaderboard(db, ada, { board: 'score', limit: 1, now: nov })
  assert.equal(board.period, '2026-11')
  assert.deepEqual(board.rows.map((r) => [r.handle, r.rank, r.value]), [['bayo', 1, 40]], 'dayo (blocked), chi (muted) and eze (suspended) are not there')
  assert.deepEqual([board.you!.handle, board.you!.rank, board.you!.value], ['ada', 2, 10])

  const forBayo = await leaderboard(db, bayo, { board: 'score', now: nov })
  assert.deepEqual(forBayo.rows.map((r) => [r.handle, r.rank]), [['dayo', 1], ['bayo', 2], ['chi', 2], ['ada', 4]])
  assert.equal((await leaderboard(db, bayo, { board: 'chess', period: 'all', now: nov })).rows.length, 4, 'all time per game, from the profiles')
  assert.deepEqual((await leaderboard(db, bayo, { board: 'score', period: '2026-12', now: nov })).rows, [], 'another season starts empty')
})

test('filters: people you follow (and you), or the members of a community', async () => {
  await scored({ [ada]: 10, [bayo]: 20, [chi]: 30, [dayo]: 40 })
  await db.insert(follows).values({ followerId: ada, followeeId: chi })
  const following = await leaderboard(db, ada, { board: 'score', filter: 'following', now: nov })
  assert.deepEqual(following.rows.map((r) => [r.handle, r.rank]), [['chi', 1], ['ada', 2]])

  const [c] = await db.insert(communities).values({ slug: 'lagos-chess', name: 'Lagos Chess', description: 'Chess in Lagos' }).returning()
  await db.insert(communityMemberships).values([
    { communityId: c!.id, memberId: bayo },
    { communityId: c!.id, memberId: dayo },
  ])
  const community = await leaderboard(db, ada, { board: 'score', filter: 'community', community: 'lagos-chess', now: nov })
  assert.deepEqual(community.rows.map((r) => r.handle), ['dayo', 'bayo'])
  assert.equal(community.you, null, 'not a member, so not on it')
})
