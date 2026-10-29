import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, governanceAuditLog, governanceMemberships, identityVerifications, members, profileBadges } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { MembersService } from '../members/members.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { GovernanceService } from './governance.service.js'
import { VerificationUnavailableError } from './nin-provider.js'
import { TestNinProvider } from './test-nin-provider.js'

const DAY = 24 * 60 * 60 * 1000
const secret = 's'.repeat(32)
const consent = { version: 'verification-consent-test', at: new Date() }

// Today's switches, exactly as the environment enforces them.
const locked = { NIN_VERIFICATION_ENABLED: false, BINDING_GOVERNANCE_VOTING_ENABLED: false, UNDER_18_ACCOUNTS_ENABLED: false }
const today = new GovernanceService(db, locked)
// A future in which verification has been approved; only constructible in tests,
// because env.ts refuses to start the API with these switches on.
const approved = new GovernanceService(db, { ...locked, NIN_VERIFICATION_ENABLED: true, IDENTITY_KEY_SECRET: secret })

const ada = randomUUID()
const bayo = randomUUID()
const reviewer = randomUUID()

const provider = () =>
  new TestNinProvider({
    'ada-code': { subject: 'person-ada', over18: true, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 365 * DAY) },
    'ada-again': { subject: 'person-ada', over18: true, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 365 * DAY) },
    'ada-on-bayo': { subject: 'person-ada', over18: true, verifiedAt: new Date(), expiresAt: null },
    'bayo-code': { subject: 'person-bayo', over18: null, verifiedAt: new Date(), expiresAt: null },
  })

const verify = async (memberId: string, code: string, service = approved, p = provider()) =>
  service.recordVerification(memberId, await p.exchange({ code, codeVerifier: 'v', redirectUri: 'https://heynaija.test/cb' }), consent)

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: reviewer, handle: 'reviewer' },
  ])
})
after(() => pool.end())

test('a member starts with an unknown age, unverified, without a badge, and registration is closed', async () => {
  const status = await today.statusFor(ada)
  // No age on record (as for every account from before the 18+ beta rule) is unknown, not adult.
  assert.deepEqual(status.age, { band: 'unknown', assurance: 'none', reviewDue: false })
  assert.deepEqual(status.verification, { status: 'none', open: false, verifiedAt: null, expiresAt: null })
  assert.deepEqual(status.badge, { shown: false })
  assert.equal(status.membership.status, 'none')
  assert.equal(status.membership.registrationOpen, false)
  assert.equal(status.membership.eligible, false)
  assert.deepEqual(status.membership.unmet, ['registration_closed', 'not_legal_member', 'not_verified', 'age_not_verified', 'not_opted_in'])
})

test('nothing can be recorded while verification is switched off', async () => {
  const p = provider()
  const result = await p.exchange({ code: 'ada-code', codeVerifier: 'v', redirectUri: 'https://heynaija.test/cb' })
  await assert.rejects(today.recordVerification(ada, result, consent), VerificationUnavailableError)
  assert.equal((await db.select().from(identityVerifications)).length, 0)
})

test('only a keyed person key is stored, never the provider identifier', async () => {
  assert.equal(await verify(ada, 'ada-code'), 'verified')
  const [row] = await db.select().from(identityVerifications).where(eq(identityVerifications.memberId, ada))
  assert.ok(row!.personKey)
  assert.notEqual(row!.personKey, 'person-ada')
  assert.equal(JSON.stringify(row).includes('person-ada'), false)
  const audit = await db.select().from(governanceAuditLog)
  assert.equal(JSON.stringify(audit).includes('person-ada'), false)
})

test('one person cannot verify two accounts', async () => {
  const p = provider()
  assert.equal(await verify(ada, 'ada-code', approved, p), 'verified')
  assert.equal(await verify(bayo, 'ada-on-bayo', approved, p), 'rejected')

  assert.equal((await approved.statusFor(ada)).verification.status, 'verified')
  assert.equal((await approved.statusFor(bayo)).verification.status, 'rejected')
  const [rejected] = await db.select().from(identityVerifications).where(eq(identityVerifications.memberId, bayo))
  assert.equal(rejected!.outcome, 'duplicate_person')
  const events = await db.select({ event: governanceAuditLog.event, reason: governanceAuditLog.reason }).from(governanceAuditLog).where(eq(governanceAuditLog.subjectId, bayo))
  assert.deepEqual(events, [{ event: 'verification_rejected', reason: 'duplicate_person' }])
})

test('re-verifying the same account replaces the old record instead of colliding with it', async () => {
  const p = provider()
  await verify(ada, 'ada-code', approved, p)
  assert.equal(await verify(ada, 'ada-again', approved, p), 'verified')
  const rows = await db.select({ status: identityVerifications.status, outcome: identityVerifications.outcome }).from(identityVerifications).where(eq(identityVerifications.memberId, ada))
  assert.deepEqual(rows.map((r) => r.status).sort(), ['expired', 'verified'])
  assert.ok(rows.some((r) => r.outcome === 'superseded'))
})

test('the badge needs a person to review the verification, and the member to choose it', async () => {
  await verify(ada, 'ada-code')
  assert.equal(await approved.setBadgeVisible(ada, true), false, 'not reviewed yet')
  assert.equal(await approved.reviewVerification(ada, reviewer), true)
  assert.equal(await approved.reviewVerification(ada, reviewer), false, 'reviewed once')
  assert.equal((await approved.statusFor(ada)).badge.shown, false, 'not chosen yet')

  assert.equal(await approved.setBadgeVisible(ada, true), true)
  assert.equal((await approved.statusFor(ada)).badge.shown, true)

  // Profiles show it only while verification is switched on.
  const profilesOn = new MembersService(db, { NIN_VERIFICATION_ENABLED: true })
  const profilesOff = new MembersService(db)
  assert.equal((await profilesOn.profile(null, 'ada'))!.identityBadge, true)
  assert.equal((await profilesOff.profile(null, 'ada'))!.identityBadge, false)
  assert.equal((await profilesOn.profile(null, 'bayo'))!.identityBadge, false)

  assert.equal(await approved.setBadgeVisible(ada, false), false)
  assert.equal((await profilesOn.profile(null, 'ada'))!.identityBadge, false)
})

test('with verification switched off, an existing badge row is not shown anywhere', async () => {
  await verify(ada, 'ada-code')
  await approved.reviewVerification(ada, reviewer)
  await approved.setBadgeVisible(ada, true)
  assert.equal((await today.statusFor(ada)).badge.shown, false)
  assert.equal(await today.setBadgeVisible(ada, true), false)
  assert.equal((await new MembersService(db).profile(null, 'ada'))!.identityBadge, false)
})

test('revoking a verification removes the badge at once and is recorded', async () => {
  await verify(ada, 'ada-code')
  await approved.reviewVerification(ada, reviewer)
  await approved.setBadgeVisible(ada, true)

  assert.equal(await approved.revokeVerification(ada, reviewer, 'fraud'), true)
  assert.equal((await approved.statusFor(ada)).verification.status, 'revoked')
  assert.equal((await db.select().from(profileBadges)).length, 0)
  assert.equal(await approved.revokeVerification(ada, reviewer, 'fraud'), false, 'nothing live to revoke')
  const events = (await db.select({ event: governanceAuditLog.event }).from(governanceAuditLog).where(eq(governanceAuditLog.subjectId, ada))).map((e) => e.event)
  assert.deepEqual(events.sort(), [
    'age_recorded',
    'age_withdrawn',
    'badge_shown',
    'verification_recorded',
    'verification_reviewed',
    'verification_revoked',
  ])

  // Once revoked, the same person may verify again, on this or another account.
  assert.equal(await verify(bayo, 'ada-on-bayo'), 'verified')
})

test('hiding, replacing or revoking the green tick leaves a Founder badge alone', async () => {
  const profiles = new MembersService(db, { NIN_VERIFICATION_ENABLED: true })
  await profiles.setFounder('ada', true)
  await verify(ada, 'ada-code')
  await approved.reviewVerification(ada, reviewer)
  await approved.setBadgeVisible(ada, true)
  assert.equal(await approved.setBadgeVisible(ada, false), false)
  await approved.setBadgeVisible(ada, true)
  await verify(ada, 'ada-again')
  await approved.reviewVerification(ada, reviewer)
  await approved.setBadgeVisible(ada, true)
  await approved.revokeVerification(ada, reviewer, 'fraud')

  const profile = (await profiles.profile(null, 'ada'))!
  assert.equal(profile.identityBadge, false)
  assert.equal(profile.founderBadge, true)
  assert.deepEqual((await db.select({ kind: profileBadges.kind }).from(profileBadges)).map((b) => b.kind), ['founder'])
})

test('an expired verification shows as expired and hides the badge without a sweep', async () => {
  await verify(ada, 'ada-code')
  await approved.reviewVerification(ada, reviewer)
  await approved.setBadgeVisible(ada, true)
  const later = new Date(Date.now() + 400 * DAY)
  const status = await approved.statusFor(ada, later)
  assert.equal(status.verification.status, 'expired')
  assert.equal(status.badge.shown, false)
})

test('an age confirmation is recorded once per account, as a statement rather than a check', async () => {
  await today.recordAgeDeclaration(ada)
  await today.recordAgeDeclaration(ada)
  const rows = await db.select().from(ageAssurances).where(eq(ageAssurances.memberId, ada))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.method, 'self_declared')
  assert.equal(rows[0]!.band, '18_plus')
  const audit = await db.select().from(governanceAuditLog).where(eq(governanceAuditLog.subjectId, ada))
  assert.equal(audit.length, 1)
  assert.deepEqual((await today.statusFor(ada)).age, { band: '18_plus', assurance: 'declared', reviewDue: false })
})

test('an age result from an identity check is its own record, linked to that check', async () => {
  await approved.recordAgeDeclaration(ada)
  await verify(ada, 'ada-code')
  const rows = await db.select().from(ageAssurances).where(eq(ageAssurances.memberId, ada))
  const fromCheck = rows.find((r) => r.method === 'identity_provider')!
  const [verification] = await db.select().from(identityVerifications).where(eq(identityVerifications.memberId, ada))
  assert.equal(fromCheck.verificationId, verification!.id)
  assert.equal(fromCheck.band, '18_plus')
  assert.deepEqual((await approved.statusFor(ada)).age, { band: '18_plus', assurance: 'verified', reviewDue: false })

  // A provider that says nothing about age leaves the age as it was.
  await verify(bayo, 'bayo-code')
  assert.deepEqual((await approved.statusFor(bayo)).age, { band: 'unknown', assurance: 'none', reviewDue: false })
})

test('revoking the identity check withdraws the age result that came from it', async () => {
  await approved.recordAgeDeclaration(ada)
  await verify(ada, 'ada-code')
  await approved.revokeVerification(ada, null, 'member_withdrew')
  // Back to what the member said, not a verified adult.
  assert.deepEqual((await approved.statusFor(ada)).age, { band: '18_plus', assurance: 'declared', reviewDue: false })
  const events = (await db.select({ event: governanceAuditLog.event }).from(governanceAuditLog).where(eq(governanceAuditLog.subjectId, ada))).map((e) => e.event)
  assert.ok(events.includes('age_withdrawn'))
})

test('voting membership needs the verified age, not the signup declaration', async () => {
  const voting = new GovernanceService(db, { ...locked, NIN_VERIFICATION_ENABLED: true, BINDING_GOVERNANCE_VOTING_ENABLED: true, IDENTITY_KEY_SECRET: secret })
  await voting.recordAgeDeclaration(bayo)
  await verify(bayo, 'bayo-code', voting)
  await voting.reviewVerification(bayo, reviewer)
  // Identity verified and reviewed, adult by their own word only: no vote.
  assert.ok((await voting.statusFor(bayo)).membership.unmet.includes('age_not_verified'))

  await verify(ada, 'ada-code', voting)
  await voting.reviewVerification(ada, reviewer)
  assert.equal((await voting.statusFor(ada)).membership.unmet.includes('age_not_verified'), false)
  // Even a reviewed verified adult with an online opt-in is not evidence of
  // admission to the legal association. The future register is not built.
  await db.insert(governanceMemberships).values({
    memberId: ada, status: 'active', optedInAt: new Date(), documentsVersion: 'constitution-0.3',
  })
  const status = await voting.statusFor(ada)
  assert.equal(status.membership.status, 'active')
  assert.deepEqual(status.membership.unmet, ['not_legal_member'])
  assert.equal(status.membership.eligible, false)
})
