import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type AgeRecord, ageOn, ageStatus, birthDateFrom, birthDateNeeded, isAdultFor, signupAgeDecision, UNKNOWN_AGE } from './age.js'

const now = new Date('2027-03-01T12:00:00Z')
const at = (iso: string) => new Date(iso)
const record = (over: Partial<AgeRecord>): AgeRecord => ({
  band: '18_plus',
  method: 'self_declared',
  birthDate: '1990-03-27',
  assuredAt: at('2026-10-20T00:00:00Z'),
  withdrawnAt: null,
  ...over,
})
// The old "I am 18 or older" box, from before signup asked for a date.
const ticked = record({ birthDate: null })

test('no record means an unknown age, never an adult', () => {
  assert.deepEqual(ageStatus([], now), UNKNOWN_AGE)
  assert.equal(isAdultFor(UNKNOWN_AGE, 'age_restricted_content'), false)
  assert.equal(isAdultFor(UNKNOWN_AGE, 'governance_vote'), false)
})

test('a date of birth the member gave makes a stated adult: enough for adult content, not for a vote', () => {
  const status = ageStatus([record({})], now)
  assert.deepEqual(status, { band: '18_plus', assurance: 'declared' })
  assert.equal(isAdultFor(status, 'age_restricted_content'), true)
  assert.equal(isAdultFor(status, 'governance_vote'), false)
})

test('a stated adult age hosts and speaks in Gists and posts video; under 18 and unknown do neither', () => {
  const adult = ageStatus([record({})], now)
  const minor = ageStatus([record({ band: 'under_18', birthDate: '2012-05-01' })], now)
  for (const purpose of ['gist_stage', 'video_posting'] as const) {
    assert.equal(isAdultFor(adult, purpose), true, purpose)
    assert.equal(isAdultFor(minor, purpose), false, purpose)
    assert.equal(isAdultFor(UNKNOWN_AGE, purpose), false, purpose)
    assert.equal(isAdultFor(ageStatus([ticked], now), purpose), false, purpose)
  }
})

test('the old "18 or older" box counts for nothing, and its owner is asked for a date', () => {
  assert.deepEqual(ageStatus([ticked], now), UNKNOWN_AGE)
  assert.equal(birthDateNeeded([]), true)
  assert.equal(birthDateNeeded([ticked]), true)
  assert.equal(birthDateNeeded([record({ withdrawnAt: at('2026-12-01T00:00:00Z') })]), true)
  assert.equal(birthDateNeeded([record({})]), false)
  assert.equal(birthDateNeeded([{ ...ticked, withdrawnAt: at('2026-12-01T00:00:00Z') }, record({})]), false)
})

test('the band comes from the date, worked out today, so a minor is an adult from their 18th birthday in Lagos', () => {
  // The band stored when they gave it is not what counts.
  const minor = record({ band: 'under_18', birthDate: '2009-03-01' })
  assert.deepEqual(ageStatus([minor], now), { band: '18_plus', assurance: 'declared' })
  assert.equal(ageStatus([minor], at('2027-02-28T22:30:00Z')).band, 'under_18')
  assert.equal(ageStatus([minor], at('2027-02-28T23:30:00Z')).band, '18_plus')
})

test('a verified adult age counts for everything', () => {
  const status = ageStatus([record({}), record({ method: 'identity_provider', birthDate: null, assuredAt: at('2026-12-01T00:00:00Z') })], now)
  assert.deepEqual(status, { band: '18_plus', assurance: 'verified' })
  assert.equal(isAdultFor(status, 'governance_vote'), true)
})

test("a moderator's corrected date overrides the member's own", () => {
  const status = ageStatus([record({}), record({ method: 'moderator_review', birthDate: '2012-05-01', assuredAt: at('2026-11-01T00:00:00Z') })], now)
  assert.equal(status.band, 'under_18')
  assert.equal(isAdultFor(status, 'age_restricted_content'), false)
})

test('a verified check outranks a moderator, whichever came first', () => {
  const verifiedAdult = record({ method: 'age_assurance_provider', birthDate: null, assuredAt: at('2026-10-25T00:00:00Z') })
  const moderatorMinor = record({ method: 'moderator_review', birthDate: '2012-05-01', assuredAt: at('2026-11-01T00:00:00Z') })
  assert.equal(ageStatus([verifiedAdult, moderatorMinor], now).band, '18_plus')
  // And a verified under-18 result outranks a stated adult age.
  assert.equal(ageStatus([record({}), record({ band: 'under_18', method: 'identity_provider', birthDate: null })], now).band, 'under_18')
})

test('withdrawn records count for nothing', () => {
  const withdrawn = record({ method: 'identity_provider', birthDate: null, withdrawnAt: at('2026-12-01T00:00:00Z') })
  assert.deepEqual(ageStatus([withdrawn], now), UNKNOWN_AGE)
  assert.equal(ageStatus([record({}), withdrawn], now).assurance, 'declared')
})

test('between equally strong records the newest wins', () => {
  const older = record({ method: 'moderator_review', birthDate: '2012-05-01', assuredAt: at('2026-11-01T00:00:00Z') })
  const newer = record({ method: 'moderator_review', birthDate: '1995-05-01', assuredAt: at('2026-12-01T00:00:00Z') })
  assert.equal(ageStatus([older, newer], now).band, '18_plus')
  assert.equal(ageStatus([newer, older], now).band, '18_plus')
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
  assert.deepEqual(signupAgeDecision('1990-03-27', now, false), { allowed: true, birthDate: '1990-03-27' })
  assert.deepEqual(signupAgeDecision('2009-03-01', now, false), { allowed: true, birthDate: '2009-03-01' })
  assert.deepEqual(signupAgeDecision('2014-03-01', now, true), { allowed: true, birthDate: '2014-03-01' })
  assert.deepEqual(signupAgeDecision('2009-03-02', now, false), { allowed: false, reason: 'under_18_not_open' })
  assert.deepEqual(signupAgeDecision('2014-03-02', now, true), { allowed: false, reason: 'below_minimum_age' })
  assert.deepEqual(signupAgeDecision('2014-03-02', now, false), { allowed: false, reason: 'below_minimum_age' })
  assert.deepEqual(signupAgeDecision(null, now, true), { allowed: false, reason: 'age_not_confirmed' })
  assert.deepEqual(signupAgeDecision('2027-03-02', now, true), { allowed: false, reason: 'age_not_confirmed' })
})
