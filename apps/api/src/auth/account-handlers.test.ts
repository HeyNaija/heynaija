import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, mock, test } from 'node:test'
import { NotFoundException, NotImplementedException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { ExportController } from '../export/export.controller.js'
import type { ExportService } from '../export/export.service.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { KratosSessionProvider } from './kratos-session.provider.js'
import { KratosService } from './kratos.service.js'
import { KratosAccountProvider } from './kratos-account.provider.js'
import { KratosFlowProvider } from './kratos-flow.provider.js'
import type { AuthedRequest } from './session.guard.js'

afterEach(() => mock.restoreAll())
const member = { id: randomUUID(), handle: 'ada' }
const credentials = { cookieHeader: 'other=private; hn_session=good', authorizationHeader: 'Bearer unrelated' }
const request = {
  headers: { cookie: credentials.cookieHeader, authorization: credentials.authorizationHeader },
  member,
} as AuthedRequest

function setup() {
  const entries = new Map<string, string>()
  const cache = {
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: string) => { entries.set(key, value) },
    delete: async (key: string) => { entries.delete(key) },
  }
  const kratos = new KratosService({ KRATOS_PUBLIC_URL: 'http://kratos.test', WHOAMI_CACHE_TTL_S: 30 }, cache)
  const sessions = new KratosSessionProvider(kratos)
  const account = new KratosAccountProvider(kratos, sessions, new KratosFlowProvider({
    KRATOS_PUBLIC_URL: 'http://kratos.test', WEB_PUBLIC_URL: 'http://app.test', AUTH_EXTERNAL_REDIRECT_ORIGINS: ['https://accounts.google.com'],
  }))
  return { auth: new AuthService({ kratos: Object.assign(sessions, { account }) }), entries }
}

function logoutController(auth: AuthService) {
  // This endpoint uses only AuthService; registration dependencies are not touched.
  return new AuthController({} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, auth, {} as never, {} as never)
}

test('export forwards credentials through AuthService and reads fresh private email after cached authentication', async () => {
  let email = 'old@example.test'
  const fetch = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>).cookie, 'hn_session=good')
    return Response.json({ active: true, identity: { id: member.id, traits: { handle: member.handle, email } } })
  })
  const { auth } = setup()
  await auth.identityForRequest(credentials)
  email = 'new@example.test'
  const data = { format: 'export-fixture' } as unknown as NonNullable<Awaited<ReturnType<ExportService['export']>>>
  let limited = false
  const controller = new ExportController({ export: async (id, currentEmail) => {
    assert.equal(limited, true)
    assert.equal(id, member.id)
    assert.equal(currentEmail, email)
    return data
  } }, auth, { hit: async (bucket, id) => {
    assert.equal(bucket, 'export')
    assert.equal(id, member.id)
    limited = true
  } })
  assert.equal(await controller.export(request), data)
  assert.equal(fetch.mock.callCount(), 2)
})

test('export retains null email for ended sessions and 404 for a missing member', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }))
  const controller = new ExportController({ export: async (_id, email) => {
    assert.equal(email, null)
    return null
  } }, setup().auth, { hit: async () => {} })
  await assert.rejects(controller.export(request), NotFoundException)
})

test('email lookup preserves provider/protocol errors and does not return a partial export', async () => {
  for (const response of [new Response(null, { status: 503 }), Response.json({ unexpected: true })]) {
    mock.method(globalThis, 'fetch', async () => response)
    let exported = false
    const controller = new ExportController({ export: async () => { exported = true; return null } },
      setup().auth, { hit: async () => {} })
    await assert.rejects(controller.export(request), ServiceUnavailableException)
    assert.equal(exported, false)
    mock.restoreAll()
  }
})

test('logout handler evicts the selected cached identity without revoking the provider session', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({
    active: true, identity: { id: member.id, traits: { handle: member.handle } },
  }))
  const { auth, entries } = setup()
  await auth.identityForRequest(credentials)
  assert.equal(entries.size, 1)
  assert.equal(await logoutController(auth).logout(request), undefined)
  assert.equal(entries.size, 0)
  assert.equal(fetch.mock.callCount(), 1)
  assert.deepEqual(await auth.identityForRequest(credentials), member)
  assert.equal(fetch.mock.callCount(), 2)
})

test('missing credentials make logout a no-op and email lookup null', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not call provider') })
  const { auth } = setup()
  await logoutController(auth).logout({ headers: {} } as FastifyRequest)
  for (const cookieHeader of [undefined, 'hn_session=', 'hn_session=a; hn_session=b']) {
    assert.equal(await auth.emailForRequest({ cookieHeader }), null)
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test('email lookup and invalidation reject conflicting credentials; unsupported email reads fail explicitly', async () => {
  const provider = {
    hasCredentials: () => true,
    authenticate: async () => ({ status: 'anonymous' as const }),
    invalidateSessionCache: async () => { throw new Error('must not invalidate') },
  }
  const auth = new AuthService({ first: provider, second: provider })
  await assert.rejects(auth.emailForRequest(credentials), UnauthorizedException)
  await assert.rejects(logoutController(auth).logout(request), UnauthorizedException)
  await assert.rejects(new AuthService({ first: provider }).emailForRequest(credentials), NotImplementedException)
})
