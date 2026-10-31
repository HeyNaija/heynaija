import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ExecutionContext, HttpException, NotFoundException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import type { Env } from '../env.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { LiveKitWebhookGuard } from '../calls/calls-enabled.guard.js'
import { GistsController, LiveKitWebhookController } from './gists.controller.js'
import { GistsEnabledGuard, gistsEnabled, gistsFeatureFor } from './gists-enabled.guard.js'

const configured = { LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 's'.repeat(32) }
const env = (over: Partial<Env>) => ({ CALLS_ENABLED: true, CALLS_GISTS_ENABLED: true, ...configured, ...over }) as Env

const context = (method = 'GET', url = '/v1/gists/abc') =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method, url }) }) }) as unknown as ExecutionContext

const refusal = (e: Env): HttpException | undefined => {
  try {
    new GistsEnabledGuard(e).canActivate(context())
  } catch (err) {
    return err as HttpException
  }
  return undefined
}

test('Gists are off unless both switches are on and LiveKit is configured', () => {
  assert.equal(gistsEnabled(env({})), true)
  assert.equal(gistsEnabled(env({ CALLS_ENABLED: false })), false)
  assert.equal(gistsEnabled(env({ CALLS_GISTS_ENABLED: false })), false)
  assert.equal(gistsEnabled(env({ LIVEKIT_URL: undefined })), false)
  assert.equal(gistsEnabled(env({ LIVEKIT_API_KEY: undefined })), false)
  assert.equal(gistsEnabled(env({ LIVEKIT_API_SECRET: undefined })), false)
})

test('with the flag off a route answers 404 in the same words as a route that does not exist', () => {
  const err = refusal(env({ CALLS_GISTS_ENABLED: false }))
  assert.ok(err instanceof NotFoundException)
  assert.deepEqual(err.getResponse(), { message: 'Cannot GET /v1/gists/abc', error: 'Not Found', statusCode: 404 })
  assert.equal(refusal(env({})), undefined)
})

test('every Gists route is behind the flag, and the flag is checked before sign-in', () => {
  for (const controller of [GistsController, LiveKitWebhookController]) {
    const names = Object.getOwnPropertyNames(controller.prototype).filter((n) => n !== 'constructor')
    assert.ok(names.length > 0)
    const first = controller === LiveKitWebhookController ? LiveKitWebhookGuard : GistsEnabledGuard
    for (const name of names) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller.prototype[name as keyof typeof controller.prototype]) as unknown[] | undefined
      const own = guards ?? (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined) ?? []
      assert.equal(own[0], first, `${controller.name}.${name} must start with ${first.name}`)
    }
  }
})

test('/v1/me shows the Gists feature only to allow-listed members, and only while it is on', () => {
  const on = env({ CALLS_MEMBERS: ['ada'] })
  assert.equal(gistsFeatureFor(on, { handle: 'ada' }), true)
  assert.equal(gistsFeatureFor(on, { handle: 'bayo' }), false)
  assert.equal(gistsFeatureFor(env({ CALLS_MEMBERS: ['ada'], CALLS_GISTS_ENABLED: false }), { handle: 'ada' }), false)
})

test('/sync is rate-limited', async () => {
  let calls = 0
  const service = { sync: async () => ({ role: 'listener', n: ++calls }) }
  const controller = new GistsController(service as never, new MemoryRateLimiter())
  const req = { member: { id: 'm', handle: 'ada' } } as never
  let refused = 0
  for (let i = 0; i < 40; i++) {
    try {
      await controller.sync(req, 's')
    } catch (err) {
      assert.equal((err as HttpException).getStatus(), 429)
      refused++
    }
  }
  assert.ok(refused > 0 && calls < 40)
})
