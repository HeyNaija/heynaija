import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { featureFlagChanges, members } from '@heynaija/db'
import { type ExecutionContext, HttpException, NotFoundException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { AuthedRequest } from '../auth/session.guard.js'
import type { ModerationService } from '../moderation/moderation.service.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { FeatureFlags } from './feature-flags.js'
import { Feature, FeatureGuard } from './feature.guard.js'
import { FlagsController } from './flags.controller.js'

const ada = randomUUID() // site moderator, so an admin
const bayo = randomUUID() // ordinary member

const moderation = { scope: async (id: string) => ({ siteWide: id === ada, communityIds: [] }) } as Pick<ModerationService, 'scope'> as ModerationService
const flags = new FeatureFlags(db, 'production')
const controller = new FlagsController(flags, moderation, new MemoryRateLimiter())
const as = (id: string) => ({ member: { id } }) as AuthedRequest

before(migrate)
beforeEach(async () => {
  await reset()
  flags.invalidate()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
  ])
})
after(() => pool.end())

const status = async (run: () => Promise<unknown>) => {
  try {
    await run()
    return 200
  } catch (err) {
    assert.ok(err instanceof HttpException, String(err))
    return err.getStatus()
  }
}

test('listing is for site moderators only', async () => {
  assert.equal(await status(() => controller.list(as(bayo))), 403)
  const view = await controller.list(as(ada))
  assert.equal(view.env, 'production')
  assert.ok(view.flags.some((f) => f.key === 'polls'))
})

test('a site moderator turns a live flag off, and the next read sees it, with the change audited', async () => {
  assert.equal(await flags.isEnabled('polls'), true)
  await controller.put(as(ada), 'polls', { enabled: false })
  assert.equal(await flags.isEnabled('polls'), false)
  const [change] = await db.select().from(featureFlagChanges)
  assert.equal(change?.actorHandle, 'ada')
  assert.deepEqual(change?.after, { enabled: false, handles: [] })
})

test('a member who is not an admin cannot change a flag, and nothing is recorded', async () => {
  assert.equal(await status(() => controller.put(as(bayo), 'polls', { enabled: false })), 403)
  assert.equal(await flags.isEnabled('polls'), true)
  assert.equal((await db.select().from(featureFlagChanges)).length, 0)
})

test('bad requests: an unknown flag is 404, a malformed body or unknown handle is 400', async () => {
  assert.equal(await status(() => controller.put(as(ada), 'nope', { enabled: true })), 404)
  assert.equal(await status(() => controller.put(as(ada), 'polls', { enabled: 'yes' })), 400)
  assert.equal(await status(() => controller.put(as(ada), 'polls', {})), 400)
  assert.equal(await status(() => controller.put(as(ada), 'polls', { enabled: null, handles: ['ghost'] })), 400)
  assert.equal(await status(() => controller.put(as(ada), 'polls', { enabled: true, handles: ['bayo'] })), 400)
  assert.equal((await db.select().from(featureFlagChanges)).length, 0)
})

test('an allow-list through the API: on for the listed member only', async () => {
  await controller.put(as(ada), 'polls', { enabled: null, handles: ['@Bayo'] })
  assert.equal(await flags.isEnabled('polls', bayo), true)
  assert.equal(await flags.isEnabled('polls', ada), false)
})

test('changes are rate limited', async () => {
  const limited = new FlagsController(flags, moderation, new MemoryRateLimiter())
  let last = 0
  for (let i = 0; i < 31; i++) last = await status(() => limited.put(as(ada), 'polls', { enabled: i % 2 === 0 }))
  assert.equal(last, 429)
})

// --- The route guard ---

const contextFor = (member: { id: string } | undefined, key?: 'polls') => {
  class Routes {
    @Feature('polls')
    gated() {}
    open() {}
  }
  const handler = key ? Routes.prototype.gated : Routes.prototype.open
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ member }) }),
  } as unknown as ExecutionContext
}

test('guard: a route behind a flag that is off is 404; once it is on, it opens', async () => {
  const guard = new FeatureGuard(new Reflector(), flags)
  assert.equal(await guard.canActivate(contextFor({ id: bayo }, 'polls')), true)
  await flags.set(ada, 'polls', { enabled: false })
  await assert.rejects(() => guard.canActivate(contextFor({ id: bayo }, 'polls')) as Promise<boolean>, NotFoundException)
  await flags.set(ada, 'polls', { enabled: true })
  assert.equal(await guard.canActivate(contextFor({ id: bayo }, 'polls')), true)
})

test('guard: an allow-listed member gets in and everyone else, signed out included, gets 404', async () => {
  const guard = new FeatureGuard(new Reflector(), flags)
  await flags.set(ada, 'polls', { enabled: null, handles: ['bayo'] })
  assert.equal(await guard.canActivate(contextFor({ id: bayo }, 'polls')), true)
  await assert.rejects(() => guard.canActivate(contextFor({ id: ada }, 'polls')) as Promise<boolean>, NotFoundException)
  await assert.rejects(() => guard.canActivate(contextFor(undefined, 'polls')) as Promise<boolean>, NotFoundException)
})

test('guard: a route with no flag is left alone', async () => {
  const guard = new FeatureGuard(new Reflector(), flags)
  assert.equal(await guard.canActivate(contextFor(undefined)), true)
})
