import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { featureFlags, members } from '@heynaija/db'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AuthService } from '../auth/auth.service.js'
import { OptionalSessionGuard, SessionGuard } from '../auth/session.guard.js'
import type { AppEnv } from '../env.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { InvitesService } from '../invites/invites.service.js'
import { CONTENT_SCANNER, type ContentScanner, NoScanner } from '../media/media.service.js'
import { PhotoDnaScanner } from '../media/photodna.js'
import { RateLimiter, MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { DB, ENV } from '../tokens.js'
import { VideoGate, VideoPostsGuard } from './video-gate.js'
import { VideosController } from './video.controller.js'
import { VideoService } from './video.service.js'

// The real controller, guards and Fastify, driven in-process with `inject` (no port is opened).
// Storage and queue sit behind a stub service: this is about who gets through.

const ada = randomUUID()
const apps: NestFastifyApplication[] = []

const boot = async (appEnv: AppEnv, scanner: ContentScanner, flags?: FeatureFlags) => {
  const env = { APP_ENV: appEnv, WEB_PUBLIC_URL: 'http://127.0.0.1:3000' }
  @Module({
    controllers: [VideosController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: DB, useValue: db },
      { provide: AuthService, useValue: { identityForRequest: async (r: { cookieHeader?: string }) => (r.cookieHeader === 'ada' ? { id: ada, handle: 'ada' } : null) } },
      { provide: InvitesService, useValue: { hasRedeemed: async () => true } },
      { provide: FeatureFlags, useValue: flags ?? new FeatureFlags(db, appEnv) },
      { provide: CONTENT_SCANNER, useValue: scanner },
      { provide: RateLimiter, useValue: new MemoryRateLimiter() },
      { provide: VideoService, useValue: { startUpload: async () => ({ mediaId: 'stub' }), status: async () => null } },
      SessionGuard,
      OptionalSessionGuard,
      VideoGate,
      VideoPostsGuard,
    ],
  })
  class TestModule {}
  const app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false })
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  apps.push(app)
  return app
}

const call = async (app: NestFastifyApplication, method: 'GET' | 'POST', url: string, signedIn: boolean) => {
  const res = await app.inject({
    method,
    url,
    headers: signedIn ? { cookie: 'ada', 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    ...(method === 'POST' ? { payload: { contentType: 'video/mp4', bytes: 1000 } } : {}),
  })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

const flagOn = (on: boolean) => db.insert(featureFlags).values({ key: 'videoPosts', enabled: on })

before(migrate)
beforeEach(async () => {
  await reset()
  await db.delete(featureFlags)
  await db.insert(members).values({ id: ada, handle: 'ada' })
})
after(async () => {
  for (const app of apps) await app.close()
  await pool.end()
})

test('closed: signed in or not, every video route answers exactly like a route that does not exist', async () => {
  const app = await boot('production', new PhotoDnaScanner('key')) // production default for videoPosts is off
  const missing = await call(app, 'GET', '/v1/me/not-a-route', true)
  assert.equal(missing.status, 404)
  for (const signedIn of [true, false]) {
    for (const [method, url] of [['POST', '/v1/me/videos/upload'], ['GET', `/v1/me/videos/${randomUUID()}`], ['GET', `/v1/me/videos/${randomUUID()}/upload`], ['POST', `/v1/me/videos/${randomUUID()}/complete`]] as const) {
      const res = await call(app, method, url, signedIn)
      assert.equal(res.status, 404, `${method} ${url} signed in: ${signedIn}`)
      assert.equal(res.body.error, 'Not Found')
      assert.equal(res.body.message, `Cannot ${method} ${url}`, 'the same words Fastify uses for a missing route')
    }
  }
})

test('production with NoScanner stays closed even when an admin turned the flag on: the gate is in code', async () => {
  await flagOn(true)
  const app = await boot('production', new NoScanner())
  assert.equal((await call(app, 'POST', '/v1/me/videos/upload', true)).status, 404)
  // The same override with a real scanner bound is open.
  const open = await boot('production', new PhotoDnaScanner('key'))
  assert.equal((await call(open, 'POST', '/v1/me/videos/upload', true)).status, 201)
})

test('open (staging, flag on by default): signed-out callers are asked to sign in, signed-in ones get through', async () => {
  const app = await boot('staging', new NoScanner())
  assert.equal((await call(app, 'POST', '/v1/me/videos/upload', false)).status, 401)
  const ok = await call(app, 'POST', '/v1/me/videos/upload', true)
  assert.deepEqual([ok.status, ok.body.mediaId], [201, 'stub'])
})

test('an admin turning the flag off closes it in staging too', async () => {
  await flagOn(false)
  const app = await boot('staging', new NoScanner())
  assert.equal((await call(app, 'POST', '/v1/me/videos/upload', true)).status, 404)
})

test('fail closed: if the flags cannot be read at all, the production default (off) answers, even in staging', async () => {
  const unreadable = new FeatureFlags(db, 'staging', { load: async () => Promise.reject(new Error('db down')), onError: () => {} })
  const app = await boot('staging', new NoScanner(), unreadable)
  assert.equal((await call(app, 'POST', '/v1/me/videos/upload', true)).status, 404)
})

test('an allow-list opens it for those members only, and signed-out callers see a 404', async () => {
  const bayo = randomUUID()
  await db.insert(members).values({ id: bayo, handle: 'bayo' })
  const flags = new FeatureFlags(db, 'staging')
  await db.insert(featureFlags).values({ key: 'videoPosts', enabled: null })
  const { featureFlagMembers } = await import('@heynaija/db')
  await db.insert(featureFlagMembers).values({ flagKey: 'videoPosts', memberId: bayo })
  flags.invalidate()
  const app = await boot('staging', new NoScanner(), flags)
  assert.equal((await call(app, 'POST', '/v1/me/videos/upload', true)).status, 404, 'ada is not on the list')
  assert.equal((await call(app, 'POST', '/v1/me/videos/upload', false)).status, 404)
})
