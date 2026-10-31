import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import type { Env } from '../env.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { callsEnabled, callsFeatureFor } from './calls-enabled.guard.js'
import { canCall, isAgeVerifiedAdult } from './can-call.js'

const config = { callsMembers: ['ada', 'bayo'] }
const ada = randomUUID()
const bayo = randomUUID()
const outsider = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada', allowCalls: true },
    { id: bayo, handle: 'bayo', allowCalls: true },
    // Has switched "Allow calls" on and is active, but is not on the allow-list.
    { id: outsider, handle: 'outsider', allowCalls: true },
  ])
})
after(() => pool.end())

test('the age seam passes only members on the allow-list', () => {
  assert.equal(isAgeVerifiedAdult({ handle: 'ada' }, config), true)
  assert.equal(isAgeVerifiedAdult({ handle: 'ADA' }, config), true)
  assert.equal(isAgeVerifiedAdult({ handle: 'outsider' }, config), false)
  assert.equal(isAgeVerifiedAdult({ handle: 'ada' }, { callsMembers: [] }), false)
})

test('a member not on the allow-list is refused even with CALLS_ENABLED true and Allow calls on', async () => {
  const env = {
    CALLS_ENABLED: true,
    CALLS_MEMBERS: ['ada', 'bayo'],
    LIVEKIT_URL: 'ws://127.0.0.1:7880',
    LIVEKIT_API_KEY: 'key',
    LIVEKIT_API_SECRET: 's'.repeat(32),
  } as Env
  assert.equal(callsEnabled(env), true)
  assert.equal(await canCall(db, config, outsider), false)
  assert.equal(callsFeatureFor(env, { handle: 'outsider' }), false)
  assert.equal(await canCall(db, config, ada), true)
  assert.equal(callsFeatureFor(env, { handle: 'ada' }), true)
  assert.equal(callsFeatureFor({ ...env, CALLS_ENABLED: false }, { handle: 'ada' }), false)
})

test('Allow calls must be on, and the account active', async () => {
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, ada))
  assert.equal(await canCall(db, config, ada), false)
  await db.update(members).set({ allowCalls: true, active: false, status: 'suspended' }).where(eq(members.id, ada))
  assert.equal(await canCall(db, config, ada), false)
  assert.equal(await canCall(db, config, randomUUID()), false)
})

test('a pair needs both eligible and no block either way', async () => {
  assert.equal(await canCall(db, config, ada, bayo), true)
  assert.equal(await canCall(db, config, ada, outsider), false)
  assert.equal(await canCall(db, config, outsider, ada), false)
  await db.insert(blocks).values({ blockerId: bayo, blockedId: ada })
  assert.equal(await canCall(db, config, ada, bayo), false)
  assert.equal(await canCall(db, config, bayo, ada), false)
  assert.equal(await canCall(db, config, ada), true)
})
