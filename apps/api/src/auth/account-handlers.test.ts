import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, mock, test } from 'node:test'
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { ExportController } from '../export/export.controller.js'
import type { ExportService } from '../export/export.service.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { KratosSessionProvider } from './kratos-session.provider.js'
import { KratosService } from './kratos.service.js'
import type { AuthedRequest } from './session.guard.js'

// The export and logout handlers, through AuthService and the Kratos adapter
// with fetch standing in for Kratos.
afterEach(() => mock.restoreAll())
const member = { id: randomUUID(), handle: 'ada' }
const cookieHeader = 'other=private; hn_session=good'
const request = { headers: { cookie: cookieHeader }, member } as AuthedRequest

function setup() {
  const entries = new Map<string, string>()
  const cache = {
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: string) => { entries.set(key, value) },
    delete: async (key: string) => { entries.delete(key) },
  }
  const kratos = new KratosService({ KRATOS_PUBLIC_URL: 'http://kratos.test', WHOAMI_CACHE_TTL_S: 30 }, cache)
  return { auth: new AuthService(new KratosSessionProvider(kratos)), entries }
}

// Logout uses only AuthService; the registration webhooks' services are not touched.
const logoutController = (auth: AuthService) =>
  new AuthController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, auth, {} as never, {} as never, {} as never)

test('export reads the current email from Kratos even when the identity is cached', async () => {
  let email = 'old@example.test'
  const fetch = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>).cookie, 'hn_session=good')
    return Response.json({ active: true, identity: { id: member.id, traits: { handle: member.handle, email } } })
  })
  const { auth } = setup()
  await auth.identityForRequest({ cookieHeader })
  email = 'new@example.test'
  const data = { format: 'export-fixture' } as unknown as NonNullable<Awaited<ReturnType<ExportService['export']>>>
  let limited = false
  const controller = new ExportController({
    export: async (id, currentEmail) => {
      assert.equal(limited, true)
      assert.equal(id, member.id)
      assert.equal(currentEmail, email)
      return data
    },
  }, auth, {
    hit: async (bucket, id) => {
      assert.equal(bucket, 'export')
      assert.equal(id, member.id)
      limited = true
    },
  })
  assert.equal(await controller.export(request), data)
  assert.equal(fetch.mock.callCount(), 2)
})

test('export goes ahead without an email once the session has ended, and 404s for a missing member', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }))
  const controller = new ExportController({
    export: async (_id, email) => {
      assert.equal(email, null)
      return null
    },
  }, setup().auth, { hit: async () => {} })
  await assert.rejects(controller.export(request), NotFoundException)
})

test('export fails with a 503, not a partial export, when Kratos cannot give the email', async () => {
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

test('logout drops the cached identity without ending the Kratos session', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({
    active: true, identity: { id: member.id, traits: { handle: member.handle } },
  }))
  const { auth, entries } = setup()
  await auth.identityForRequest({ cookieHeader })
  assert.equal(entries.size, 1)
  assert.equal(await logoutController(auth).logout(request), undefined)
  assert.equal(entries.size, 0)
  assert.equal(fetch.mock.callCount(), 1)
  assert.deepEqual(await auth.identityForRequest({ cookieHeader }), member)
  assert.equal(fetch.mock.callCount(), 2)
})

test('without a session cookie, logout does nothing and there is no email to read', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not call Kratos') })
  const { auth } = setup()
  await logoutController(auth).logout({ headers: {} } as FastifyRequest)
  for (const header of [undefined, 'hn_session=', 'hn_session=a; hn_session=b']) {
    assert.equal(await auth.emailForRequest({ cookieHeader: header }), null)
  }
  assert.equal(fetch.mock.callCount(), 0)
})
