import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type StoredVerification, type VerificationStatus, methodFromDecision, sessionAction, statusFromDidit, transition } from './state.js'

const NOW = new Date('2026-11-01T10:00:00Z')
const SESSION = 'sess-1'
const row = (status: VerificationStatus, over: Partial<StoredVerification> = {}): StoredVerification => ({
  status,
  diditSessionId: SESSION,
  method: null,
  verifiedAt: status === 'verified' ? new Date('2026-10-31T10:00:00Z') : null,
  ...over,
})
const event = (status: string, over: { sessionId?: string; method?: string } = {}) => ({ sessionId: SESSION, status, ...over })

test('Didit statuses map to ours; statuses that are not an outcome map to nothing', () => {
  assert.equal(statusFromDidit('Approved'), 'verified')
  assert.equal(statusFromDidit('Declined'), 'declined')
  assert.equal(statusFromDidit('In Review'), 'in_review')
  assert.equal(statusFromDidit('Expired'), 'expired')
  assert.equal(statusFromDidit('Kyc Expired'), 'expired')
  assert.equal(statusFromDidit('Abandoned'), 'expired')
  for (const s of ['Not Started', 'In Progress', 'Resubmitted', 'Awaiting User', 'approved', 'APPROVED', '', 'Something New']) {
    assert.equal(statusFromDidit(s), null, s)
  }
})

test('an approval sets verified, the method and the date', () => {
  assert.deepEqual(transition(row('pending'), event('Approved', { method: 'document' }), NOW), {
    change: 'update',
    status: 'verified',
    method: 'document',
    verifiedAt: NOW,
  })
  assert.equal(transition(row('in_review'), event('Approved'), NOW).change, 'update')
})

test('declined and expired are recorded, with no method and no date', () => {
  assert.deepEqual(transition(row('pending'), event('Declined'), NOW), { change: 'update', status: 'declined', method: null, verifiedAt: null })
  assert.deepEqual(transition(row('in_review'), event('Expired'), NOW), { change: 'update', status: 'expired', method: null, verifiedAt: null })
})

test('a reviewer approving a declined or expired session later is honoured', () => {
  assert.equal(transition(row('declined'), event('Approved'), NOW).change, 'update')
  assert.equal(transition(row('expired'), event('Approved'), NOW).change, 'update')
})

test('a reviewer reversing an approval withdraws verified', () => {
  assert.deepEqual(transition(row('verified', { method: 'document' }), event('Declined'), NOW), {
    change: 'update',
    status: 'declined',
    method: null,
    verifiedAt: null,
  })
})

test('an older event never moves a result backwards', () => {
  assert.equal(transition(row('verified'), event('In Review'), NOW).change, 'none')
  assert.equal(transition(row('verified'), event('Expired'), NOW).change, 'none')
  assert.equal(transition(row('declined'), event('In Review'), NOW).change, 'none')
  assert.equal(transition(row('expired'), event('Declined'), NOW).change, 'none')
  assert.equal(transition(row('in_review'), event('In Progress'), NOW).change, 'none')
})

test('a repeat of the same outcome changes nothing, and keeps the first verified date', () => {
  assert.equal(transition(row('verified'), event('Approved'), NOW).change, 'none')
  assert.equal(transition(row('declined'), event('Declined'), NOW).change, 'none')
  assert.equal(transition(row('in_review'), event('In Review'), NOW).change, 'none')
})

test('an event for a session we did not start, or for nobody, is ignored', () => {
  assert.equal(transition(row('pending'), event('Approved', { sessionId: 'someone-elses' }), NOW).change, 'none')
  assert.equal(transition(undefined, event('Approved'), NOW).change, 'none')
})

test('a stored row can never be verified without a date, and a method comes only with an approval', () => {
  const approved = transition(row('pending'), event('Approved'), NOW)
  assert.equal(approved.change === 'update' && approved.method, 'didit')
  const declined = transition(row('pending'), event('Declined', { method: 'document' }), NOW)
  assert.equal(declined.change === 'update' && declined.method, null)
})

test('an approval flagged as a duplicate is recorded as declined', () => {
  assert.deepEqual(transition(row('pending'), { ...event('Approved'), duplicate: true }, NOW), {
    change: 'update',
    status: 'declined',
    method: null,
    verifiedAt: null,
  })
  // And it withdraws a verified result the same way.
  assert.equal(transition(row('verified'), { ...event('Approved'), duplicate: true }, NOW).change, 'update')
  // A duplicate flag on something that is not an approval changes nothing about it.
  assert.deepEqual(transition(row('pending'), { ...event('Declined'), duplicate: true }, NOW), { change: 'update', status: 'declined', method: null, verifiedAt: null })
})

test('starting a session: verified members are done, an open session is resumed, a finished miss starts afresh', () => {
  assert.equal(sessionAction(undefined), 'start')
  assert.equal(sessionAction(row('verified')), 'already_verified')
  assert.equal(sessionAction(row('pending')), 'start') // Didit returns the open session for the same member
  assert.equal(sessionAction(row('in_review')), 'in_review')
  assert.equal(sessionAction(row('declined')), 'start')
  assert.equal(sessionAction(row('expired')), 'start')
})

test('the method comes from what the decision ran, and nothing else of it is kept', () => {
  assert.equal(methodFromDecision({ id_verifications: [{ status: 'Approved' }] }), 'document')
  assert.equal(methodFromDecision({ id_verifications: [], features: ['AGE_ESTIMATION'] }), 'age_estimation')
  assert.equal(methodFromDecision({ features: ['LIVENESS', 'AGE_ESTIMATION'] }), 'age_estimation')
  assert.equal(methodFromDecision({}), 'didit')
  assert.equal(methodFromDecision(null), 'didit')
  assert.equal(methodFromDecision('nonsense'), 'didit')
})
