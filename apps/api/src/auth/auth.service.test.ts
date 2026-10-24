import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, mock, test } from 'node:test'
import { type ExecutionContext, ServiceUnavailableException } from '@nestjs/common'
import { AuthService } from './auth.service.js'
import { AuthProviderError, type AuthSessionProvider } from './auth-session.provider.js'
import { KratosSessionProvider } from './kratos-session.provider.js'
import { KratosService } from './kratos.service.js'
import { OptionalSessionGuard, SessionGuard } from './session.guard.js'

afterEach(() => mock.restoreAll())
const identity = { id: randomUUID(), handle: 'ada' }

// The real adapter and KratosService, with fetch standing in for Kratos.
function setup() {
  const entries = new Map<string, string>()
  const cache = {
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: string) => { entries.set(key, value) },
    delete: async (key: string) => { entries.delete(key) },
  }
  const kratos = new KratosService({ KRATOS_PUBLIC_URL: 'http://kratos.test', WHOAMI_CACHE_TTL_S: 30 }, cache)
  return new AuthService(new KratosSessionProvider(kratos))
}
const valid = () => Response.json({ active: true, identity: { id: identity.id, traits: { handle: identity.handle } } })

test('only the session cookie reaches Kratos, byte for byte', async () => {
  const fetch = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.deepEqual(init?.headers, { cookie: 'hn_session=a%2Fb==', accept: 'application/json' })
    return valid()
  })
  assert.deepEqual(await setup().identityForRequest({ cookieHeader: 'other=secret; hn_session=a%2Fb==' }), identity)
  assert.equal(fetch.mock.callCount(), 1)
})

test('a missing, empty or doubled session cookie is anonymous without asking Kratos', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => valid())
  const auth = setup()
  for (const cookieHeader of [undefined, 'other=value', 'hn_session=', 'hn_session=a; hn_session=b']) {
    assert.equal(await auth.identityForRequest({ cookieHeader }), null)
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test('a session Kratos rejects, or an inactive one, is anonymous', async () => {
  for (const response of [
    new Response(null, { status: 401 }),
    new Response(null, { status: 403 }),
    Response.json({ active: false, identity: { id: identity.id, traits: { handle: 'ada' } } }),
  ]) {
    mock.method(globalThis, 'fetch', async () => response)
    assert.equal(await setup().identityForRequest({ cookieHeader: 'hn_session=bad' }), null)
    mock.restoreAll()
  }
})

test('a cached lookup is reused; invalidating it asks Kratos again without ending the session', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => valid())
  const auth = setup()
  const request = { cookieHeader: 'hn_session=good' }
  await auth.identityForRequest(request)
  await auth.identityForRequest(request)
  assert.equal(fetch.mock.callCount(), 1)
  await auth.invalidateSessionCache(request)
  assert.deepEqual(await auth.identityForRequest(request), identity)
  assert.equal(fetch.mock.callCount(), 2)
})

test('Kratos being down or answering nonsense is a 503, never anonymous', async () => {
  for (const [kind, response] of [
    ['unavailable', () => { throw new Error('network') }],
    ['unavailable', () => new Response(null, { status: 500 })],
    ['protocol', () => Response.json({ unexpected: true })],
    ['protocol', () => new Response('not json')],
  ] as const) {
    mock.method(globalThis, 'fetch', async () => response())
    await assert.rejects(setup().identityForRequest({ cookieHeader: 'hn_session=good' }), (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException)
      assert.equal((error.getResponse() as { code: string }).code, `auth_provider_${kind}`)
      return true
    })
    mock.restoreAll()
  }
})

test('a provider failure stops the protected guard; the optional guard still serves the page signed out', async () => {
  const provider: AuthSessionProvider = {
    identityForRequest: async () => { throw new AuthProviderError('unavailable') },
    invalidateSessionCache: async () => {},
    emailForRequest: async () => null,
  }
  const auth = new AuthService(provider)
  // Neither guard may reach membership storage when the provider fails.
  const db = undefined as unknown as ConstructorParameters<typeof SessionGuard>[2]
  const invites = undefined as unknown as ConstructorParameters<typeof SessionGuard>[3]
  const request = { method: 'GET', headers: {} }
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext
  await assert.rejects(new SessionGuard(auth, { WEB_PUBLIC_URL: 'http://app.test' }, db, invites).canActivate(context), ServiceUnavailableException)
  assert.equal(await new OptionalSessionGuard(auth, { WEB_PUBLIC_URL: 'http://app.test' }, db, invites).canActivate(context), true)
  assert.ok(!('member' in request))
})

test('errors that are not the provider’s pass through unchanged', async () => {
  const failure = new Error('unrelated failure')
  const auth = new AuthService(new KratosSessionProvider({
    identityForSession: async () => { throw failure },
    forgetSession: async () => {},
    emailForSession: async () => null,
  }))
  await assert.rejects(auth.identityForRequest({ cookieHeader: 'hn_session=good' }), (error: unknown) => error === failure)
})
