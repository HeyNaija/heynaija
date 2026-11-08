import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { GovernanceController } from './governance.controller.js'
import { GovernanceService } from './governance.service.js'

// Dates of birth asked, as they were until 8 November 2026; env.ts keeps them off today.
const env = { NIN_VERIFICATION_ENABLED: false, BINDING_GOVERNANCE_VOTING_ENABLED: false, UNDER_18_ACCOUNTS_ENABLED: false, BIRTH_DATE_ENABLED: true }
const alerts: { subject: string; lines: string[] }[] = []
const controller = new GovernanceController(new GovernanceService(db, env), new MemoryRateLimiter(), {
  alert: async (subject, lines) => void alerts.push({ subject, lines }),
})

const ada = { id: randomUUID(), handle: 'ada' }
const give = (birthDate: unknown) => controller.giveBirthDate({ member: ada } as never, { birthDate })

/** A date of birth for someone `years` old today. */
const bornYearsAgo = (years: number) => {
  const date = new Date()
  date.setUTCFullYear(date.getUTCFullYear() - years)
  date.setUTCDate(date.getUTCDate() - 2)
  return date.toISOString().slice(0, 10)
}

const account = async () =>
  (await db.select({ active: members.active, status: members.status }).from(members).where(eq(members.id, ada.id)))[0]

before(migrate)
beforeEach(async () => {
  await reset()
  alerts.length = 0
  await db.insert(members).values({ id: ada.id, handle: ada.handle })
})
after(() => pool.end())

test('a date that cannot be a birthday is no answer, and nothing is kept', async () => {
  assert.deepEqual(await give('2999-01-01'), { outcome: 'not_a_date' })
  assert.deepEqual(await give(42), { outcome: 'not_a_date' })
  assert.equal((await db.select().from(ageAssurances)).length, 0)
})

test('an adult date is recorded once, with nobody told', async () => {
  assert.deepEqual(await give('1990-03-27'), { outcome: 'recorded' })
  assert.deepEqual(await give('1991-01-01'), { outcome: 'already_given' })
  assert.equal(alerts.length, 0)
  assert.deepEqual(await account(), { active: true, status: null })
})

test('an under-18 date is kept and moderators are told, without the date', async () => {
  const born = bornYearsAgo(15)
  assert.deepEqual(await give(born), { outcome: 'recorded' })
  assert.deepEqual(await account(), { active: true, status: null })
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]!.subject, 'A member gave an age under 18')
  assert.ok(alerts[0]!.lines.includes('Member: @ada'))
  assert.ok(!JSON.stringify(alerts[0]).includes(born))
})

test('under 13, the account is also suspended until a moderator looks', async () => {
  const born = bornYearsAgo(10)
  assert.deepEqual(await give(born), { outcome: 'suspended' })
  assert.deepEqual(await account(), { active: false, status: 'suspended' })
  const [row] = await db.select().from(ageAssurances).where(eq(ageAssurances.memberId, ada.id))
  assert.equal(row!.birthDate, born)
  assert.equal(alerts[0]!.subject, 'A member gave an age under 13')
  assert.ok(!JSON.stringify(alerts[0]).includes(born))
})
