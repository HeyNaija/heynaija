import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { communities, communityMemberships, communityTeams, competitionEntries, competitions, gameEvents, lichessAccounts, members, posts } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { PostsService } from '../../posts/posts.service.js'
import { db, migrate, pool, reset } from '../../test-db.js'
import { CompetitionError, CompetitionsService, scoreText } from '../core/competitions.js'
import { TokenBox } from '../core/token-box.js'
import { ARBITER_ID } from './arena-ids.js'
import { ensureArena } from './arena-setup.js'
import { ChessError, ChessService } from './chess.service.js'
import { LichessError, parseResults } from './lichess.js'
import { FakeLichess } from './testing.js'
import { FALLBACK_MS, type TournamentInput, TeamsService, teamIdFrom } from './teams.js'
import { arenaLengths } from './time-controls.js'

const env = { WEB_PUBLIC_URL: 'https://heynaija.test', LICHESS_URL: 'https://lichess.test', CHESS_STANDINGS_EVERY_MS: 120_000 }
const box = new TokenBox('d'.repeat(64))
let gamesOn = true
const flags = { onForAnyone: async () => gamesOn, isEnabled: async () => gamesOn }

let lichess: FakeLichess
let chess: ChessService
let competitionsService: CompetitionsService
let teams: TeamsService

const mo = randomUUID() // moderates Lagos Chess, and leads its team on Lichess
const ada = randomUUID()
const bayo = randomUUID()
const sam = randomUUID() // a site moderator
const eze = randomUUID() // linked to Lichess, but not in the community
let lagos: string

// 3 November 2026, 10:00 in Lagos.
const now = new Date('2026-11-03T09:00:00Z')
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

before(migrate)
beforeEach(async () => {
  await reset()
  gamesOn = true
  await db.insert(members).values([
    { id: mo, handle: 'mo', displayName: 'Mo' },
    { id: ada, handle: 'ada', displayName: 'Ada' },
    { id: bayo, handle: 'bayo', displayName: 'Bayo' },
    { id: sam, handle: 'sam', role: 'moderator' },
    { id: eze, handle: 'eze' },
  ])
  await ensureArena(db)
  const [c] = await db.insert(communities).values({ slug: 'lagos-chess', name: 'Lagos Chess', description: 'Chess in Lagos' }).returning()
  lagos = c!.id
  await db.insert(communityMemberships).values([
    { communityId: lagos, memberId: mo, role: 'moderator' },
    { communityId: lagos, memberId: ada },
    { communityId: lagos, memberId: bayo },
  ])
  lichess = new FakeLichess()
  lichess.teams.set('lagos-chess-club', { id: 'lagos-chess-club', name: 'Lagos Chess Club', nbMembers: 40, leaders: ['mochess'] })
  chess = new ChessService(db, env, lichess, box, flags)
  competitionsService = new CompetitionsService(db, env, flags, new PostsService(db))
  teams = new TeamsService(db, env, lichess, box, flags, competitionsService)
})
after(() => pool.end())

/** Links a member's Lichess account through the OAuth round trip, with tournament permission if asked. */
async function linkLichess(memberId: string, name: string, tournaments = false) {
  lichess.accounts.set(`tok-${name}`, { id: name.toLowerCase(), username: name, ratings: {} })
  const { url } = await chess.startLink(memberId, now, { tournaments })
  await chess.completeLink(memberId, name, new URL(url).searchParams.get('state')!, now)
}

const code = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (err) {
    if (err instanceof ChessError || err instanceof CompetitionError) return err.code
    throw err
  }
  assert.fail('expected a refusal')
}

const arena = (over: Partial<TournamentInput> = {}): TournamentInput => ({
  name: 'Lagos Blitz',
  kind: 'arena',
  timeControl: '3+2',
  rated: true,
  startsAt: later(30),
  minutes: 60,
  ...over,
})

/** Mo, set up to run tournaments: linked with permission, and the team linked. */
async function ready() {
  await linkLichess(mo, 'MoChess', true)
  await teams.link(mo, 'lagos-chess', 'https://lichess.org/team/lagos-chess-club', now)
}

test('the team id is read from an address or an id, and nonsense is refused', () => {
  assert.equal(teamIdFrom('https://lichess.org/team/Lagos-Chess-Club'), 'lagos-chess-club')
  assert.equal(teamIdFrom('lichess.org/team/coders?x=1'), 'coders')
  assert.equal(teamIdFrom(' coders '), 'coders')
  assert.equal(teamIdFrom('https://evil.test/team/coders'), null)
  assert.equal(teamIdFrom('no spaces please'), null)
})

test('asking to run tournaments adds tournament:write to what Lichess is asked, and it is recorded', async () => {
  const { url } = await chess.startLink(mo, now, { tournaments: true })
  assert.equal(new URL(url).searchParams.get('scope'), 'challenge:read challenge:write board:play tournament:write')
  const plain = await chess.startLink(ada, now)
  assert.equal(new URL(plain.url).searchParams.get('scope'), 'challenge:read challenge:write board:play', 'nobody else is asked for it')
  await linkLichess(mo, 'MoChess', true)
  const [account] = await db.select().from(lichessAccounts).where(eq(lichessAccounts.memberId, mo))
  assert.equal(account!.scopes, 'challenge:read challenge:write board:play tournament:write')
})

test('linking a team: a moderator of the community who leads the team on Lichess, one community a team', async () => {
  assert.equal(await code(() => teams.link(mo, 'lagos-chess', 'lagos-chess-club', now)), 'not_linked')
  await linkLichess(mo, 'MoChess')
  await linkLichess(ada, 'AdaPlays')
  assert.equal(await code(() => teams.link(ada, 'lagos-chess', 'lagos-chess-club', now)), 'not_moderator', 'a member, not a moderator')
  assert.equal(await code(() => teams.link(mo, 'lagos-chess', 'nobody-team', now)), 'no_team')
  lichess.teams.set('other-team', { id: 'other-team', name: 'Other', nbMembers: 3, leaders: ['someoneelse'] })
  assert.equal(await code(() => teams.link(mo, 'lagos-chess', 'other-team', now)), 'not_leader')

  await teams.link(mo, 'lagos-chess', 'https://lichess.org/team/lagos-chess-club', now)
  const view = await teams.view(ada, 'lagos-chess', now)
  assert.deepEqual(view.team, { id: 'lagos-chess-club', name: 'Lagos Chess Club', nbMembers: 40, url: 'https://lichess.test/team/lagos-chess-club' })
  assert.equal(view.you.canLink, false)
  const mine = await teams.view(mo, 'lagos-chess', now)
  assert.deepEqual([mine.you.canLink, mine.you.canCreate, mine.you.needsTournamentScope], [true, false, true], 'needs permission to make tournaments first')
  assert.ok(mine.controls.every((c) => c.arenaMinutes.length > 0))

  // Another community cannot take the same team.
  const [other] = await db.insert(communities).values({ slug: 'abuja-chess', name: 'Abuja Chess', description: 'Chess in Abuja' }).returning()
  await db.insert(communityMemberships).values({ communityId: other!.id, memberId: mo, role: 'moderator' })
  assert.equal(await code(() => teams.link(mo, 'abuja-chess', 'lagos-chess-club', now)), 'team_taken')

  // A different team replaces it; a site moderator can unlink.
  lichess.teams.set('lagos-blitz', { id: 'lagos-blitz', name: 'Lagos Blitz', nbMembers: 9, leaders: ['mochess'] })
  await teams.link(mo, 'lagos-chess', 'lagos-blitz', now)
  assert.equal((await db.select().from(communityTeams)).map((t) => t.lichessTeamId).join(), 'lagos-blitz')
  assert.equal(await code(() => teams.unlink(ada, 'lagos-chess')), 'not_moderator')
  await teams.unlink(sam, 'lagos-chess')
  assert.equal((await db.select().from(communityTeams)).length, 0)
})

test('the team’s name and size are read again after an hour, not before', async () => {
  await ready()
  lichess.teams.set('lagos-chess-club', { id: 'lagos-chess-club', name: 'Lagos Chess Club (renamed)', nbMembers: 41, leaders: ['mochess'] })
  assert.equal((await teams.view(ada, 'lagos-chess', later(30))).team!.name, 'Lagos Chess Club')
  assert.equal((await teams.view(ada, 'lagos-chess', later(61))).team!.name, 'Lagos Chess Club (renamed)')
})

test('making an Arena and a Swiss: checked, made on Lichess with the moderator’s token, and kept as a community competition', async () => {
  await linkLichess(mo, 'MoChess')
  await teams.link(mo, 'lagos-chess', 'lagos-chess-club', now)
  assert.equal(await code(() => teams.createTournament(mo, 'lagos-chess', arena(), now)), 'needs_scope')
  await linkLichess(mo, 'MoChess', true)
  assert.equal(await code(() => teams.createTournament(ada, 'lagos-chess', arena(), now)), 'not_moderator')
  for (const bad of [
    arena({ name: 'x' }),
    arena({ name: 'A name far too long for Lichess to take' }),
    arena({ timeControl: '1+0' }),
    arena({ startsAt: later(5) }),
    arena({ startsAt: later(61 * 24 * 60) }),
    arena({ timeControl: '30+0', minutes: 60 }),
    arena({ kind: 'swiss', rounds: 2 }),
    arena({ kind: 'swiss', rounds: 16 }),
  ]) {
    assert.equal(await code(() => teams.createTournament(mo, 'lagos-chess', bad, now)), 'invalid', JSON.stringify(bad))
  }
  assert.deepEqual(arenaLengths({ limit: 1800, increment: 0 }), [150, 180])

  const id = await teams.createTournament(mo, 'lagos-chess', arena(), now)
  const made = [...lichess.tournaments.values()][0]!
  assert.deepEqual(made.request, { name: 'Lagos Blitz', clockLimit: 180, clockIncrement: 2, rated: true, startsAt: later(30), teamId: 'lagos-chess-club', kind: 'arena', minutes: 60 })
  assert.ok(lichess.calls.some((c) => c.startsWith('tournament:tok-MoChess:')), 'with the moderator’s own token')
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id))
  assert.deepEqual(
    [c!.game, c!.format, c!.eligibility, c!.communityId, c!.status, c!.startsAt, c!.endsAt],
    ['chess', 'lichess_arena', 'community', lagos, 'open', later(30), later(90)],
  )

  const swiss = await teams.createTournament(mo, 'lagos-chess', arena({ kind: 'swiss', timeControl: '10+0', rounds: 5, minutes: undefined, rated: false }), now)
  const view = await competitionsService.view(ada, swiss, now)
  assert.equal(view.chess!.kind, 'swiss')
  assert.equal(view.chess!.rounds, 5)
  assert.match(view.chess!.url, /^https:\/\/lichess\.test\/swiss\/tn\d+$/)
  assert.equal(view.chess!.teamUrl, 'https://lichess.test/team/lagos-chess-club')
  assert.deepEqual([view.you.canEnter, view.you.canWithdraw, view.you.canCancel], [false, false, false], 'joined on Lichess, not here')
  assert.equal(await code(() => competitionsService.enter(ada, swiss, now)), 'not_eligible')
  assert.equal((await competitionsService.view(mo, swiss, now)).you.canCancel, true)
})

test('a moderator who no longer leads the team on Lichess cannot make one, and the moderators’ form never makes chess', async () => {
  await ready()
  lichess.teams.set('lagos-chess-club', { id: 'lagos-chess-club', name: 'Lagos Chess Club', nbMembers: 40, leaders: ['someoneelse'] })
  assert.equal(await code(() => teams.createTournament(mo, 'lagos-chess', arena(), now)), 'not_leader')
  assert.equal(lichess.tournaments.size, 0)
  const refused = await code(() =>
    competitionsService.create(sam, { name: 'Chess Cup', game: 'chess', format: 'lichess_arena', eligibility: 'community', community: 'lagos-chess', entryOpensAt: now, entryClosesAt: later(60), startsAt: now, endsAt: later(60) }, true, now),
  )
  assert.equal(refused, 'invalid')
})

test('Lichess refusing, or the write failing, leaves nothing behind', async () => {
  await ready()
  lichess.fail.create = new LichessError('rejected', 'too many today')
  assert.equal(await code(() => teams.createTournament(mo, 'lagos-chess', arena(), now)), 'lichess_rejected')
  assert.equal((await db.select().from(competitions)).length, 0)
})

/** Sets what Lichess says about the only tournament. */
function lichessSays(status: 'created' | 'started' | 'finished', results: { rank: number; username: string; score: number }[], nbPlayers = results.length) {
  const t = [...lichess.tournaments.values()].at(-1)!
  Object.assign(t, { status, results, nbPlayers })
}

test('standings: HeyNaija members of the community who linked that Lichess account, in Lichess’s order, read at most every two minutes', async () => {
  await ready()
  await linkLichess(ada, 'AdaPlays')
  await linkLichess(bayo, 'BayoB')
  await linkLichess(eze, 'Eze')
  const id = await teams.createTournament(mo, 'lagos-chess', arena(), now)

  assert.deepEqual(await teams.sync(later(10)), [], 'not started yet: nothing asked')
  assert.ok(!lichess.calls.some((c) => c.startsWith('state:')))

  lichessSays('started', [
    { rank: 1, username: 'Stranger', score: 14 },
    { rank: 2, username: 'BayoB', score: 9 },
    { rank: 3, username: 'Eze', score: 9 },
    { rank: 4, username: 'AdaPlays', score: 9 },
  ], 25)
  await teams.sync(later(40))
  const view = await competitionsService.view(ada, id, later(40))
  assert.equal(view.status, 'live')
  assert.deepEqual(
    view.standings.map((s) => [s.place, s.handle, s.score, s.lichess!.rank, s.lichess!.username]),
    [
      [1, 'bayo', 9, 2, 'BayoB'],
      [2, 'ada', 9, 4, 'AdaPlays'],
    ],
    'Eze is not in the community, Stranger is not on HeyNaija; Lichess broke the tie',
  )
  assert.equal(view.chess!.players, 25)

  lichess.calls = []
  await teams.sync(later(41))
  assert.equal(lichess.calls.length, 0, 'read a minute ago: not again yet')

  // Bayo leaves the community: off the standings at the next read.
  await db.delete(communityMemberships).where(and(eq(communityMemberships.communityId, lagos), eq(communityMemberships.memberId, bayo)))
  await teams.sync(later(43))
  assert.deepEqual((await db.select().from(competitionEntries)).map((e) => e.memberId), [ada])
})

test('finishing: places and XP in Lichess’s order, The Arbiter posts in the community with the Lichess link', async () => {
  await ready()
  await linkLichess(ada, 'AdaPlays')
  await linkLichess(bayo, 'BayoB')
  const id = await teams.createTournament(mo, 'lagos-chess', arena({ kind: 'swiss', timeControl: '10+0', rounds: 5, minutes: undefined }), now)
  // Swiss points are doubled: 9 is 4½.
  lichessSays('finished', [
    { rank: 1, username: 'AdaPlays', score: 9 },
    { rank: 2, username: 'Stranger', score: 8 },
    { rank: 3, username: 'BayoB', score: 8 },
  ])
  assert.deepEqual(await teams.sync(later(200)), [id])
  const entries = await db.select().from(competitionEntries).where(eq(competitionEntries.competitionId, id))
  assert.deepEqual(Object.fromEntries(entries.map((e) => [e.memberId, e.placement])), { [ada]: 1, [bayo]: 2 })
  const events = await db.select().from(gameEvents).where(eq(gameEvents.kind, 'competition_placed'))
  assert.deepEqual(Object.fromEntries(events.map((e) => [e.memberId, e.xp])), { [ada]: 105, [bayo]: 65 })

  const [c] = await db.select().from(competitions).where(eq(competitions.id, id))
  assert.equal(c!.status, 'finished')
  const [post] = await db.select().from(posts).where(eq(posts.id, c!.resultPostId!))
  assert.equal(post!.authorId, ARBITER_ID)
  assert.equal(post!.communityId, lagos)
  assert.match(post!.text, /^Lagos Blitz is over\. The results for HeyNaija members:\n\n1\. Ada · 4½ points\n2\. Bayo · 4 points\n\n2 members took part\./)
  assert.match(post!.text, /On Lichess: https:\/\/lichess\.test\/swiss\/tn\d+$/)
  assert.deepEqual(await teams.sync(later(300)), [], 'finished once')
})

test('a day overdue and Lichess has not finished it: finished from the last standings, and the post says so', async () => {
  await ready()
  await linkLichess(ada, 'AdaPlays')
  const id = await teams.createTournament(mo, 'lagos-chess', arena(), now)
  lichessSays('started', [{ rank: 1, username: 'AdaPlays', score: 4 }])
  await teams.sync(later(60))
  lichess.fail.tournament = new LichessError('unavailable', 'down')
  const overdue = new Date(later(90).getTime() + FALLBACK_MS + 60_000)
  assert.deepEqual(await teams.sync(overdue), [id])
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id))
  const [post] = await db.select().from(posts).where(eq(posts.id, c!.resultPostId!))
  assert.match(post!.text, /1\. Ada · 4 points/)
  assert.match(post!.text, /Lichess had not finished it a day after it was due to end/)
})

test('Lichess asking us to slow down stops the run; Games off for everyone does nothing', async () => {
  await ready()
  await teams.createTournament(mo, 'lagos-chess', arena(), now)
  await teams.createTournament(mo, 'lagos-chess', arena({ name: 'Second' }), now)
  lichessSays('started', [])
  lichess.fail.tournament = new LichessError('rate_limited', 'slow down', 60_000)
  lichess.calls = []
  await teams.sync(later(40))
  assert.equal(lichess.calls.filter((c) => c.startsWith('state:')).length, 1, 'one call, then it waits for the next run')
  gamesOn = false
  lichess.fail = {}
  lichess.calls = []
  await teams.sync(later(50))
  assert.equal(lichess.calls.length, 0)
})

test('cancelling: the moderator who made it or a site moderator; ended on Lichess when it can be', async () => {
  await ready()
  const id = await teams.createTournament(mo, 'lagos-chess', arena(), now)
  assert.equal(await code(() => teams.cancelTournament(ada, id)), 'not_moderator')
  assert.equal(await code(() => competitionsService.cancel(sam, id)), 'invalid', 'not through the Keno route, so it ends on Lichess too')
  assert.deepEqual(await teams.cancelTournament(mo, id), { onLichess: true })
  assert.ok(lichess.calls.some((c) => c.startsWith('terminate:tok-MoChess:arena:')))
  assert.equal((await db.select().from(competitions))[0]!.status, 'cancelled')

  const second = await teams.createTournament(mo, 'lagos-chess', arena({ name: 'Second' }), now)
  lichess.fail.terminate = new LichessError('rejected', 'no')
  assert.deepEqual(await teams.cancelTournament(sam, second), { onLichess: false }, 'cancelled here even so')
  assert.equal(await code(() => teams.cancelTournament(sam, second)), 'invalid')
})

test('Lichess results are read from ndjson: Arena scores, Swiss points doubled, bad lines skipped', () => {
  const arenaLines = '{"rank":2,"score":7,"username":"B"}\n{"rank":1,"score":9,"username":"A"}\nnot json\n\n'
  assert.deepEqual(parseResults('arena', arenaLines), [
    { rank: 1, username: 'A', score: 9 },
    { rank: 2, username: 'B', score: 7 },
  ])
  assert.deepEqual(parseResults('swiss', '{"rank":1,"points":4.5,"username":"A"}\n{"rank":2,"username":"B"}'), [{ rank: 1, username: 'A', score: 9 }])
  assert.deepEqual([scoreText('lichess_swiss', 9), scoreText('lichess_swiss', 1), scoreText('lichess_swiss', 2), scoreText('lichess_arena', 12)], ['4½ points', '½ point', '1 point', '12 points'])
})
