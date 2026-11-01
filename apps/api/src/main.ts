import 'reflect-metadata'
import fastifyCookie from '@fastify/cookie'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './app.module.js'
import type { Env } from './env.js'
import { ENV } from './tokens.js'

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
await app.register(fastifyCookie)
// LiveKit signs the exact bytes of its webhook bodies, so that one content type is kept as a raw string.
app
  .getHttpAdapter()
  .getInstance()
  .addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) => done(null, body))

const env = app.get<Env>(ENV)
// Loopback in dev; inside the deployment's private Docker network otherwise.
await app.listen(env.API_PORT, env.API_HOST)
