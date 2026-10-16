import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances } from '@heynaija/db'
import { HttpException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { Env } from '../env.js'
import { GovernanceService } from '../governance/governance.service.js'
import { InvitesService } from '../invites/invites.service.js'
import { MembersService } from '../members/members.service.js'
import { RateLimiter } from '../rate-limit.js'
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
  new RateLimiter(),
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
