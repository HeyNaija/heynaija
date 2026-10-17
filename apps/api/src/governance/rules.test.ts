import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type AgeStatus, UNKNOWN_AGE } from './age.js'
import {
  badgeAllowed,
  ballotEligibility,
  bindingBallotMayOpen,
  derivePersonKey,
  effectiveVerificationStatus,
  type GovernanceFlags,
  type MembershipFacts,
  membershipEligibility,
  PROPOSED_RULES,
  type VerificationFacts,
} from './rules.js'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2027-03-01T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY)
const daysAhead = (n: number) => new Date(now.getTime() + n * DAY)

// What the environment allows today: everything off.
const today: GovernanceFlags = {
  NIN_VERIFICATION_ENABLED: false,
  BINDING_GOVERNANCE_VOTING_ENABLED: false,
  UNDER_18_ACCOUNTS_ENABLED: false,
}
// A hypothetical future where verification and voting were approved.
const approved: GovernanceFlags = { ...today, NIN_VERIFICATION_ENABLED: true, BINDING_GOVERNANCE_VOTING_ENABLED: true }

const verified = (over: Partial<VerificationFacts> = {}): VerificationFacts => ({
  status: 'verified',
  verifiedAt: daysAgo(40),
  expiresAt: daysAhead(300),
  reviewedAt: daysAgo(39),
  personKey: 'key',
  ...over,
})
const verifiedAdult: AgeStatus = { band: '18_plus', assurance: 'verified', reviewDue: false }
const activeMember: MembershipFacts = { status: 'active', optedInAt: daysAgo(35), suspendedUntil: null }

test('a verified record past its expiry counts as expired', () => {
  assert.equal(effectiveVerificationStatus(null, now), 'none')
  assert.equal(effectiveVerificationStatus(verified(), now), 'verified')
  assert.equal(effectiveVerificationStatus(verified({ expiresAt: daysAgo(1) }), now), 'expired')
  assert.equal(effectiveVerificationStatus(verified({ status: 'revoked' }), now), 'revoked')
})

test('no green tick while NIN verification is switched off, whatever the record says', () => {
  assert.equal(badgeAllowed(today, verified(), now), false)
})

test('the green tick needs a current, reviewed verification', () => {
  assert.equal(badgeAllowed(approved, verified(), now), true)
  assert.equal(badgeAllowed(approved, null, now), false)
  assert.equal(badgeAllowed(approved, verified({ reviewedAt: null }), now), false)
  assert.equal(badgeAllowed(approved, verified({ expiresAt: daysAgo(1) }), now), false)
  for (const status of ['pending', 'rejected', 'revoked', 'expired'] as const) {
    assert.equal(badgeAllowed(approved, verified({ status }), now), false, status)
  }
})

test('nobody can be a voting member while registration is closed', () => {
  const result = membershipEligibility({ flags: today, verification: verified(), age: verifiedAdult, membership: activeMember, now })
  assert.deepEqual(result, { eligible: false, unmet: ['registration_closed'] })
})

test('a fresh account lists every missing condition', () => {
  const result = membershipEligibility({ flags: today, verification: null, age: UNKNOWN_AGE, membership: null, now })
  assert.deepEqual(result.unmet, ['registration_closed', 'not_verified', 'age_not_verified', 'not_opted_in'])
})

test('verifying alone does not make someone a member: they must opt in', () => {
  const result = membershipEligibility({ flags: approved, verification: verified(), age: verifiedAdult, membership: null, now })
  assert.deepEqual(result, { eligible: false, unmet: ['not_opted_in'] })
})

test('voting membership needs a verified adult age, kept apart from the identity check', () => {
  const check = (age: AgeStatus) =>
    membershipEligibility({ flags: approved, verification: verified(), age, membership: activeMember, now }).unmet
  assert.deepEqual(check(verifiedAdult), [])
  // Unknown (an older account), a stated adult age, a moderator's view, or a minor: no vote.
  assert.deepEqual(check(UNKNOWN_AGE), ['age_not_verified'])
  assert.deepEqual(check({ band: '18_plus', assurance: 'declared', reviewDue: false }), ['age_not_verified'])
  assert.deepEqual(check({ band: '18_plus', assurance: 'reviewed', reviewDue: false }), ['age_not_verified'])
  assert.deepEqual(check({ band: 'under_18', assurance: 'verified', reviewDue: false }), ['age_not_verified'])
})

test('voting membership needs a reviewed verification and a person key', () => {
  const check = (verification: VerificationFacts) =>
    membershipEligibility({ flags: approved, verification, age: verifiedAdult, membership: activeMember, now }).unmet
  assert.deepEqual(check(verified({ personKey: null })), ['uniqueness_unavailable'])
  assert.deepEqual(check(verified({ reviewedAt: null })), ['not_reviewed'])
})

test('an expired or revoked verification ends eligibility', () => {
  for (const verification of [verified({ expiresAt: daysAgo(1) }), verified({ status: 'revoked' })]) {
    const result = membershipEligibility({ flags: approved, verification, age: verifiedAdult, membership: activeMember, now })
    assert.deepEqual(result.unmet, ['not_verified'])
  }
})

test('suspensions count until they end; resigning ends membership', () => {
  const suspended = (until: Date | null): MembershipFacts => ({ ...activeMember, status: 'suspended', suspendedUntil: until })
  const check = (membership: MembershipFacts) =>
    membershipEligibility({ flags: approved, verification: verified(), age: verifiedAdult, membership, now }).unmet
  assert.deepEqual(check(suspended(daysAhead(3))), ['suspended'])
  assert.deepEqual(check(suspended(null)), ['suspended'])
  assert.deepEqual(check(suspended(daysAgo(1))), [])
  assert.deepEqual(check({ ...activeMember, status: 'resigned' }), ['resigned'])
  assert.deepEqual(check({ ...activeMember, status: 'pending' }), ['membership_pending'])
  assert.deepEqual(check(activeMember), [])
})

test('the voter list freezes 14 days before a ballot, and accounts must be 30 days old', () => {
  const ballotOpensAt = daysAhead(20)
  const base = {
    membershipEligible: true,
    accountCreatedAt: daysAgo(60),
    optedInAt: daysAgo(10),
    verifiedAt: daysAgo(10),
    ballotOpensAt,
  }
  assert.deepEqual(ballotEligibility(base), { eligible: true, unmet: [] })

  // Freeze is 14 days before opening: day +6. Joining on day +7 is too late.
  const late = ballotEligibility({ ...base, optedInAt: daysAhead(7) })
  assert.deepEqual(late.unmet, ['joined_after_freeze'])
  const lateVerify = ballotEligibility({ ...base, verifiedAt: daysAhead(7) })
  assert.deepEqual(lateVerify.unmet, ['joined_after_freeze'])

  const young = ballotEligibility({ ...base, accountCreatedAt: daysAgo(5) })
  assert.deepEqual(young.unmet, ['account_too_new'])

  const notMember = ballotEligibility({ ...base, membershipEligible: false })
  assert.deepEqual(notMember.unmet, ['not_a_member'])
})

test('no binding ballot below the minimum electorate, or while voting is switched off', () => {
  assert.equal(bindingBallotMayOpen(today, 10_000), false)
  assert.equal(bindingBallotMayOpen(approved, PROPOSED_RULES.minimumElectorate - 1), false)
  assert.equal(bindingBallotMayOpen(approved, PROPOSED_RULES.minimumElectorate), true)
})

test('person keys are keyed, stable and reveal nothing of the identifier', () => {
  const secret = 'a'.repeat(32)
  const key = derivePersonKey(secret, 'ninauth', 'subject-123')
  assert.equal(key, derivePersonKey(secret, 'ninauth', 'subject-123'))
  assert.notEqual(key, derivePersonKey('b'.repeat(32), 'ninauth', 'subject-123'))
  assert.notEqual(key, derivePersonKey(secret, 'other', 'subject-123'))
  assert.equal(key.includes('subject'), false)
  assert.throws(() => derivePersonKey('short', 'ninauth', 'subject-123'))
})
