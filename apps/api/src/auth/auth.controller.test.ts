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

test('a signup without the 18+ confirmation is refused', async () => {
  const code = await invites.create()
  const body = { identity_id: unsaved, invite_code: code, handle: 'newcomer' }
  assert.match((await refusal(body))!, /18 or older/)
  assert.match((await refusal({ ...body, adult_declared: false }))!, /18 or older/)
  assert.equal(await refusal({ ...body, adult_declared: true }), null)
})

test('the invite is still checked first', async () => {
  const body = { identity_id: unsaved, invite_code: 'HN-NOPE-NOPE-NOPE', handle: 'newcomer', adult_declared: true }
  assert.match((await refusal(body))!, /invite code is not valid/)
})

test('a wrong webhook secret is turned away before anything else', async () => {
  await assert.rejects(controller.registration('nope', {}), (err: unknown) => err instanceof HttpException && err.getStatus() === 401)
})

test('once the account exists, the age confirmation is recorded with the invite', async () => {
  const code = await invites.create({ maxUses: 2 })
  const adult = randomUUID()
  const older = randomUUID()
  assert.deepEqual(await controller.registered(secret, { identity_id: adult, invite_code: code, handle: 'adult', adult_declared: true }), { redeemed: true })
  // A body from before the 18+ rule (no adult_declared) still redeems, but records nothing.
  assert.deepEqual(await controller.registered(secret, { identity_id: older, invite_code: code, handle: 'older' }), { redeemed: true })

  const [row] = await db.select().from(ageAssurances).where(eq(ageAssurances.memberId, adult))
  assert.equal(row!.method, 'self_declared')
  assert.equal(row!.band, '18_plus')
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
