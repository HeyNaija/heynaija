import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ExecutionContext, HttpException, NotFoundException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import { OptionalSessionGuard, SessionGuard } from '../auth/session.guard.js'
import type { AppEnv } from '../env.js'
import { FeatureFlags, type Snapshot } from '../flags/feature-flags.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { GistsController, LiveKitWebhookController } from './gists.controller.js'
import { type GistsAccess, GistsEnabledGuard, GistsGate, LiveKitConfiguredGuard, livekitConfigured } from './gists-enabled.guard.js'

const configured = { LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 's'.repeat(32) }
type LiveKit = { [K in keyof typeof configured]: string | undefined }

/** The gists flag as an admin left it: on or off for everyone, or on for the members listed. */
const gate = (appEnv: AppEnv, override?: { enabled?: boolean; allow?: string[] }, livekit: LiveKit = configured) => {
  const snapshot: Snapshot = new Map(override ? [['gists', { enabled: override.enabled ?? null, allow: new Set(override.allow) }]] : [])
  return new GistsGate(new FeatureFlags({} as never, appEnv, { load: async () => snapshot }), { APP_ENV: appEnv, ...livekit })
}

const who = async (g: GistsGate) => {
  const access: GistsAccess = await g.access()
  return { a: access.member('a'), b: access.member('b'), anyone: access.anyone }
}

const context = (member?: string, method = 'GET', url = '/v1/gists/abc') =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method, url, member: member ? { id: member } : undefined }) }) }) as unknown as ExecutionContext

const refusal = async (g: GistsGate, member?: string): Promise<HttpException | undefined> => {
  try {
    await new GistsEnabledGuard(g).canActivate(context(member))
  } catch (err) {
    return err as HttpException
  }
  return undefined
}

test('without LiveKit Gists are off, whatever the flag says', async () => {
  assert.equal(livekitConfigured(configured), true)
  for (const key of Object.keys(configured)) {
    const missing = { ...configured, [key]: undefined }
    assert.equal(livekitConfigured(missing), false, key)
    assert.deepEqual(await who(gate('staging', { enabled: true }, missing)), { a: false, b: false, anyone: false }, key)
  }
})

test('in staging and development the flag decides: on by default, off when switched off, the listed only when listed', async () => {
  assert.deepEqual(await who(gate('development')), { a: true, b: true, anyone: true })
  assert.deepEqual(await who(gate('staging')), { a: true, b: true, anyone: true })
  assert.deepEqual(await who(gate('staging', { enabled: false })), { a: false, b: false, anyone: false })
  assert.deepEqual(await who(gate('staging', { allow: ['a'] })), { a: true, b: false, anyone: true })
})

test('in production Gists open only through an allow-list, never to everyone', async () => {
  assert.deepEqual(await who(gate('production')), { a: false, b: false, anyone: false }, 'off by default')
  assert.deepEqual(await who(gate('production', { enabled: true })), { a: false, b: false, anyone: false }, 'on for everyone')
  assert.deepEqual(await who(gate('production', { allow: ['a'] })), { a: true, b: false, anyone: true })
})

test('a member Gists are not open to gets the 404 of a missing route; a signed-out caller goes on to sign in only while they are open to somebody', async () => {
  const listed = gate('production', { allow: ['a'] })
  const err = await refusal(listed, 'b')
  assert.ok(err instanceof NotFoundException)
  assert.deepEqual(err.getResponse(), { message: 'Cannot GET /v1/gists/abc', error: 'Not Found', statusCode: 404 })
  assert.equal(await refusal(listed, 'a'), undefined)
  assert.equal(await refusal(listed), undefined, 'signed out: on to SessionGuard and its 401')
  assert.ok((await refusal(gate('production'))) instanceof NotFoundException, 'signed out, open to nobody')
  assert.ok((await refusal(gate('staging', { enabled: false }), 'a')) instanceof NotFoundException)
})

test('every Gists route reads the session, then checks the flag, then requires sign-in; the webhook needs only LiveKit', () => {
  // Nest runs a controller's guards before any a route adds, so these come first on every route.
  const guardsOf = (controller: object) => Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]
  assert.deepEqual(guardsOf(GistsController), [OptionalSessionGuard, GistsEnabledGuard, SessionGuard])
  assert.deepEqual(guardsOf(LiveKitWebhookController), [LiveKitConfiguredGuard])

  const webhook = (livekit: LiveKit) => new LiveKitConfiguredGuard(livekit).canActivate(context(undefined, 'POST', '/internal/livekit/webhook'))
  assert.equal(webhook(configured), true)
  assert.throws(() => webhook({ ...configured, LIVEKIT_URL: undefined }), NotFoundException)
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
