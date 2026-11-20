import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gamesGate, gamesReturnPath, meAllowsGames } from '../lib/games-gate.ts'

const me = (status, body) => async () => ({ status, json: async () => body })

test('only a 200 with features.games === true allows', () => {
  assert.equal(meAllowsGames(200, { features: { games: true } }), true)
  for (const [status, body] of [
    [200, { features: { games: false } }],
    [200, { features: { games: 'true' } }],
    [200, { features: { gists: true } }],
    [200, {}],
    [200, null],
    [401, { features: { games: true } }],
    [500, { features: { games: true } }],
  ]) assert.equal(meAllowsGames(status, body), false, JSON.stringify([status, body]))
})

test('a member Games is not open to is told so, and an ended session signs in again', async () => {
  assert.equal(await gamesGate('good', me(200, { features: { games: true } })), 'allow')
  assert.equal(await gamesGate('good', me(200, { features: { games: false } })), 'not-open')
  assert.equal(await gamesGate('good', me(200, { features: { games: 'true' } })), 'not-open')
  assert.equal(await gamesGate('good', me(403, {})), 'not-open')
  assert.equal(await gamesGate('good', me(401, {})), 'sign-in')
})

test('the gate still fails closed: an error, a throw, a hang-up or non-JSON show nothing of Games', async () => {
  assert.equal(await gamesGate('good', me(500, { features: { games: true } })), 'unavailable')
  assert.equal(await gamesGate('good', async () => { throw new Error('ECONNREFUSED') }), 'unavailable')
  assert.equal(await gamesGate('good', async () => ({ status: 200, json: async () => { throw new SyntaxError('not json') } })), 'unavailable')
})

test('someone with no usable session is asked to sign in, without a lookup', async () => {
  const never = async () => assert.fail('a visitor with no usable session is not looked up')
  for (const session of [undefined, '', '€', 'a;b']) assert.equal(await gamesGate(session, never), 'sign-in')
})

test('only a Games address on this site is come back to after signing in', () => {
  for (const to of ['/games', '/games/chess', '/games/trivia/rounds/0b5f0c1e-6d0f-4a43-9b8e-1b9a2b3c4d5e', '/games/chess?tab=leaderboard', '/games?x=1']) {
    assert.equal(gamesReturnPath(to), to)
  }
  for (const to of [undefined, '', '/gamesx', '/game', '/p/abc', 'https://evil.example/games', '//evil.example/games', '/games//evil.example', '/games/\\evil', '/games/ü', `/games/${'a'.repeat(500)}`, ['/games']]) {
    assert.equal(gamesReturnPath(to), null, JSON.stringify(to))
  }
})
