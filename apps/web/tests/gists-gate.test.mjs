import assert from 'node:assert/strict'
import { test } from 'node:test'
import { meAllowsGists, sessionCookieHeader, gistsGate } from '../lib/gists-gate.ts'

const me = (status, body) => async () => ({ status, json: async () => body })

test('only a plain visible-ASCII session value becomes a Cookie header', () => {
  assert.equal(sessionCookieHeader('abc.DEF-123_xyz'), 'hn_session=abc.DEF-123_xyz')
  for (const bad of [undefined, '', '€', '\u0000', 'a b', 'a;b', 'a"b', 'é', 'a\nb']) assert.equal(sessionCookieHeader(bad), null, JSON.stringify(bad))
})

test('only a 200 with features.gists === true allows', () => {
  assert.equal(meAllowsGists(200, { features: { gists: true } }), true)
  for (const [status, body] of [
    [200, { features: { gists: false } }],
    [200, { features: { gists: 'true' } }],
    [200, { features: {} }],
    [200, {}],
    [200, null],
    [200, 'x'],
    [401, { features: { gists: true } }],
    [500, { features: { gists: true } }],
  ]) assert.equal(meAllowsGists(status, body), false, JSON.stringify([status, body]))
})

test('the gate fails closed: no session, a bad cookie, a refusal, a throw, a hang-up or non-JSON all deny', async () => {
  assert.equal(await gistsGate('good', me(200, { features: { gists: true } })), 'allow')
  assert.equal(await gistsGate(undefined, me(200, { features: { gists: true } })), 'deny')
  assert.equal(await gistsGate('€', me(200, { features: { gists: true } })), 'deny')
  assert.equal(await gistsGate('good', me(403, {})), 'deny')
  assert.equal(await gistsGate('good', async () => { throw new Error('ECONNREFUSED') }), 'deny')
  assert.equal(await gistsGate('good', async () => { throw new DOMException('timed out', 'TimeoutError') }), 'deny')
  assert.equal(await gistsGate('good', async () => ({ status: 200, json: async () => { throw new SyntaxError('not json') } })), 'deny')
})

test('the cookie sent to /v1/me is the one built from the session, never raw input', async () => {
  let sent
  await gistsGate('tok.en', async (cookie) => {
    sent = cookie
    return { status: 200, json: async () => ({ features: { gists: true } }) }
  })
  assert.equal(sent, 'hn_session=tok.en')
})
