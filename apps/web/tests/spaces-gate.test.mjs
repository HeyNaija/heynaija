import assert from 'node:assert/strict'
import { test } from 'node:test'
import { meAllowsSpaces, sessionCookieHeader, spacesGate } from '../lib/spaces-gate.ts'

const me = (status, body) => async () => ({ status, json: async () => body })

test('only a plain visible-ASCII session value becomes a Cookie header', () => {
  assert.equal(sessionCookieHeader('abc.DEF-123_xyz'), 'hn_session=abc.DEF-123_xyz')
  for (const bad of [undefined, '', '€', '\u0000', 'a b', 'a;b', 'a"b', 'é', 'a\nb']) assert.equal(sessionCookieHeader(bad), null, JSON.stringify(bad))
})

test('only a 200 with features.spaces === true allows', () => {
  assert.equal(meAllowsSpaces(200, { features: { spaces: true } }), true)
  for (const [status, body] of [
    [200, { features: { spaces: false } }],
    [200, { features: { spaces: 'true' } }],
    [200, { features: {} }],
    [200, {}],
    [200, null],
    [200, 'x'],
    [401, { features: { spaces: true } }],
    [500, { features: { spaces: true } }],
  ]) assert.equal(meAllowsSpaces(status, body), false, JSON.stringify([status, body]))
})

test('the gate fails closed: no session, a bad cookie, a refusal, a throw, a hang-up or non-JSON all deny', async () => {
  assert.equal(await spacesGate('good', me(200, { features: { spaces: true } })), 'allow')
  assert.equal(await spacesGate(undefined, me(200, { features: { spaces: true } })), 'deny')
  assert.equal(await spacesGate('€', me(200, { features: { spaces: true } })), 'deny')
  assert.equal(await spacesGate('good', me(403, {})), 'deny')
  assert.equal(await spacesGate('good', async () => { throw new Error('ECONNREFUSED') }), 'deny')
  assert.equal(await spacesGate('good', async () => { throw new DOMException('timed out', 'TimeoutError') }), 'deny')
  assert.equal(await spacesGate('good', async () => ({ status: 200, json: async () => { throw new SyntaxError('not json') } })), 'deny')
})

test('the cookie sent to /v1/me is the one built from the session, never raw input', async () => {
  let sent
  await spacesGate('tok.en', async (cookie) => {
    sent = cookie
    return { status: 200, json: async () => ({ features: { spaces: true } }) }
  })
  assert.equal(sent, 'hn_session=tok.en')
})
