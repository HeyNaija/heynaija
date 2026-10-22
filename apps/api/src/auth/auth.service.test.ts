import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, mock, test } from 'node:test'
import { ServiceUnavailableException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { AuthService } from './auth.service.js'
import { AuthProviderError, type AuthSessionProvider } from './auth-session.provider.js'
import { KratosSessionProvider } from './kratos-session.provider.js'
import { KratosService } from './kratos.service.js'
import { OptionalSessionGuard, SessionGuard } from './session.guard.js'

afterEach(() => mock.restoreAll())
const identity = { id: randomUUID(), handle: 'ada' }

function setup(ttl = 30) {
  const entries = new Map<string, string>()
  const cache = {
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: string) => { entries.set(key, value) },
    delete: async (key: string) => { entries.delete(key) },
  }
  const adapter = new KratosSessionProvider(new KratosService({
    KRATOS_PUBLIC_URL: 'http://kratos.test', WHOAMI_CACHE_TTL_S: ttl,
  }, cache))
  return { auth: new AuthService({ kratos: adapter }), adapter, entries }
}
const valid = () => Response.json({ active: true, identity: { id: identity.id, traits: { handle: identity.handle } } })

test('adapter preserves credential bytes and forwards only its cookie', async () => {
  const fetch = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.deepEqual(init?.headers, { cookie: 'hn_session=a%2Fb==', accept: 'application/json' })
    return valid()
  })
  const { auth } = setup()
  assert.deepEqual(await auth.identityForRequest({ cookieHeader: 'other=secret; hn_session=a%2Fb==', authorizationHeader: 'Bearer unrelated' }), identity)
  assert.equal(fetch.mock.callCount(), 1)
})

test('missing, empty and duplicate cookies are anonymous without provider calls', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => valid())
  const { auth } = setup()
  for (const cookieHeader of [undefined, 'other=value', 'hn_session=', 'hn_session=a; hn_session=b']) {
    assert.equal(await auth.identityForRequest({ cookieHeader }), null)
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test('provider rejects credentials and inactive identities as anonymous', async () => {
  for (const response of [new Response(null, { status: 401 }), new Response(null, { status: 403 }), Response.json({ active: false, identity: { id: identity.id, traits: { handle: 'ada' } } })]) {
    mock.method(globalThis, 'fetch', async () => response)
    assert.equal(await setup().auth.identityForRequest({ cookieHeader: 'hn_session=bad' }), null)
    mock.restoreAll()
  }
})

test('cached lookup is reused; invalidation asks the provider again without claiming logout', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => valid())
  const { auth } = setup()
  const request = { cookieHeader: 'hn_session=good' }
  await auth.identityForRequest(request)
  await auth.identityForRequest(request)
  assert.equal(fetch.mock.callCount(), 1)
  await auth.invalidateSessionCache(request)
  assert.deepEqual(await auth.identityForRequest(request), identity)
  assert.equal(fetch.mock.callCount(), 2)
})

test('provider failures stay distinct from anonymous and are normalised for the API', async () => {
  for (const [kind, response] of [
    ['unavailable', () => { throw new Error('network') }],
    ['unavailable', () => new Response(null, { status: 500 })],
    ['protocol', () => Response.json({ unexpected: true })],
    ['protocol', () => new Response('not json')],
  ] as const) {
    mock.method(globalThis, 'fetch', async () => response())
    await assert.rejects(setup().auth.identityForRequest({ cookieHeader: 'hn_session=good' }), (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException)
      assert.equal((error.getResponse() as { code: string }).code, `auth_provider_${kind}`)
      return true
    })
    mock.restoreAll()
  }
})

test('protected guard rejects provider failure; optional guard keeps anonymous public-read fallback', async () => {
  const provider: AuthSessionProvider = {
    hasCredentials: () => true,
    authenticate: async () => { throw new AuthProviderError('unavailable') },
    invalidateSessionCache: async () => {},
  }
  const auth = new AuthService({ kratos: provider })
  // Neither guard may reach application membership storage on provider failure.
  const db = undefined as unknown as ConstructorParameters<typeof SessionGuard>[2]
  const invites = undefined as unknown as ConstructorParameters<typeof SessionGuard>[3]
  const request = { method: 'GET', headers: {} }
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext
  await assert.rejects(new SessionGuard(auth, { WEB_PUBLIC_URL: 'http://app.test' }, db, invites).canActivate(context), ServiceUnavailableException)
  assert.equal(await new OptionalSessionGuard(auth, { WEB_PUBLIC_URL: 'http://app.test' }, db, invites).canActivate(context), true)
  assert.ok(!('member' in request))
})

test('identity keeps provider identifiers at the top level and Kratos data nested', async () => {
  mock.method(globalThis, 'fetch', async () => valid())
  assert.deepEqual(await setup().adapter.authenticate({ cookieHeader: 'hn_session=good' }), {
    status: 'authenticated',
    identity: { providerId: 'kratos', subject: identity.id, providerKind: 'kratos', details: identity },
  })
})

test('routing selects by credential presence and never falls back after rejection or failure', async () => {
  let unrelatedCalls = 0
  const selected: AuthSessionProvider = {
    hasCredentials: (request) => request.authorizationHeader !== undefined,
    authenticate: async () => ({ status: 'anonymous' }),
    invalidateSessionCache: async () => {},
  }
  const unrelated: AuthSessionProvider = {
    hasCredentials: () => false,
    authenticate: async () => { unrelatedCalls++; return { status: 'anonymous' } },
    invalidateSessionCache: async () => { unrelatedCalls++ },
  }
  const auth = new AuthService({ selected, unrelated })
  const request = { authorizationHeader: 'Bearer invalid' }
  assert.equal(await auth.identityForRequest(request), null)
  selected.authenticate = async () => { throw new AuthProviderError('unavailable') }
  await assert.rejects(auth.identityForRequest(request), ServiceUnavailableException)
  await auth.invalidateSessionCache(request)
  assert.equal(unrelatedCalls, 0)
})

test('conflicting credentials are rejected before any provider is called', async () => {
  let calls = 0
  const provider: AuthSessionProvider = {
    hasCredentials: () => true,
    authenticate: async () => { calls++; return { status: 'anonymous' } },
    invalidateSessionCache: async () => { calls++ },
  }
  const auth = new AuthService({ first: provider, second: provider })
  await assert.rejects(auth.identityForRequest({}), UnauthorizedException)
  await assert.rejects(auth.invalidateSessionCache({}), UnauthorizedException)
  assert.equal(calls, 0)
})

test('provider cannot return an identity under another registry entry or use an unmapped instance', async () => {
  mock.method(globalThis, 'fetch', async () => valid())
  const { adapter } = setup()
  const request = { cookieHeader: 'hn_session=good' }
  await assert.rejects(new AuthService({ impostor: adapter }).identityForRequest(request), ServiceUnavailableException)
  const unmapped: AuthSessionProvider = {
    hasCredentials: () => true,
    authenticate: async () => ({ status: 'authenticated', identity: {
      providerId: 'second-kratos', providerKind: 'kratos', subject: identity.id, details: identity,
    } }),
    invalidateSessionCache: async () => {},
  }
  await assert.rejects(new AuthService({ 'second-kratos': unmapped }).identityForRequest(request), ServiceUnavailableException)
})
