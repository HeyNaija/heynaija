import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, members } from '@heynaija/db'
import { HttpException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { Env } from '../env.js'
import { GovernanceService } from '../governance/governance.service.js'
import { InvitesService } from '../invites/invites.service.js'
import { MembersService } from '../members/members.service.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { AuthController } from './auth.controller.js'

const secret = 'w'.repeat(32)
const unsaved = '00000000-0000-0000-0000-000000000000'
const invites = new InvitesService(db)
const env = {
  KRATOS_WEBHOOK_SECRET: secret,
  NIN_VERIFICATION_ENABLED: false,
  BINDING_GOVERNANCE_VOTING_ENABLED: false,
  UNDER_18_ACCOUNTS_ENABLED: false,
} as Env

// Only the registration webhooks are exercised, so the services they do not use are left out.
const controller = new AuthController(
  invites,
  {} as never,
  {} as never,
  new MemoryRateLimiter(),
  env,
  db,
  {} as never,
  new MembersService(db),
  new GovernanceService(db, env),
  {} as never,
  {} as never,
  {} as never,
)

/** The message Kratos would show on the signup form, or null if the signup may go ahead. */
const refusal = async (body: object): Promise<string | null> => {
  try {
    await controller.registration(secret, body)
    return null
  } catch (err) {
    assert.ok(err instanceof HttpException)
    assert.equal(err.getStatus(), 400)
    const response = err.getResponse() as { messages: { messages: { text: string }[] }[] }
    return response.messages[0]!.messages[0]!.text
  }
}

before(migrate)
beforeEach(reset)
after(() => pool.end())

/** A date of birth for someone `years` old today, with a day to spare either way. */
const bornYearsAgo = (years: number, days = 0) => {
  const date = new Date()
  date.setUTCFullYear(date.getUTCFullYear() - years)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

test('a signup without a date of birth is refused', async () => {
  const code = await invites.create()
  const body = { identity_id: unsaved, invite_code: code, handle: 'newcomer' }
  assert.match((await refusal(body))!, /enter your date of birth/)
  assert.match((await refusal({ ...body, birth_date: '' }))!, /enter your date of birth/)
  assert.match((await refusal({ ...body, birth_date: '1990-02-30' }))!, /enter your date of birth/)
  assert.equal(await refusal({ ...body, birth_date: '1990-03-27' }), null)
})

test('during the 18+ beta, anyone under 18 is refused, and nobody under 13 ever', async () => {
  const code = await invites.create()
  const body = { identity_id: unsaved, invite_code: code, handle: 'newcomer' }
  assert.equal(await refusal({ ...body, birth_date: bornYearsAgo(18, -2) }), null)
  assert.match((await refusal({ ...body, birth_date: bornYearsAgo(18, 2) }))!, /aged 18 and over/)
  assert.match((await refusal({ ...body, birth_date: bornYearsAgo(12) }))!, /aged 18 and over/)
})

test('the old "18 or older" box no longer lets anyone join', async () => {
  const code = await invites.create()
  const body = { identity_id: unsaved, invite_code: code, handle: 'newcomer' }
  assert.match((await refusal({ ...body, adult_declared: true }))!, /enter your date of birth/)
  // The cookie's old value is not a date.
  assert.match((await refusal({ ...body, birth_date: '18-plus' }))!, /enter your date of birth/)
})

test('the invite is still checked first', async () => {
  const body = { identity_id: unsaved, invite_code: 'HN-NOPE-NOPE-NOPE', handle: 'newcomer', birth_date: '1990-03-27' }
  assert.match((await refusal(body))!, /invite code is not valid/)
})

test('/join can ask whether a date of birth may join, without anything being kept', async () => {
  const ask = (birthDate: unknown) => controller.checkAge({ ip: '203.0.113.9', headers: {} } as never, { birthDate })
  assert.deepEqual(await ask('1990-03-27'), { outcome: 'allowed', joinAge: 18 })
  assert.deepEqual(await ask(bornYearsAgo(16)), { outcome: 'too_young', joinAge: 18 })
  assert.deepEqual(await ask(bornYearsAgo(10)), { outcome: 'too_young', joinAge: 18 })
  assert.deepEqual(await ask('2999-01-01'), { outcome: 'not_a_date', joinAge: 18 })
  assert.deepEqual(await ask(42), { outcome: 'not_a_date', joinAge: 18 })
  assert.equal((await db.select().from(ageAssurances)).length, 0)
})

test('a wrong webhook secret is turned away before anything else', async () => {
  await assert.rejects(controller.registration('nope', {}), (err: unknown) => err instanceof HttpException && err.getStatus() === 401)
})

test('once the account exists, the date of birth is recorded with the invite', async () => {
  const code = await invites.create({ maxUses: 3 })
  const adult = randomUUID()
  const older = randomUUID()
  assert.deepEqual(await controller.registered(secret, { identity_id: adult, invite_code: code, handle: 'adult', birth_date: '1990-03-27' }), { redeemed: true })
  // A body with no date (which the first hook refuses) still redeems, but records nothing;
  // the member is asked for their date before they can use the app.
  assert.deepEqual(await controller.registered(secret, { identity_id: older, invite_code: code, handle: 'older' }), { redeemed: true })

  const [row] = await db.select().from(ageAssurances).where(eq(ageAssurances.memberId, adult))
  assert.equal(row!.method, 'self_declared')
  assert.equal(row!.band, '18_plus')
  assert.equal(row!.birthDate, '1990-03-27')
  assert.equal((await db.select().from(ageAssurances).where(eq(ageAssurances.memberId, older))).length, 0)
})

const settingsRefusal = async (body: object): Promise<string | null> => {
  try {
    await controller.settings(secret, body)
    return null
  } catch (err) {
    assert.ok(err instanceof HttpException)
    const response = err.getResponse() as { messages: { instance_ptr: string; messages: { text: string }[] }[] }
    assert.equal(response.messages[0]!.instance_ptr, '#/traits/handle')
    return response.messages[0]!.messages[0]!.text
  }
}

test('a rename in Settings holds the old handle, except that an account waiting to be deleted keeps its own', async () => {
  const id = randomUUID()
  await db.insert(members).values({ id, handle: 'ada' })
  assert.equal(await settingsRefusal({ identity_id: id, handle: 'ada', previous_handle: 'ada' }), null)
  assert.equal(await settingsRefusal({ identity_id: id, handle: 'ada_new', previous_handle: 'ada' }), null)
  assert.equal(await new MembersService(db).handleHeld('ada', null), true)

  await db.update(members).set({ handle: 'ada_new', active: false, deletionRequestedAt: new Date() }).where(eq(members.id, id))
  assert.match((await settingsRefusal({ identity_id: id, handle: 'ada_newer', previous_handle: 'ada_new' }))!, /being deleted/)
  assert.equal(await new MembersService(db).handleHeld('ada_new', null), false, 'nothing was held for a rename that did not happen')
  // Other changes in Settings still go through.
  assert.equal(await settingsRefusal({ identity_id: id, handle: 'ada_new', previous_handle: 'ada_new' }), null)
})
