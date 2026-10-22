import 'reflect-metadata'
import assert from 'node:assert/strict'
import { after, afterEach, before, mock, test } from 'node:test'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AuthFlowsController } from './auth-flows.controller.js'
import { AuthService } from './auth.service.js'
import { KratosFlowProvider } from './kratos-flow.provider.js'
import { registerAuthFormParser } from './auth-form-parser.js'
import { ENV } from '../tokens.js'

const WEB = 'http://app.test'
const env = { KRATOS_PUBLIC_URL: 'http://kratos.test', WEB_PUBLIC_URL: WEB, AUTH_EXTERNAL_REDIRECT_ORIGINS: ['https://accounts.google.com'] }
const flows = new KratosFlowProvider(env)
let evictions = 0
const auth = new AuthService({ kratos: {
  hasCredentials: (request) => Boolean(request.cookieHeader?.includes('hn_session=')),
  authenticate: async () => ({ status: 'anonymous' }),
  invalidateSessionCache: async () => { evictions++ },
  account: {
    capabilities: { emailRead: true, accountChanges: true },
    emailForRequest: async () => 'ada@example.test',
    beginAccountChange: (request: import('./auth-flow.provider.js').AuthFlowRequest) => flows.begin('settings', request),
  },
  flows,
} })
@Module({ controllers: [AuthFlowsController], providers: [{ provide: AuthService, useValue: auth }, { provide: ENV, useValue: env }] })
class TestModule {}
let app: NestFastifyApplication
before(async () => {
  app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false })
  registerAuthFormParser(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})
after(async () => { await app?.close() })
afterEach(() => mock.restoreAll())
const form = (id = 'one', action = `${WEB}/kratos/self-service/login?flow=${id}`) => ({
  id, ui: { action, method: 'POST', nodes: [{ type: 'input', group: 'default', attributes: { name: 'csrf_token', type: 'hidden', value: 'secret' }, messages: [] }] },
})

test('begin forwards raw cookies and preserves separate Set-Cookie headers and redirect', async () => {
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://kratos.test/self-service/registration/browser')
    assert.equal((init.headers as Record<string, string>).cookie, 'hn_invite=invite; csrf=raw%2Fvalue')
    assert.equal(init.redirect, 'manual')
    const headers = new Headers({ location: `${WEB}/signup?flow=one` })
    headers.append('set-cookie', 'csrf=one; HttpOnly; Path=/; SameSite=Lax')
    headers.append('set-cookie', 'other=two; HttpOnly; Path=/')
    return new Response(null, { status: 303, headers })
  })
  const response = await app.inject({ url: '/v1/auth/flows/registration/start', headers: { cookie: 'hn_invite=invite; csrf=raw%2Fvalue' } })
  assert.equal(response.statusCode, 303)
  assert.equal(response.headers.location, '/signup?flow=one')
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.cookies.length, 2)
})

test('resume returns a provider-tagged form with the application submission URL', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json(form()))
  const response = await app.inject('/v1/auth/flows/login?flow=one')
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().providerKind, 'kratos')
  assert.equal(response.json().form.ui.action, '/api/v1/auth/flows/login?flow=one')
  assert.equal(response.json().form.ui.nodes[0].attributes.value, 'secret')
})

test('resume rewrites a provider action with a stale flow query to the requested flow', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json(form('one', `${WEB}/kratos/self-service/login?flow=provider-copy`)))
  const response = await app.inject('/v1/auth/flows/login?flow=one')
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().form.ui.action, '/api/v1/auth/flows/login?flow=one')
})

test('expired or foreign flows restart, rather than returning provider fields', async () => {
  for (const status of [403, 404, 410]) {
    mock.method(globalThis, 'fetch', async () => new Response(null, { status }))
    const response = await app.inject('/v1/auth/flows/login?flow=one')
    assert.deepEqual(response.json(), { kind: 'redirect', location: '/api/v1/auth/flows/login/start', cookies: [] })
    mock.restoreAll()
  }
})

test('submission preserves form bytes and origin, and redirects to the same flow on validation errors', async () => {
  const body = 'csrf_token=raw%2Fvalue&code=bad&repeat=a&repeat=b'
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://kratos.test/self-service/login?flow=one')
    assert.equal(init.body, body)
    assert.equal((init.headers as Record<string, string>).origin, WEB)
    assert.equal((init.headers as Record<string, string>).cookie, 'csrf=raw%2Fvalue')
    return Response.json(form(), { status: 400 })
  })
  const response = await app.inject({ method: 'POST', url: '/v1/auth/flows/login?flow=one', payload: body,
    headers: { origin: WEB, cookie: 'csrf=raw%2Fvalue', 'content-type': 'application/x-www-form-urlencoded' } })
  assert.equal(response.statusCode, 303)
  assert.equal(response.headers.location, '/login?flow=one')
})

test('cross-origin submissions, unsupported flows and invalid bodies do not reach the provider', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not call') })
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/flows/login?flow=one', payload: 'code=1', headers: { origin: 'https://evil.test', 'content-type': 'application/x-www-form-urlencoded' } })).statusCode, 403)
  assert.equal((await app.inject('/v1/auth/flows/password/start')).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/flows/login?flow=one', payload: { code: 1 } })).statusCode, 400)
  assert.equal(fetch.mock.callCount(), 0)
})

test('settings reauthentication and Google redirects remain provider-owned', async () => {
  for (const location of [`${WEB}/kratos/self-service/login/browser?refresh=true`, 'https://accounts.google.com/o/oauth2/auth?state=opaque']) {
    mock.method(globalThis, 'fetch', async () => new Response(null, { status: 303, headers: { location } }))
    const response = await app.inject('/v1/auth/flows/settings/start')
    assert.equal(response.statusCode, 303)
    assert.equal(response.headers.location, location.startsWith(WEB) ? location.slice(WEB.length) : location)
    mock.restoreAll()
  }
})

test('untrusted submission and redirect targets fail closed', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json(form('one', 'https://evil.test/steal')))
  assert.equal((await app.inject('/v1/auth/flows/login?flow=one')).statusCode, 503)
  mock.restoreAll()
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 303, headers: { location: 'https://evil.test/' } }))
  assert.equal((await app.inject('/v1/auth/flows/login/start')).statusCode, 503)
  mock.restoreAll()
  for (const location of [`${WEB}//evil.test/x`, `${WEB}/\\evil.test/x`]) {
    mock.method(globalThis, 'fetch', async () => new Response(null, { status: 303, headers: { location } }))
    assert.equal((await app.inject('/v1/auth/flows/login/start')).statusCode, 503)
    mock.restoreAll()
  }
})

test('logout link exposes the application endpoint; completion evicts cache and relays cookie clearing', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ logout_url: `${WEB}/kratos/self-service/logout?token=opaque` }))
  assert.equal((await app.inject('/v1/auth/logout/link')).json().url, '/api/v1/auth/logout?token=opaque')
  mock.restoreAll()
  mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'http://kratos.test/self-service/logout?token=opaque')
    return new Response(null, { status: 303, headers: { location: `${WEB}/`, 'set-cookie': 'hn_session=; Max-Age=0; Path=/' } })
  })
  const before = evictions
  const response = await app.inject({ url: '/v1/auth/logout?token=opaque', headers: { cookie: 'hn_session=good' } })
  assert.equal(response.statusCode, 303)
  assert.equal(response.headers.location, '/')
  assert.equal(response.cookies[0]!.maxAge, 0)
  assert.equal(evictions, before + 2)
})

test('external test issuers require an explicitly configured origin', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 303, headers: { location: 'http://127.0.0.1:5099/authorize?state=one' } }))
  await assert.rejects(flows.begin('login', {}))
  const configured = new KratosFlowProvider({ ...env, AUTH_EXTERNAL_REDIRECT_ORIGINS: ['http://127.0.0.1:5099'] })
  assert.equal((await configured.begin('login', {})).location, 'http://127.0.0.1:5099/authorize?state=one')
})

test('expired submissions restart and backend failures do not claim completion', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 410 }))
  const options = { method: 'POST' as const, url: '/v1/auth/flows/login?flow=one', payload: 'code=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }
  assert.equal((await app.inject(options)).headers.location, '/api/v1/auth/flows/login/start')
  mock.restoreAll()
  mock.method(globalThis, 'fetch', async () => { throw new Error('network') })
  assert.equal((await app.inject(options)).statusCode, 503)
})

test('explicit reauthentication requests fresh login instead of accepting whoami', async () => {
  mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'http://kratos.test/self-service/login/browser?refresh=true')
    return new Response(null, { status: 303, headers: { location: `${WEB}/login?flow=fresh` } })
  })
  const response = await app.inject({ url: '/v1/auth/reauthenticate', headers: { cookie: 'hn_session=old' } })
  assert.equal(response.statusCode, 303)
  assert.equal(response.headers.location, '/login?flow=fresh')
})
