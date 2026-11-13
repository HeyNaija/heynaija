import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, chessGames, communities, gameEvents, gameProfiles, members, notifications, posts, profileBadges } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { MembersService } from '../../members/members.service.js'
import { NotificationsService } from '../../notifications/notifications.service.js'
import { NotACommunityMemberError, PostsService } from '../../posts/posts.service.js'
import { db, migrate, pool, reset } from '../../test-db.js'
import { TokenBox } from '../core/token-box.js'
import { ARBITER_ID, ARENA_SLUG } from './arena-ids.js'
import { ensureArena } from './arena-setup.js'
import { ChessGamesController, LONG_POLL_MS } from './chess-games.controller.js'
import { ChessGamesService, resultLine } from './chess-games.service.js'
import { ChessError, ChessService } from './chess.service.js'
import { GameWatcher } from './game-watcher.js'
import { LichessError } from './lichess.js'
import { FakeLichess } from './testing.js'

const env = { WEB_PUBLIC_URL: 'https://heynaija.test', LICHESS_URL: 'https://lichess.test', REDIS_URL: 'redis://unused' }
const box = new TokenBox('d'.repeat(64))
const flags = { isEnabled: async () => true }
const postsService = new PostsService(db)
const notificationsService = new NotificationsService(db)

let lichess: FakeLichess
let games: ChessGamesService
let chess: ChessService

const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada', displayName: 'Ada' },
    { id: bayo, handle: 'bayo', displayName: 'Bayo' },
    { id: chi, handle: 'chi' },
  ])
  await ensureArena(db)
  lichess = new FakeLichess()
  games = new ChessGamesService(db, env, lichess, box, postsService)
  // Starting a game without the queue: the watcher's own job is tested on its own below.
  chess = new ChessService(db, env, lichess, box, flags, { begin: (c, id, color) => games.start(c, id, color) })
})
after(() => pool.end())

async function link(memberId: string, name: string) {
  lichess.accounts.set(`tok-${name}`, { id: name.toLowerCase(), username: name, ratings: { rapid: { rating: 1500, games: 20, provisional: false } } })
  const { url } = await chess.startLink(memberId)
  await chess.completeLink(memberId, name, new URL(url).searchParams.get('state')!)
}

/** Ada (white) and Bayo (black) in a rated Rapid 10+5 game, thread or not. Returns the game's id. */
async function play(openThread = true) {
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  const made = await chess.challenge(ada, { handle: 'bayo', rated: true, timeControl: '10+5', color: 'white', openThread })
  await chess.accept(bayo, made.id)
  return lichess.gameId(1)
}

const state = (moves: string, status = 'started', extra: object = {}) => ({ moves, status, wtime: 600_000, btime: 600_000, ...extra })

const refusal = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (err) {
    if (err instanceof ChessError) return err.code
    throw err
  }
  assert.fail('expected a ChessError')
}

test('The Arbiter and Chess Arena are made once, and @arbiter can never be taken', async () => {
  await ensureArena(db)
  const [arbiter] = await db.select().from(members).where(eq(members.id, ARBITER_ID))
  assert.deepEqual([arbiter!.handle, arbiter!.displayName, arbiter!.emailNotifications], ['arbiter', 'The Arbiter', false])
  assert.equal((await db.select().from(profileBadges).where(eq(profileBadges.memberId, ARBITER_ID)))[0]!.kind, 'automated')
  assert.equal((await db.select().from(communities).where(eq(communities.slug, ARENA_SLUG))).length, 1)
  assert.equal(await new MembersService(db).handleHeld('arbiter', null), true)
  assert.equal(await new MembersService(db).handleHeld('ARBITER', randomUUID()), true)
})

test('if a person already had @arbiter, The Arbiter takes @arbiter_hn and the person keeps theirs', async () => {
  await reset()
  const person = randomUUID()
  await db.insert(members).values({ id: person, handle: 'arbiter' })
  await ensureArena(db)
  const [arbiter] = await db.select().from(members).where(eq(members.id, ARBITER_ID))
  assert.equal(arbiter!.handle, 'arbiter_hn')
  assert.equal((await db.select().from(members).where(eq(members.id, person)))[0]!.handle, 'arbiter')
})

test('only The Arbiter starts posts in Chess Arena; members reply', async () => {
  await assert.rejects(postsService.create(ada, 'my own thread', { communitySlug: ARENA_SLUG, anyMember: true }), NotACommunityMemberError)
  const { id } = await postsService.create(ARBITER_ID, 'A vs B', { communitySlug: ARENA_SLUG, anyMember: true })
  await postsService.create(ada, 'Good luck!', { replyTo: id })
})

test('accepting starts the game here, tells the challenger, and opens The Arbiter’s thread', async () => {
  const id = await play()
  const [g] = await db.select().from(chessGames).where(eq(chessGames.id, id))
  assert.deepEqual([g!.whiteId, g!.blackId, g!.status, g!.rated], [ada, bayo, 'started', true])
  const [started] = (await notificationsService.list(ada, 10)).notifications
  assert.deepEqual([started!.kind, started!.actor!.handle, started!.game], ['chess_game_started', 'bayo', { id }])
  const [thread] = await db.select().from(posts).where(eq(posts.id, g!.threadPostId!))
  assert.equal(thread!.authorId, ARBITER_ID)
  assert.match(thread!.text, /^Ada \(white\) vs Bayo \(black\) · rated Rapid 10\+5\./)
  assert.match(thread!.text, new RegExp(`https://heynaija\\.test/games/chess/games/${id}`))
  assert.ok(!thread!.text.includes('@'), 'names, not @mentions, so nobody is pinged')
  assert.equal((await db.select().from(notifications).where(eq(notifications.kind, 'mention'))).length, 0)
  // The Arbiter is notified of nothing, however many reply.
  await postsService.create(chi, 'Come on Ada', { replyTo: thread!.id })
  assert.equal((await db.select().from(notifications).where(eq(notifications.recipientId, ARBITER_ID))).length, 0)
})

test('a player with no display name is named by handle in the thread, still without an @', async () => {
  await link(chi, 'Chi')
  await link(bayo, 'Bayo')
  const made = await chess.challenge(chi, { handle: 'bayo', rated: false, timeControl: '5+3', color: 'white' })
  await chess.accept(bayo, made.id)
  const [g] = await db.select().from(chessGames)
  const [thread] = await db.select().from(posts).where(eq(posts.id, g!.threadPostId!))
  assert.match(thread!.text, /^chi \(white\) vs Bayo \(black\)/)
  assert.equal((await db.select().from(notifications).where(eq(notifications.kind, 'mention'))).length, 0, 'nobody pinged')
})

test('no thread when the challenger did not want one', async () => {
  const id = await play(false)
  const [g] = await db.select().from(chessGames).where(eq(chessGames.id, id))
  assert.equal(g!.threadPostId, null)
})

test('"either colour" is settled before the game is made, so HeyNaija knows who is white', async () => {
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  const made = await chess.challenge(ada, { handle: 'bayo', rated: false, timeControl: '5+3', color: 'random' })
  await chess.accept(bayo, made.id)
  const sent = JSON.parse(lichess.calls.find((c) => c.startsWith('create'))!.split(':').slice(2).join(':')) as { color: string }
  const [g] = await db.select().from(chessGames)
  assert.equal(g!.whiteId === ada ? 'white' : 'black', sent.color)
})

test('what the stream says is kept, the version moves on, and nothing changes when nothing is new', async () => {
  const id = await play()
  assert.equal(await games.applyState(id, state('e2e4')), false)
  const first = (await games.view(chi, id))!
  assert.deepEqual([first.moves, first.version, first.whiteMs, first.you], [['e2e4'], 1, 600_000, null])
  await games.applyState(id, state('e2e4'))
  assert.equal((await games.view(chi, id))!.version, 1, 'the same state is not a change')
  await games.applyState(id, state('e2e4 e7e5', 'started', { bdraw: true }))
  const second = (await games.view(ada, id))!
  assert.deepEqual([second.moves, second.drawOffer, second.you], [['e2e4', 'e7e5'], 'black', 'white'])
})

test('when the game ends: finished once, ratings read, results kept, and The Arbiter posts the result', async () => {
  const id = await play()
  assert.equal(await games.applyState(id, state('e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7', 'mate', { winner: 'white' })), true)
  await games.finish(id) // a second time does nothing
  const view = (await games.view(ada, id))!
  assert.deepEqual([view.finished, view.winner, view.status], [true, 'white', 'mate'])
  const events = await db.select().from(gameEvents).where(eq(gameEvents.kind, 'chess_game_finished'))
  // With their Game Score XP (phase 5): 10 for the game, 10 more for the win.
  assert.deepEqual(events.map((e) => [e.memberId, (e.data as { outcome: string }).outcome, e.xp]).sort(), [[ada, 'won', 20], [bayo, 'lost', 10]].sort())
  const [adaStats] = await db.select().from(gameProfiles).where(and(eq(gameProfiles.memberId, ada), eq(gameProfiles.game, 'chess')))
  assert.deepEqual(adaStats!.stats, { played: 1, won: 1, xp: 20 })
  const [g] = await db.select().from(chessGames).where(eq(chessGames.id, id))
  const [result] = await db.select().from(posts).where(eq(posts.id, g!.resultPostId!))
  assert.equal(result!.authorId, ARBITER_ID)
  assert.equal(result!.replyParentId, g!.threadPostId)
  assert.match(result!.text, /^Ada won by checkmate after 4 moves\./)
  assert.match(result!.text, /now visible to both players/)
  // The challenger's "your game has started" goes once the game is over.
  assert.equal((await notificationsService.list(ada, 10)).notifications.filter((n) => n.kind === 'chess_game_started').length, 0)
})

test('results read plainly', () => {
  const names = { white: 'Ada', black: 'Bayo' }
  assert.equal(resultLine({ status: 'resign', winner: 'black' }, names), 'Bayo won by resignation')
  assert.equal(resultLine({ status: 'outoftime', winner: 'white' }, names), 'Ada won on time')
  assert.equal(resultLine({ status: 'draw', winner: null }, names), 'Drawn')
  assert.equal(resultLine({ status: 'stalemate', winner: null }, names), 'Drawn by stalemate')
  assert.equal(resultLine({ status: 'aborted', winner: null }, names), 'Game aborted before it got going')
})

test('spectators’ replies are hidden from both players until the game ends; everyone else sees them', async () => {
  const id = await play()
  const [g] = await db.select().from(chessGames).where(eq(chessGames.id, id))
  const thread = g!.threadPostId!
  const fromChi = await postsService.create(chi, 'Ada should push the h-pawn, @ada', { replyTo: thread })
  const fromBayo = await postsService.create(bayo, 'Good game in advance', { replyTo: thread })
  const replyIds = async (viewer: string) => (await postsService.replies(viewer, thread, 30))!.replies.map((r) => ('id' in r ? r.id : 'x'))

  assert.deepEqual(await replyIds(ada), [fromBayo.id], 'a player sees only the players')
  assert.ok((await replyIds(chi)).includes(fromChi.id))
  assert.equal((await postsService.post(ada, fromChi.id)) ?? null, null, 'nor by opening it')
  assert.ok(!(await notificationsService.list(ada, 10)).notifications.some((n) => n.kind === 'mention'), 'the mention waits')

  await games.applyState(id, state('e2e4', 'resign', { winner: 'black' }))
  assert.ok((await replyIds(ada)).includes(fromChi.id), 'all shown once it is over')
  assert.ok((await notificationsService.list(ada, 10)).notifications.some((n) => n.kind === 'mention'))
})

test('a game shows to members who can see both players; blocking either hides it', async () => {
  const id = await play()
  assert.equal((await games.view(chi, id))!.you, null)
  assert.deepEqual((await games.live(chi)).map((g) => g.id), [id])
  assert.deepEqual(await games.playingNow(chi, 'bayo'), { id })
  await db.insert(blocks).values({ blockerId: bayo, blockedId: chi })
  assert.equal(await games.view(chi, id), null)
  assert.deepEqual(await games.live(chi), [])
  assert.equal(await games.playingNow(chi, 'ada'), null)
  await games.applyState(id, state('', 'aborted'))
  assert.deepEqual(await games.live(ada), [], 'finished games are not live')
})

test('only the players act, with their own token; Lichess decides what is legal', async () => {
  const id = await play()
  assert.equal(await refusal(() => games.act(chi, id, { kind: 'move', uci: 'e2e4' })), 'not_found')
  await games.act(ada, id, { kind: 'move', uci: 'e2e4' })
  assert.ok(lichess.calls.includes(`move:tok-Ada:${id}:e2e4`))
  await games.act(bayo, id, { kind: 'draw', answer: 'offer' })
  await games.act(ada, id, { kind: 'draw', answer: 'decline' })
  assert.deepEqual(lichess.calls.filter((c) => c.startsWith('draw')), [`draw:tok-Bayo:${id}:yes`, `draw:tok-Ada:${id}:no`])
  lichess.fail.move = new LichessError('rejected', 'illegal')
  assert.equal(await refusal(() => games.act(ada, id, { kind: 'move', uci: 'e2e5' })), 'illegal_move')
  await games.finish(id)
  assert.equal(await refusal(() => games.act(ada, id, { kind: 'resign' })), 'game_over')
})

test('the watcher follows the stream, opens it again when it drops, and stops when the game ends', async () => {
  const id = await play()
  const watcher = new GameWatcher(env, games, lichess)
  const controller = new AbortController()
  lichess.push(id, { type: 'gameFull', state: state('e2e4') })
  lichess.push(id, null) // Lichess drops the connection
  lichess.push(id, { type: 'gameState', ...state('e2e4 c7c5') })
  lichess.push(id, { type: 'gameState', ...state('e2e4 c7c5 g1f3', 'resign', { winner: 'black' }) })
  await watcher.follow(id, controller.signal)
  const view = (await games.view(ada, id))!
  assert.deepEqual([view.moves.length, view.finished, view.winner], [3, true, 'black'])
  assert.equal(lichess.calls.filter((c) => c === `stream:tok-Ada:${id}`).length, 2, 'opened again after the drop')
})

test('a game Lichess no longer has is finished rather than followed for ever', async () => {
  const id = await play()
  lichess.fail.stream = new LichessError('rejected', 'no such game')
  await new GameWatcher(env, games, lichess).follow(id, new AbortController().signal)
  assert.equal((await games.view(ada, id))!.finished, true)
})

test('the page’s request answers at once with something newer, and otherwise waits for the next change', async () => {
  const id = await play()
  let waited = 0
  const changes = {
    wait: async (_id: string, ms: number) => {
      waited = ms
      await games.applyState(id, state('d2d4'))
    },
  }
  const controller = new ChessGamesController(games, changes, { hit: async () => {} } as never)
  const req = { member: { id: chi, handle: 'chi' } } as never
  const now = await controller.view(req, id, { after: '-1' })
  assert.equal(waited, 0, 'the page had nothing: answered at once')
  const next = await controller.view(req, id, { after: String(now.version) })
  assert.equal(waited, LONG_POLL_MS)
  assert.deepEqual(next.moves, ['d2d4'])
})
