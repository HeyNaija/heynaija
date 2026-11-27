import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gamesGate, meAllowsGames } from '../lib/games-gate.ts'

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

test('the gate fails closed: a refusal, a throw, a hang-up or non-JSON all deny', async () => {
  assert.equal(await gamesGate('good', me(200, { features: { games: true } })), 'allow')
  assert.equal(await gamesGate('good', me(200, { features: { games: false } })), 'deny')
  assert.equal(await gamesGate('good', me(401, {})), 'deny')
  assert.equal(await gamesGate('good', me(403, {})), 'deny')
  assert.equal(await gamesGate('good', async () => { throw new Error('ECONNREFUSED') }), 'deny')
  assert.equal(await gamesGate('good', async () => ({ status: 200, json: async () => { throw new SyntaxError('not json') } })), 'deny')
})

test('someone with no usable session gets the missing page without a lookup', async () => {
  const never = async () => assert.fail('a visitor with no usable session is not looked up')
  for (const session of [undefined, '', '€', 'a;b']) assert.equal(await gamesGate(session, never), 'deny')
})
