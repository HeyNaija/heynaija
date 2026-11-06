import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type AgeRecord, ageOn, ageStatus, birthDateFrom, isAdultFor, signupAgeDecision, UNKNOWN_AGE } from './age.js'

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

test('an age is whole years on the day in Lagos', () => {
  // 1 March 2027, 12:00 in Lagos.
  assert.equal(ageOn('2009-03-01', now), 18)
  assert.equal(ageOn('2009-03-02', now), 17)
  // 23:30 UTC on 28 February is already 1 March in Lagos.
  assert.equal(ageOn('2009-03-01', at('2027-02-28T23:30:00Z')), 18)
  assert.equal(ageOn('2009-03-01', at('2027-02-28T22:30:00Z')), 17)
  // Born on 29 February: a year older on 1 March when there is no 29th.
  assert.equal(ageOn('2008-02-29', at('2026-02-28T12:00:00Z')), 17)
  assert.equal(ageOn('2008-02-29', at('2026-03-01T12:00:00Z')), 18)
})

test('only a real date that could be a birthday counts as one', () => {
  assert.equal(birthDateFrom('1990-03-27', now), '1990-03-27')
  for (const text of ['', '1990-3-27', '27-03-1990', '1990-02-30', '2027-03-02', '1900-01-01', '1990-03-27T00:00']) {
    assert.equal(birthDateFrom(text, now), null, text)
  }
})

test('nobody under 13 may sign up, and 13 to 17 only once under-18 accounts are open', () => {
  assert.deepEqual(signupAgeDecision('1990-03-27', now, false), { allowed: true, band: '18_plus', birthDate: '1990-03-27', reviewAfter: null })
  assert.deepEqual(signupAgeDecision('2009-03-01', now, false), { allowed: true, band: '18_plus', birthDate: '2009-03-01', reviewAfter: null })
  assert.deepEqual(signupAgeDecision('2009-03-02', now, false), { allowed: false, reason: 'under_18_not_open' })
  assert.deepEqual(signupAgeDecision('2014-03-02', now, true), { allowed: false, reason: 'below_minimum_age' })
  assert.deepEqual(signupAgeDecision('2014-03-02', now, false), { allowed: false, reason: 'below_minimum_age' })
  assert.deepEqual(signupAgeDecision(null, now, true), { allowed: false, reason: 'age_not_confirmed' })
  assert.deepEqual(signupAgeDecision('2027-03-02', now, true), { allowed: false, reason: 'age_not_confirmed' })
})

test('a minor is checked again from the start of their 18th birthday in Lagos', () => {
  const minor = signupAgeDecision('2014-03-01', now, true)
  assert.deepEqual(minor, { allowed: true, band: 'under_18', birthDate: '2014-03-01', reviewAfter: at('2032-02-29T23:00:00Z') })
  const leap = signupAgeDecision('2012-02-29', now, true)
  assert.ok(leap.allowed)
  assert.deepEqual(leap.reviewAfter, at('2030-02-28T23:00:00Z'))
})
