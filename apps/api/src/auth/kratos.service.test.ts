import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, mock, test } from 'node:test'
import { KratosService } from './kratos.service.js'
import { KratosSessionProvider } from './kratos-session.provider.js'
import { AuthProviderError } from './auth-session.provider.js'
import { ServiceUnavailableException } from '@nestjs/common'
import { RedisSessionCache, type SessionCache, sessionCacheKey } from './session-cache.js'

const KRATOS = 'http://kratos.test'

/** An in-memory SessionCache that records the keys it was given. */
class MemoryCache implements SessionCache {
  readonly entries = new Map<string, string>()
  async get(cookie: string) {
    return this.entries.get(cookie) ?? null
  }
  async set(cookie: string, value: string) {
    this.entries.set(cookie, value)
  }
  async delete(cookie: string) {
    this.entries.delete(cookie)
  }
}

// Kratos is stubbed: "good" is a live session for `identity`, anything else is 401.
const identity = { id: randomUUID(), handle: 'ada' }
const stubKratos = () =>
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const cookie = (init.headers as Record<string, string>).cookie
    if (cookie !== 'hn_session=good') return new Response(null, { status: 401 })
    return Response.json({ active: true, identity: { id: identity.id, state: 'active', traits: { handle: identity.handle } } })
  })

const service = (cache: SessionCache, ttl = 30) =>
  new KratosService({ KRATOS_PUBLIC_URL: KRATOS, WHOAMI_CACHE_TTL_S: ttl }, cache)

afterEach(() => mock.restoreAll())

test('a valid session is asked of Kratos once, then served from the cache', async () => {
  const fetch = stubKratos()
  const kratos = service(new MemoryCache())
  for (let i = 0; i < 5; i++) assert.deepEqual(await kratos.identityForSession('good'), identity)
  assert.equal(fetch.mock.callCount(), 1)
})

test('an unknown cookie is never cached, so every attempt goes to Kratos', async () => {
  const fetch = stubKratos()
  const cache = new MemoryCache()
  const kratos = service(cache)
  assert.equal(await kratos.identityForSession('stale'), null)
  assert.equal(await kratos.identityForSession('stale'), null)
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(cache.entries.size, 0)
})

test('signing out drops the cached answer', async () => {
  const fetch = stubKratos()
  const kratos = service(new MemoryCache())
  await kratos.identityForSession('good')
  await kratos.forgetSession('good')
  await kratos.identityForSession('good')
  assert.equal(fetch.mock.callCount(), 2)
})

test('a TTL of 0 turns the cache off', async () => {
  const fetch = stubKratos()
  const cache = new MemoryCache()
  const kratos = service(cache, 0)
  await kratos.identityForSession('good')
  await kratos.identityForSession('good')
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(cache.entries.size, 0)
})

test('a corrupt cache entry is ignored and replaced', async () => {
  const fetch = stubKratos()
  const cache = new MemoryCache()
  cache.entries.set('good', '{"id":')
  assert.deepEqual(await service(cache).identityForSession('good'), identity)
  assert.equal(fetch.mock.callCount(), 1)
  assert.deepEqual(JSON.parse(cache.entries.get('good')!), identity)
})

test('cache read and write failures still validate credentials with Kratos', async () => {
  const fetch = stubKratos()
  const cache: SessionCache = {
    get: async () => { throw new Error('cache read failed') },
    set: async () => { throw new Error('cache write failed') },
    delete: async () => {},
  }
  const adapter = new KratosSessionProvider(service(cache))
  const result = await adapter.authenticate({ cookieHeader: 'hn_session=good' })
  assert.equal(result.status, 'authenticated')
  if (result.status === 'authenticated') assert.deepEqual(result.identity.details, identity)
  assert.deepEqual(await adapter.authenticate({ cookieHeader: 'hn_session=stale' }), { status: 'anonymous' })
  assert.equal(fetch.mock.callCount(), 2)
})

test('cache write failure after a normal miss preserves the validated identity', async () => {
  const fetch = stubKratos()
  const cache = new MemoryCache()
  mock.method(cache, 'set', async () => { throw new Error('cache write failed') })
  assert.deepEqual(await service(cache).identityForSession('good'), identity)
  assert.equal(fetch.mock.callCount(), 1)
})

test('provider unavailability is preserved after a cache read failure', async () => {
  const cache = new MemoryCache()
  mock.method(cache, 'get', async () => { throw new Error('cache read failed') })
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }))
  const kratos = service(cache)
  await assert.rejects(kratos.identityForSession('good'), ServiceUnavailableException)
  await assert.rejects(new KratosSessionProvider(kratos).authenticate({ cookieHeader: 'hn_session=good' }),
    (error: unknown) => error instanceof AuthProviderError && error.kind === 'unavailable')
})

test('the adapter still propagates unrelated lookup errors unchanged', async () => {
  const failure = new Error('unrelated failure')
  const adapter = new KratosSessionProvider({
    identityForSession: async () => { throw failure },
    forgetSession: async () => {},
  })
  await assert.rejects(adapter.authenticate({ cookieHeader: 'hn_session=good' }),
    (error: unknown) => error === failure)
})

test('the Redis key is a hash of the cookie, never the cookie itself', () => {
  const key = sessionCacheKey('ory_st_secret-token')
  assert.match(key, /^hn:whoami:[0-9a-f]{64}$/)
  assert.ok(!key.includes('secret-token'))
})

// Against a real Redis when one is configured (the dev stack has one; CI may not).
test('the Redis cache round-trips, and fails soft when Redis is down', { skip: !process.env.REDIS_URL }, async () => {
  const cache = new RedisSessionCache({ REDIS_URL: process.env.REDIS_URL! })
  const cookie = `test-${randomUUID()}`
  try {
    // ioredis connects in the background, and with no offline queue calls made
    // before it is ready are dropped; retry until one lands.
    for (let i = 0; i < 50 && (await cache.get(cookie)) !== 'x'; i++) {
      await cache.set(cookie, 'x', 30)
      await new Promise((r) => setTimeout(r, 20))
    }
    assert.equal(await cache.get(cookie), 'x')
    await cache.set(cookie, 'short-lived', 1)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    assert.equal(await cache.get(cookie), null)
    await cache.set(cookie, 'x', 30)
    await cache.delete(cookie)
    assert.equal(await cache.get(cookie), null)
  } finally {
    cache.onModuleDestroy()
  }

  const down = new RedisSessionCache({ REDIS_URL: 'redis://127.0.0.1:1' })
  try {
    assert.equal(await down.get(cookie), null)
    await down.set(cookie, 'x', 30)
    await down.delete(cookie)
  } finally {
    down.onModuleDestroy()
  }
})
