import 'reflect-metadata'
import fastifyCookie from '@fastify/cookie'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { registerAuthFormParser } from './auth/auth-form-parser.js'
import { AppModule } from './app.module.js'
import type { Env } from './env.js'
import { ENV } from './tokens.js'

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
await app.register(fastifyCookie)
registerAuthFormParser(app)

const env = app.get<Env>(ENV)
// Loopback in dev; inside the deployment's private Docker network otherwise.
await app.listen(env.API_PORT, env.API_HOST)
