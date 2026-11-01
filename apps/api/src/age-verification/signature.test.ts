import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyDiditSignature } from './signature.js'

// A delivery signed the way https://docs.didit.me/integration/webhooks documents
// X-Signature-V2: HMAC-SHA256 (hex) of the body with sorted keys, compact
// separators, Unicode kept and whole-valued floats written as ints. The body and
// both signatures were produced with the documented Python sample
// (json.dumps(shorten_floats(body), sort_keys=True, separators=(',', ':'), ensure_ascii=False)),
// not with the code under test. Note "score": 85.0 and the "é".
const RAW = `{"webhook_type":"status.updated","session_id":"11111111-2222-3333-4444-555555555555","status":"Approved","created_at":1774969994,"timestamp":1774970000,"vendor_data":"member-1","metadata":{"note":"José","score":85.0,"ratio":0.5},"decision":{"features":["ID_VERIFICATION"],"id_verifications":[{"node_id":"n1","status":"Approved","verification_method":"document"}]}}`
const SECRET = 'whsec_test_secret'
const SIGNATURE = 'b4fde3474c63bb91dde3f2b08be508a2daa7f35c8de2fe4af8bf27a966dfb074'
const OLD_SECRET = 'whsec_old_secret'
const OLD_SECRET_SIGNATURE = '5790358c702e5d6fd317827e1a8e0f57d511be76a3fac3038238e9161b219724'
const SENT_AT = 1_774_970_000
const now = (offsetS = 0) => (SENT_AT + offsetS) * 1000

type Headers = Record<string, string | string[] | undefined>
const body = () => JSON.parse(RAW) as unknown
const headers = (extra: Headers = {}): Headers => ({ 'x-signature-v2': SIGNATURE, 'x-timestamp': String(SENT_AT), ...extra })
const check = (over: Partial<Parameters<typeof verifyDiditSignature>[0]> = {}) =>
  verifyDiditSignature({ body: body(), headers: headers(), secret: SECRET, nowMs: now(), ...over })

test('a delivery signed as documented verifies, including Unicode and whole-valued floats', () => {
  assert.deepEqual(check(), { ok: true })
})

test('a body changed after signing is refused, decision included', () => {
  const tampered = body() as { status: string }
  tampered.status = 'Declined'
  assert.deepEqual(check({ body: tampered }), { ok: false, reason: 'bad_signature' })
  const inner = body() as { decision: { id_verifications: { status: string }[] } }
  inner.decision.id_verifications[0]!.status = 'Declined'
  assert.deepEqual(check({ body: inner }), { ok: false, reason: 'bad_signature' })
})

test('the wrong secret, a missing signature and a malformed one are refused', () => {
  assert.deepEqual(check({ secret: 'whsec_other' }), { ok: false, reason: 'bad_signature' })
  assert.deepEqual(check({ headers: { 'x-timestamp': String(SENT_AT) } }), { ok: false, reason: 'missing_signature' })
  assert.deepEqual(check({ headers: headers({ 'x-signature-v2': '' }) }), { ok: false, reason: 'missing_signature' })
  assert.deepEqual(check({ headers: headers({ 'x-signature-v2': 'abc' }) }), { ok: false, reason: 'bad_signature' })
  assert.deepEqual(check({ headers: headers({ 'x-signature-v2': ['a', 'b'] }) }), { ok: false, reason: 'bad_signature' })
})

test('only X-Signature-V2 counts: X-Signature and X-Signature-Simple alone are refused', () => {
  const only = { 'x-timestamp': String(SENT_AT) }
  assert.deepEqual(check({ headers: { ...only, 'x-signature': SIGNATURE } }), { ok: false, reason: 'missing_signature' })
  assert.deepEqual(check({ headers: { ...only, 'x-signature-simple': SIGNATURE } }), { ok: false, reason: 'missing_signature' })
})

test('a replay outside five minutes is refused, in either direction; inside it passes', () => {
  assert.deepEqual(check({ nowMs: now(301) }), { ok: false, reason: 'stale' })
  assert.deepEqual(check({ nowMs: now(-301) }), { ok: false, reason: 'stale' })
  assert.deepEqual(check({ nowMs: now(300) }), { ok: true })
  assert.deepEqual(check({ nowMs: now(-300) }), { ok: true })
})

test('a missing or non-numeric timestamp is refused', () => {
  assert.deepEqual(check({ headers: { 'x-signature-v2': SIGNATURE } }), { ok: false, reason: 'bad_timestamp' })
  assert.deepEqual(check({ headers: headers({ 'x-timestamp': 'soon' }) }), { ok: false, reason: 'bad_timestamp' })
  assert.deepEqual(check({ headers: headers({ 'x-timestamp': '1774970000abc' }) }), { ok: false, reason: 'bad_timestamp' })
})

test('an old signed body replayed with a fresh X-Timestamp is refused: the body timestamp must match the header', () => {
  // X-Timestamp is not part of the signature, so an attacker can change it freely. The body's own
  // timestamp is signed, and must equal the header.
  const fresh = headers({ 'x-timestamp': String(SENT_AT + 3600) })
  assert.deepEqual(check({ headers: fresh, nowMs: now(3600) }), { ok: false, reason: 'bad_timestamp' })
  assert.deepEqual(check({ headers: headers({ 'x-timestamp': String(SENT_AT + 1) }) }), { ok: false, reason: 'bad_timestamp' })
})

test('a body without a numeric timestamp is refused', () => {
  const without = body() as Record<string, unknown>
  delete without.timestamp
  assert.deepEqual(check({ body: without }), { ok: false, reason: 'bad_timestamp' })
  assert.deepEqual(check({ body: { ...without, timestamp: String(SENT_AT) } }), { ok: false, reason: 'bad_timestamp' })
  assert.deepEqual(check({ body: null }), { ok: false, reason: 'bad_timestamp' })
})

test('during a secret rotation either secret verifies: the main header has the new one, -Previous the old one', () => {
  // The body was signed with SECRET (new); -Previous carries the signature made with OLD_SECRET.
  const rotating = headers({ 'x-signature-v2-previous': OLD_SECRET_SIGNATURE })
  assert.deepEqual(check({ secret: SECRET, headers: rotating }), { ok: true })
  assert.deepEqual(check({ secret: OLD_SECRET, headers: rotating }), { ok: true })
  assert.deepEqual(check({ secret: 'whsec_other', headers: rotating }), { ok: false, reason: 'bad_signature' })
  // And a stale one is still stale.
  assert.deepEqual(check({ secret: OLD_SECRET, headers: rotating, nowMs: now(400) }), { ok: false, reason: 'stale' })
})
