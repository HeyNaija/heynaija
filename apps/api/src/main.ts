import 'reflect-metadata'
import fastifyCookie from '@fastify/cookie'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './app.module.js'
import type { Env } from './env.js'
import { ENV } from './tokens.js'

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
await app.register(fastifyCookie)

const env = app.get<Env>(ENV)
// Bind to loopback in dev; a deployed API sits behind the reverse proxy.
await app.listen(env.API_PORT, '127.0.0.1')
