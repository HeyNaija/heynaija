import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type AgeRecord, ageStatus, isAdultFor, signupAgeDecision, UNKNOWN_AGE } from './age.js'

const now = new Date('2027-03-01T12:00:00Z')
const at = (iso: string) => new Date(iso)
const record = (over: Partial<AgeRecord>): AgeRecord => ({
  band: '18_plus',
  method: 'self_declared',
  assuredAt: at('2026-10-20T00:00:00Z'),
  reviewAfter: null,
  withdrawnAt: null,
  ...over,
})

test('no record means an unknown age, never an adult', () => {
  assert.deepEqual(ageStatus([], now), UNKNOWN_AGE)
  assert.equal(isAdultFor(UNKNOWN_AGE, 'age_restricted_content'), false)
  assert.equal(isAdultFor(UNKNOWN_AGE, 'governance_vote'), false)
})

test('a signup declaration makes a stated adult: enough for adult content, not for a vote', () => {
  const status = ageStatus([record({})], now)
  assert.deepEqual(status, { band: '18_plus', assurance: 'declared', reviewDue: false })
  assert.equal(isAdultFor(status, 'age_restricted_content'), true)
  assert.equal(isAdultFor(status, 'governance_vote'), false)
})

test('a verified adult age counts for everything', () => {
  const status = ageStatus([record({}), record({ method: 'identity_provider', assuredAt: at('2026-12-01T00:00:00Z') })], now)
  assert.deepEqual(status, { band: '18_plus', assurance: 'verified', reviewDue: false })
  assert.equal(isAdultFor(status, 'governance_vote'), true)
})

test('a moderator finding of under 18 overrides a self-declared adult', () => {
  const status = ageStatus([record({}), record({ band: 'under_18', method: 'moderator_review', assuredAt: at('2026-11-01T00:00:00Z') })], now)
  assert.equal(status.band, 'under_18')
  assert.equal(isAdultFor(status, 'age_restricted_content'), false)
})

test('a verified check outranks a moderator, whichever came first', () => {
  const verifiedAdult = record({ method: 'age_assurance_provider', assuredAt: at('2026-10-25T00:00:00Z') })
  const moderatorMinor = record({ band: 'under_18', method: 'moderator_review', assuredAt: at('2026-11-01T00:00:00Z') })
  assert.equal(ageStatus([verifiedAdult, moderatorMinor], now).band, '18_plus')
  // And a verified under-18 result outranks a stated adult age.
  assert.equal(ageStatus([record({}), record({ band: 'under_18', method: 'identity_provider' })], now).band, 'under_18')
})

test('withdrawn statements count for nothing', () => {
  const withdrawn = record({ method: 'identity_provider', withdrawnAt: at('2026-12-01T00:00:00Z') })
  assert.deepEqual(ageStatus([withdrawn], now), UNKNOWN_AGE)
  assert.equal(ageStatus([record({}), withdrawn], now).assurance, 'declared')
})

test('between equally strong statements the newest wins', () => {
  const older = record({ band: 'under_18', method: 'moderator_review', assuredAt: at('2026-11-01T00:00:00Z') })
  const newer = record({ band: '18_plus', method: 'moderator_review', assuredAt: at('2026-12-01T00:00:00Z') })
  assert.equal(ageStatus([older, newer], now).band, '18_plus')
  assert.equal(ageStatus([newer, older], now).band, '18_plus')
})

test('an under-18 band past its review date asks to be checked again, and stays under 18 until it is', () => {
  const status = ageStatus([record({ band: 'under_18', method: 'identity_provider', reviewAfter: at('2027-02-01T00:00:00Z') })], now)
  assert.deepEqual(status, { band: 'under_18', assurance: 'verified', reviewDue: true })
  assert.equal(isAdultFor(status, 'age_restricted_content'), false)
})

test('during the beta only a stated adult may sign up', () => {
  assert.deepEqual(signupAgeDecision('adult'), { allowed: true })
  assert.deepEqual(signupAgeDecision(null), { allowed: false, reason: 'age_not_confirmed' })
  assert.deepEqual(signupAgeDecision('under_18'), { allowed: false, reason: 'under_18_not_open' })
})
