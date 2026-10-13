import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { invites } from '@heynaija/db'
import { db, migrate, pool, reset } from '../test-db.js'
import { InvitesService, normaliseInviteCode } from './invites.service.js'

const service = new InvitesService(db)
const usedCount = async () => (await db.select().from(invites))[0]!.usedCount

before(migrate)
beforeEach(reset)
after(() => pool.end())

test('a new code is usable and only its hash is stored', async () => {
  const code = await service.create()
  assert.match(code, /^HN-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  assert.equal(await service.isUsable(code), true)
  const [row] = await db.select().from(invites)
  assert.ok(!JSON.stringify(row).includes(normaliseInviteCode(code)))
})

test('codes are forgiving about case, spacing and look-alike letters', async () => {
  const code = await service.create()
  assert.equal(await service.isUsable(code.toLowerCase().replaceAll('-', ' ')), true)
  assert.equal(normaliseInviteCode('hn-o0il'), 'HN0011')
})

test('unknown and empty codes are rejected', async () => {
  await service.create()
  assert.equal(await service.isUsable('HN-0000-0000-0000'), false)
  assert.equal(await service.isUsable(''), false)
  assert.equal(await service.redeem('HN-0000-0000-0000', randomUUID()), false)
  assert.equal(await service.redeem('--', randomUUID()), false)
})

test('checking a code does not spend it', async () => {
  const code = await service.create()
  await service.isUsable(code)
  await service.isUsable(code)
  assert.equal(await usedCount(), 0)
})

test('a single-use code works once', async () => {
  const code = await service.create()
  const first = randomUUID()
  assert.equal(await service.redeem(code, first), true)
  assert.equal(await service.hasRedeemed(first), true)
  assert.equal(await service.isUsable(code), false)
  assert.equal(await service.redeem(code, randomUUID()), false)
  assert.equal(await usedCount(), 1)
})

test('redeeming twice for the same identity spends one use', async () => {
  const code = await service.create({ maxUses: 5 })
  const identity = randomUUID()
  assert.equal(await service.redeem(code, identity), true)
  assert.equal(await service.redeem(code, identity), true)
  assert.equal(await usedCount(), 1)
})

test('a multi-use code stops at its limit', async () => {
  const code = await service.create({ maxUses: 3 })
  const results = []
  for (let i = 0; i < 5; i++) results.push(await service.redeem(code, randomUUID()))
  assert.deepEqual(results, [true, true, true, false, false])
})

test('concurrent signups cannot overspend the last use', async () => {
  const code = await service.create({ maxUses: 2 })
  const results = await Promise.all(
    Array.from({ length: 12 }, () => service.redeem(code, randomUUID())),
  )
  assert.equal(results.filter(Boolean).length, 2)
  assert.equal(await usedCount(), 2)
})

test('expired and disabled codes are rejected', async () => {
  const expired = await service.create({ expiresAt: new Date(Date.now() - 1000) })
  assert.equal(await service.isUsable(expired), false)
  assert.equal(await service.redeem(expired, randomUUID()), false)

  const disabled = await service.create({ expiresAt: new Date(Date.now() + 60_000) })
  assert.equal(await service.isUsable(disabled), true)
  await db.update(invites).set({ disabledAt: new Date() })
  assert.equal(await service.isUsable(disabled), false)
})

test('an identity that never redeemed is not a member', async () => {
  assert.equal(await service.hasRedeemed(randomUUID()), false)
})
