// Real flow controller/service/adapter against the fixture Kratos HTTP server.
// No database, Redis or real accounts are used by this focused browser suite.
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url))
require('reflect-metadata')
const { Module } = require('@nestjs/common')
const { NestFactory } = require('@nestjs/core')
const { FastifyAdapter } = require('@nestjs/platform-fastify')
const { AuthFlowsController } = await import('../../apps/api/dist/auth/auth-flows.controller.js')
const { registerAuthFormParser } = await import('../../apps/api/dist/auth/auth-form-parser.js')
const { AuthService } = await import('../../apps/api/dist/auth/auth.service.js')
const { KratosFlowProvider } = await import('../../apps/api/dist/auth/kratos-flow.provider.js')
const { KratosAccountProvider } = await import('../../apps/api/dist/auth/kratos-account.provider.js')
const { KratosLifecycleProvider } = await import('../../apps/api/dist/auth/kratos-lifecycle.provider.js')
const { KratosSessionProvider } = await import('../../apps/api/dist/auth/kratos-session.provider.js')
const { KratosService } = await import('../../apps/api/dist/auth/kratos.service.js')
const { ENV } = await import('../../apps/api/dist/tokens.js')
const env = { KRATOS_PUBLIC_URL: 'http://127.0.0.1:4407', WEB_PUBLIC_URL: 'http://127.0.0.1:3307', AUTH_EXTERNAL_REDIRECT_ORIGINS: ['https://accounts.google.com'], WHOAMI_CACHE_TTL_S: 0 }
const flows = new KratosFlowProvider(env)
const kratos = new KratosSessionProvider(new KratosService(env, { get: async () => null, set: async () => {}, delete: async () => {} }))
const account = new KratosAccountProvider(new KratosService(env, { get: async () => null, set: async () => {}, delete: async () => {} }), kratos, flows)
const lifecycle = new KratosLifecycleProvider()
const auth = new AuthService({ kratos: Object.assign(kratos, { account, flows, lifecycle }) })
class FixtureModule {}
Module({ controllers: [AuthFlowsController], providers: [{ provide: AuthService, useValue: auth }, { provide: ENV, useValue: env }] })(FixtureModule)
const app = await NestFactory.create(FixtureModule, new FastifyAdapter(), { logger: false })
const server = app.getHttpAdapter().getInstance()
registerAuthFormParser(app)
server.all('/v1/*', async (req, reply) => {
  const response = await fetch(`http://127.0.0.1:4407${req.url}`, {
    method: req.method, headers: { 'content-type': 'application/json', ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}) },
    ...(req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}),
  })
  reply.code(response.status)
  if (response.status === 204) return reply.send()
  return reply.send(await response.json())
})
await app.listen(4408, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0) })
