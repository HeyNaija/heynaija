import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, chessChallenges, lichessAccounts, lichessLinkAttempts, members } from '@heynaija/db'
import { NotificationsService } from '../../notifications/notifications.service.js'
import { db, migrate, pool, reset } from '../../test-db.js'
import { TokenBox } from '../core/token-box.js'
import { ChessError, ChessService, LINK_ATTEMPT_MS, RATINGS_STALE_MS } from './chess.service.js'
import { LichessError } from './lichess.js'
import { FakeLichess } from './testing.js'

const env = { WEB_PUBLIC_URL: 'https://heynaija.test', LICHESS_URL: 'https://lichess.test' }
const key = 'c'.repeat(64)
const box = new TokenBox(key)

let lichess: FakeLichess
let gamesOff: Set<string>
let service: ChessService
const flags = { isEnabled: async (_key: string, id?: string | null) => !gamesOff.has(id ?? '') }
const notificationsService = new NotificationsService(db)

const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
  lichess = new FakeLichess()
  gamesOff = new Set()
  service = new ChessService(db, env, lichess, box, flags)
})
after(() => pool.end())

const stateOf = (url: string) => new URL(url).searchParams.get('state')!

/** Links `memberId` to the Lichess account `name`, through the whole OAuth round trip. */
async function link(memberId: string, name: string) {
  lichess.accounts.set(`tok-${name}`, { id: name.toLowerCase(), username: name, ratings: { rapid: { rating: 1500, games: 20, provisional: false } } })
  const { url } = await service.startLink(memberId)
  return service.completeLink(memberId, name, stateOf(url))
}

const refusal = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (err) {
    if (err instanceof ChessError) return err.code
    throw err
  }
  assert.fail('expected a ChessError')
}

test('linking sends the member to Lichess with PKCE, then keeps the account with its token sealed', async () => {
  const { url } = await service.startLink(ada)
  const sent = new URL(url).searchParams
  assert.equal(sent.get('client_id'), 'heynaija.test')
  assert.equal(sent.get('redirect_uri'), 'https://heynaija.test/games/chess/callback')
  assert.match(sent.get('code_challenge')!, /^[\w-]{43}$/)
  const [attempt] = await db.select().from(lichessLinkAttempts)
  assert.notEqual(attempt!.stateHash, sent.get('state'), 'only a hash of the state is kept')

  lichess.accounts.set('tok-Ada', { id: 'ada', username: 'Ada', ratings: { rapid: { rating: 1500, games: 20, provisional: false } } })
  const linked = await service.completeLink(ada, 'Ada', sent.get('state')!)
  assert.equal(linked.username, 'Ada')
  assert.deepEqual(linked.ratings, { rapid: { rating: 1500, games: 20, provisional: false } })
  const [row] = await db.select().from(lichessAccounts)
  assert.ok(!row!.tokenBox.includes('tok-Ada'))
  assert.equal(box.open(row!.tokenBox, ada), 'tok-Ada')
  assert.equal((await db.select().from(lichessLinkAttempts)).length, 0, 'the attempt is used up')
})

test('a linking step works once, only for the member who started it, and only for ten minutes', async () => {
  const now = new Date('2026-11-03T10:00:00Z')
  lichess.accounts.set('tok-Ada', { id: 'ada', username: 'Ada', ratings: {} })
  const first = stateOf((await service.startLink(ada, now)).url)
  assert.equal(await refusal(() => service.completeLink(bayo, 'Ada', first, now)), 'link_expired', 'someone else cannot finish it')
  assert.equal(await refusal(() => service.completeLink(ada, 'Ada', first, now)), 'link_expired', 'and that used it up')

  const late = stateOf((await service.startLink(ada, now)).url)
  assert.equal(await refusal(() => service.completeLink(ada, 'Ada', late, new Date(now.getTime() + LINK_ATTEMPT_MS + 1))), 'link_expired')
  assert.equal(await refusal(() => service.completeLink(ada, 'Ada', 'made-up', now)), 'link_expired')
  assert.ok(!lichess.calls.some((c) => c.startsWith('token:')), 'Lichess is never asked with a bad state')
})

test('one Lichess account belongs to one member: a second gets refused and the new token is given back', async () => {
  await link(ada, 'Ada')
  lichess.accounts.set('tok-Ada2', { id: 'ada', username: 'Ada', ratings: {} })
  const state = stateOf((await service.startLink(bayo)).url)
  assert.equal(await refusal(() => service.completeLink(bayo, 'Ada2', state)), 'already_linked')
  assert.ok(lichess.calls.includes('revoke:tok-Ada2'))
  assert.equal((await db.select().from(lichessAccounts)).length, 1)
  // Linking again as the same member replaces the token.
  lichess.accounts.set('tok-AdaAgain', { id: 'ada', username: 'Ada', ratings: {} })
  const again = stateOf((await service.startLink(ada)).url)
  await service.completeLink(ada, 'AdaAgain', again)
  const [row] = await db.select().from(lichessAccounts)
  assert.equal(box.open(row!.tokenBox, ada), 'tok-AdaAgain')
})

test('without a token key, linking is not available', async () => {
  const keyless = new ChessService(db, env, lichess, null, flags)
  assert.equal(await refusal(() => keyless.startLink(ada)), 'not_available')
  assert.equal((await keyless.overview(ada)).linkingAvailable, false)
  assert.equal((await service.overview(ada)).linkingAvailable, true)
})

test('unlinking gives the token back and forgets it, even when Lichess cannot be reached', async () => {
  await link(ada, 'Ada')
  await service.unlink(ada)
  assert.ok(lichess.calls.includes('revoke:tok-Ada'))
  assert.equal((await db.select().from(lichessAccounts)).length, 0)

  await link(ada, 'Ada')
  lichess.fail.revoke = new LichessError('unavailable', 'down')
  await service.unlink(ada)
  assert.equal((await db.select().from(lichessAccounts)).length, 0)
})

test('a challenge needs both members linked, no block either way, Games for both, and a time control on offer', async () => {
  const to = (handle: string, timeControl = '10+5') => service.challenge(ada, { handle, rated: true, timeControl, color: 'random' })
  assert.equal(await refusal(() => to('bayo')), 'not_linked')
  await link(ada, 'Ada')
  assert.equal(await refusal(() => to('bayo')), 'opponent_not_linked')
  await link(bayo, 'Bayo')
  assert.equal(await refusal(() => to('ada')), 'self')
  assert.equal(await refusal(() => to('nobody')), 'not_found')
  assert.equal(await refusal(() => to('bayo', '1+0')), 'invalid', 'no Bullet')
  await db.insert(blocks).values({ blockerId: bayo, blockedId: ada })
  assert.equal(await refusal(() => to('bayo')), 'opponent_not_linked', 'a block reads like not having linked')
  await db.delete(blocks)
  gamesOff.add(bayo)
  assert.equal(await refusal(() => to('bayo')), 'opponent_not_linked')
  gamesOff.clear()
  const made = await to('bayo')
  assert.deepEqual([made.sent, made.status, made.speed, made.time, made.opponent.handle], [true, 'pending', 'rapid', '10+5', 'bayo'])
  assert.equal(await refusal(() => to('bayo')), 'duplicate', 'one open challenge per pair')
  assert.equal(lichess.calls.filter((c) => c.startsWith('create')).length, 0, 'nothing is made on Lichess until it is accepted')
})

test('the challenged member is notified, and the notification goes once the challenge is settled', async () => {
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  const made = await service.challenge(ada, { handle: 'bayo', rated: false, timeControl: '3d', color: 'white' })
  const [note] = (await notificationsService.list(bayo, 10)).notifications
  assert.equal(note!.kind, 'chess_challenge')
  assert.equal(note!.actor!.handle, 'ada')
  assert.deepEqual(note!.challenge, { id: made.id, phrase: 'a casual Correspondence game (3 days a move)' })
  // The challenged member plays the other colour.
  assert.equal((await service.overview(bayo)).incoming[0]!.color, 'black')
  await service.decline(bayo, made.id)
  assert.equal((await notificationsService.list(bayo, 10)).notifications.length, 0)
  assert.equal((await service.overview(ada)).recent[0]!.status, 'declined')
})

test('accepting makes the game on Lichess with the challenger’s token and accepts it with the other', async () => {
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  const made = await service.challenge(ada, { handle: 'bayo', rated: true, timeControl: '5+3', color: 'black' })
  const accepted = await service.accept(bayo, made.id)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.gameUrl, 'https://lichess.test/gm000001')
  assert.deepEqual(lichess.calls.slice(-2), [
    `create:tok-Ada->Bayo:${JSON.stringify({ rated: true, color: 'black', clockLimit: 300, clockIncrement: 3 })}`,
    'accept:tok-Bayo:gm000001',
  ])
  assert.equal(await refusal(() => service.accept(bayo, made.id)), 'not_found', 'only once')
  assert.equal(await refusal(() => service.decline(ada, made.id)), 'not_found')
})

test('if accepting fails on Lichess the challenge there is withdrawn and this one stays open', async () => {
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  const made = await service.challenge(ada, { handle: 'bayo', rated: true, timeControl: '10+0', color: 'random' })
  lichess.fail.accept = new LichessError('unavailable', 'down')
  assert.equal(await refusal(() => service.accept(bayo, made.id)), 'lichess_unavailable')
  assert.ok(lichess.calls.includes('cancel:tok-Ada:gm000001'))
  assert.equal((await service.overview(bayo)).incoming.length, 1)

  lichess.fail.accept = new LichessError('unauthorized', 'revoked')
  assert.equal(await refusal(() => service.accept(bayo, made.id)), 'reconnect')

  delete lichess.fail.accept
  lichess.fail.create = new LichessError('rate_limited', 'slow', 60_000)
  assert.equal(await refusal(() => service.accept(bayo, made.id)), 'lichess_busy')
})

test('a challenger whose Lichess link no longer works: the challenge fails and says why', async () => {
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  const made = await service.challenge(ada, { handle: 'bayo', rated: true, timeControl: '10+0', color: 'random' })
  lichess.fail.create = new LichessError('unauthorized', 'revoked')
  assert.equal(await refusal(() => service.accept(bayo, made.id)), 'lichess_rejected')
  const [row] = await db.select().from(chessChallenges)
  assert.equal(row!.status, 'failed')
})

test('only the challenger cancels, only the challenged member declines, and a challenge runs out unanswered', async () => {
  const now = new Date('2026-11-03T10:00:00Z')
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  const made = await service.challenge(ada, { handle: 'bayo', rated: true, timeControl: '10+0', color: 'random' }, now)
  assert.equal(await refusal(() => service.cancel(bayo, made.id, now)), 'not_found')
  assert.equal(await refusal(() => service.decline(ada, made.id, now)), 'not_found')

  const dayLater = new Date(now.getTime() + 24 * 3600_000 + 1)
  assert.equal((await service.overview(bayo, dayLater)).incoming.length, 0)
  assert.equal((await service.overview(ada, dayLater)).recent[0]!.status, 'expired')
  assert.equal(await refusal(() => service.accept(bayo, made.id, dayLater)), 'not_found')
  // And a new one can be sent in its place.
  await service.challenge(ada, { handle: 'bayo', rated: true, timeControl: '10+0', color: 'random' }, dayLater)
})

test('the scheduled refresh reads the stalest accounts in one call, and stops when Lichess asks it to', async () => {
  const now = new Date('2026-11-03T10:00:00Z')
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  await db.update(lichessAccounts).set({ ratingsRefreshedAt: new Date(now.getTime() - RATINGS_STALE_MS - 1) })
  lichess.fail.users = new LichessError('rate_limited', 'slow', 60_000)
  assert.equal(await service.refreshDue(now), 0)
  delete lichess.fail.users
  assert.equal(await service.refreshDue(now), 2)
  assert.ok(lichess.calls.some((c) => c === 'users:ada,bayo' || c === 'users:bayo,ada'))
  const rows = await db.select().from(lichessAccounts)
  assert.ok(rows.every((r) => r.ratings.blitz?.rating === 1600 && r.ratingsRefreshedAt?.getTime() === now.getTime()))
  assert.equal(await service.refreshDue(now), 0, 'nothing is due straight after')
})

test('a profile shows a member’s Lichess account to members who can see them', async () => {
  await link(ada, 'Ada')
  assert.equal(await service.memberAccount(bayo, 'chi'), null)
  const seen = await service.memberAccount(bayo, 'ada')
  assert.deepEqual([seen!.username, seen!.url, seen!.canChallenge], ['Ada', 'https://lichess.test/@/Ada', false])
  await link(bayo, 'Bayo')
  assert.equal((await service.memberAccount(bayo, 'ada'))!.canChallenge, true)
  await db.insert(blocks).values({ blockerId: ada, blockedId: bayo })
  assert.equal(await service.memberAccount(bayo, 'ada'), null)
  assert.deepEqual(await service.opponents(bayo, 'a'), [], 'nor in the picker')
})

test('the picker offers only members who have linked Lichess', async () => {
  await link(ada, 'Ada')
  await link(bayo, 'Bayo')
  assert.deepEqual((await service.opponents(chi, 'b')).map((m) => [m.handle, m.lichess]), [['bayo', 'Bayo']])
  assert.deepEqual(await service.opponents(ada, 'ad'), [], 'never yourself')
  gamesOff.add(bayo)
  assert.deepEqual(await service.opponents(chi, 'b'), [])
})

test('before an account is erased its token goes back to Lichess', async () => {
  await link(ada, 'Ada')
  await service.revokeFor(ada)
  assert.ok(lichess.calls.includes('revoke:tok-Ada'))
  await service.revokeFor(chi) // nobody linked: nothing to do
  assert.equal(lichess.calls.filter((c) => c.startsWith('revoke')).length, 1)
})
