import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ExecutionContext, HttpException, NotFoundException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import type { Env } from '../env.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { LiveKitWebhookController } from '../gists/gists.controller.js'
import { CallsController } from './calls.controller.js'
import { CallsEnabledGuard, LiveKitWebhookGuard, callsEnabled } from './calls-enabled.guard.js'
import { CallError } from './calls.service.js'

const configured = { LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 's'.repeat(32) }
const env = (over: Partial<Env>) => ({ CALLS_ENABLED: true, CALLS_GISTS_ENABLED: false, ...configured, ...over }) as Env
const context = (method = 'POST', url = '/v1/calls') =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method, url }) }) }) as unknown as ExecutionContext

test('calls are off unless CALLS_ENABLED is on and LiveKit is configured', () => {
  assert.equal(callsEnabled(env({})), true)
  assert.equal(callsEnabled(env({ CALLS_ENABLED: false })), false)
  assert.equal(callsEnabled(env({ LIVEKIT_URL: undefined })), false)
  assert.equal(callsEnabled(env({ LIVEKIT_API_SECRET: undefined })), false)
})

test('with the flag off every calls route is a 404 in the words of a missing route', () => {
  assert.throws(
    () => new CallsEnabledGuard(env({ CALLS_ENABLED: false })).canActivate(context('GET', '/v1/calls/incoming')),
    (err: unknown) => {
      assert.ok(err instanceof NotFoundException)
      assert.deepEqual(err.getResponse(), { message: 'Cannot GET /v1/calls/incoming', error: 'Not Found', statusCode: 404 })
      return true
    },
  )
  assert.equal(new CallsEnabledGuard(env({})).canActivate(context()), true)
})

test('the shared webhook is live when either calls or Gists is on, and 404 when neither is', () => {
  const off = env({ CALLS_ENABLED: false })
  assert.throws(() => new LiveKitWebhookGuard(off).canActivate(context('POST', '/internal/livekit/webhook')), NotFoundException)
  assert.equal(new LiveKitWebhookGuard(env({})).canActivate(context()), true)
  assert.equal(new LiveKitWebhookGuard(env({ CALLS_ENABLED: true, CALLS_GISTS_ENABLED: true })).canActivate(context()), true)
})

test('every calls route starts with the flag guard, before sign-in', () => {
  const names = Object.getOwnPropertyNames(CallsController.prototype).filter((n) => n !== 'constructor')
  assert.ok(names.length >= 10)
  for (const name of names) {
    const own =
      (Reflect.getMetadata(GUARDS_METADATA, CallsController.prototype[name as keyof CallsController]) as unknown[] | undefined) ??
      (Reflect.getMetadata(GUARDS_METADATA, CallsController) as unknown[])
    assert.equal(own[0], CallsEnabledGuard, `CallsController.${name}`)
  }
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, LiveKitWebhookController)[0], LiveKitWebhookGuard)
})

test('a refusal from the service is the 404 of a missing route; busy is a 409 with plain words', async () => {
  const req = { method: 'POST', url: '/v1/calls', member: { id: 'm', handle: 'ada' } } as never
  const refuse = (code: CallError['code']) => ({
    create: async () => {
      throw new CallError(code)
    },
  })
  const memberId = '11111111-1111-4111-8111-111111111111'
  await assert.rejects(new CallsController(refuse('not_found') as never, new MemoryRateLimiter()).start(req, { memberId }), NotFoundException)
  await assert.rejects(new CallsController(refuse('busy') as never, new MemoryRateLimiter()).start(req, { memberId }), (err: unknown) => {
    assert.equal((err as HttpException).getStatus(), 409)
    return true
  })
})

test('starting calls is rate-limited per caller and per pair', async () => {
  let started = 0
  const controller = new CallsController({ create: async () => ({ n: ++started }) } as never, new MemoryRateLimiter())
  const req = { method: 'POST', url: '/v1/calls', member: { id: 'm', handle: 'ada' } } as never
  const memberId = '11111111-1111-4111-8111-111111111111'
  let refused = 0
  for (let i = 0; i < 10; i++) {
    try {
      await controller.start(req, { memberId })
    } catch (err) {
      assert.equal((err as HttpException).getStatus(), 429)
      refused++
    }
  }
  assert.equal(started, 5)
  assert.equal(refused, 5)
})

test('can-call answers 200 only for a yes; every no is the 404 of a missing route', async () => {
  const req = { method: 'GET', url: '/v1/calls/can-call/x', member: { id: 'm', handle: 'ada' } } as never
  const yes = new CallsController({ canCallMember: async () => true } as never, new MemoryRateLimiter())
  assert.deepEqual(await yes.canCall(req, 'x'), { eligible: true })
  const no = new CallsController({ canCallMember: async () => false } as never, new MemoryRateLimiter())
  await assert.rejects(no.canCall(req, 'x'), (err: unknown) => {
    assert.ok(err instanceof NotFoundException)
    assert.deepEqual(err.getResponse(), { message: 'Cannot GET /v1/calls/can-call/x', error: 'Not Found', statusCode: 404 })
    return true
  })
})

test('incoming for a member who cannot use calls is the 404 of a missing route', async () => {
  const req = { method: 'GET', url: '/v1/calls/incoming', member: { id: 'm', handle: 'bob' } } as never
  const refuse = {
    incoming: async () => {
      throw new CallError('not_found')
    },
  }
  await assert.rejects(new CallsController(refuse as never, new MemoryRateLimiter()).incoming(req), NotFoundException)
})
