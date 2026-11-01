import assert from 'node:assert/strict'
import { test } from 'node:test'
import { documentFromDecision, documentPersonKey, normaliseDocumentNumber } from './person-key.js'

const SECRET = 'p'.repeat(32)

test('a document number is normalised: upper case, spaces and punctuation gone', () => {
  assert.equal(normaliseDocumentNumber('a12 345-67/8'), 'A12345678')
  assert.equal(normaliseDocumentNumber(' A12.345,678 '), 'A12345678')
  assert.equal(normaliseDocumentNumber('a12345678'), 'A12345678')
  assert.equal(normaliseDocumentNumber('---'), '')
})

test('case and spacing of the same number, in the same country, give one key', () => {
  const a = documentPersonKey(SECRET, { issuingState: 'NGA', number: 'a12 345-678' })
  const b = documentPersonKey(SECRET, { issuingState: 'nga', number: 'A12345678' })
  assert.ok(a)
  assert.equal(a, b)
})

test('another number, another country or another secret gives another key', () => {
  const base = documentPersonKey(SECRET, { issuingState: 'NGA', number: 'A12345678' })
  assert.notEqual(base, documentPersonKey(SECRET, { issuingState: 'NGA', number: 'A12345679' }))
  assert.notEqual(base, documentPersonKey(SECRET, { issuingState: 'GHA', number: 'A12345678' }))
  assert.notEqual(base, documentPersonKey('q'.repeat(32), { issuingState: 'NGA', number: 'A12345678' }))
})

test('the key is a keyed digest, not the number or a plain hash of it', () => {
  const key = documentPersonKey(SECRET, { issuingState: 'NGA', number: 'A12345678' }) ?? ''
  assert.doesNotMatch(key, /A12345678/i)
  assert.match(key, /^[A-Za-z0-9_-]{43}$/) // HMAC-SHA256, base64url
})

test('no usable number or country, or no secret, gives no key', () => {
  assert.equal(documentPersonKey(SECRET, null), null)
  assert.equal(documentPersonKey(SECRET, { issuingState: 'NGA', number: '-- --' }), null)
  assert.equal(documentPersonKey(SECRET, { issuingState: '', number: 'A1' }), null)
  assert.throws(() => documentPersonKey('short', { issuingState: 'NGA', number: 'A1' }))
})

test('the document is read from id_verifications[].document_number and .issuing_state (docs.didit.me retrieve-session)', () => {
  assert.deepEqual(documentFromDecision({ id_verifications: [{ status: 'Approved', document_number: 'CAA000000', issuing_state: 'ESP', personal_number: '99999999R' }] }), {
    issuingState: 'ESP',
    number: 'CAA000000',
  })
  // The first approved one; a declined attempt's number is not the member's.
  assert.deepEqual(
    documentFromDecision({
      id_verifications: [
        { status: 'Declined', document_number: 'BAD1', issuing_state: 'NGA' },
        { status: 'Approved', document_number: 'GOOD1', issuing_state: 'NGA' },
      ],
    }),
    { issuingState: 'NGA', number: 'GOOD1' },
  )
})

test('a decision with no document check, or without a number or state, gives none', () => {
  assert.equal(documentFromDecision({ features: ['AGE_ESTIMATION'] }), null)
  assert.equal(documentFromDecision({ id_verifications: [] }), null)
  assert.equal(documentFromDecision({ id_verifications: [{ status: 'Approved', document_number: null, issuing_state: 'NGA' }] }), null)
  assert.equal(documentFromDecision({ id_verifications: [{ status: 'Approved', document_number: 'A1' }] }), null)
  assert.equal(documentFromDecision({ id_verifications: [{ status: 'Approved', document_number: 12345, issuing_state: 'NGA' }] }), null)
  assert.equal(documentFromDecision(null), null)
  assert.equal(documentFromDecision('x'), null)
})
