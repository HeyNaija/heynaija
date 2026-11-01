import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gistReturnPath, meAllowsGists, sessionCookieHeader, gistsGate } from '../lib/gists-gate.ts'

const me = (status, body) => async () => ({ status, json: async () => body })
// What a Gists route answers a caller with no session: 401 while Gists are on, 404 while off.
const on = async () => ({ status: 401 })
const off = async () => ({ status: 404 })

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

test('the gate fails closed: a refusal, a throw, a hang-up or non-JSON all deny', async () => {
  assert.equal(await gistsGate('good', me(200, { features: { gists: true } }), on), 'allow')
  assert.equal(await gistsGate('good', me(200, { features: { gists: false } }), on), 'deny')
  assert.equal(await gistsGate('good', me(403, {}), on), 'deny')
  assert.equal(await gistsGate('good', async () => { throw new Error('ECONNREFUSED') }, on), 'deny')
  assert.equal(await gistsGate('good', async () => { throw new DOMException('timed out', 'TimeoutError') }, on), 'deny')
  assert.equal(await gistsGate('good', async () => ({ status: 200, json: async () => { throw new SyntaxError('not json') } }), on), 'deny')
})

test('someone with no session is asked to sign in while Gists are on, and sees a missing page while they are off', async () => {
  const never = async () => assert.fail('a visitor with no usable session is not looked up')
  for (const session of [undefined, '', '€']) {
    assert.equal(await gistsGate(session, never, on), 'sign-in', JSON.stringify(session))
    assert.equal(await gistsGate(session, never, off), 'deny', JSON.stringify(session))
  }
  // A session the API no longer knows is the same as none.
  assert.equal(await gistsGate('ended', me(401, {}), on), 'sign-in')
  assert.equal(await gistsGate('ended', me(401, {}), off), 'deny')
  // Anything but a clear 401 from the switch check is a no.
  for (const answer of [async () => ({ status: 200 }), async () => ({ status: 500 }), async () => { throw new Error('ECONNREFUSED') }]) {
    assert.equal(await gistsGate(undefined, never, answer), 'deny')
  }
})

test('only a Gist address is returned to after signing in', () => {
  for (const path of ['/gists/0b8e5f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f', '/gists/0B8E5F4C-1D2A-4C3B-9E8F-7A6B5C4D3E2F']) assert.equal(gistReturnPath(path), path)
  for (const bad of [
    undefined, ['/gists/0b8e5f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f'], '', '/gists', '/gists/', '/gists/new', '/gists/abc',
    '/gists/0b8e5f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f/x', '/gists/0b8e5f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f?x',
    '//evil.test/gists/0b8e5f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f', 'https://evil.test/gists/0b8e5f4c-1d2a-4c3b-9e8f-7a6b5c4d3e2f', '/p/abc',
  ]) assert.equal(gistReturnPath(bad), null, JSON.stringify(bad))
})

test('the cookie sent to /v1/me is the one built from the session, never raw input', async () => {
  let sent
  await gistsGate('tok.en', async (cookie) => {
    sent = cookie
    return { status: 200, json: async () => ({ features: { gists: true } }) }
  }, on)
  assert.equal(sent, 'hn_session=tok.en')
})
