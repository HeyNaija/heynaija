import { createDb, type Db } from '@heynaija/db'
import { Global, Module } from '@nestjs/common'
import { AuthService } from './auth/auth.service.js'
import { AUTH_SESSION_PROVIDER } from './auth/auth-session.provider.js'
import { KratosAdmin } from './auth/kratos-admin.js'
import { KratosSessionProvider } from './auth/kratos-session.provider.js'
import { KratosService } from './auth/kratos.service.js'
import { RedisSessionCache, SESSION_CACHE } from './auth/session-cache.js'
import { OptionalSessionGuard, SessionGuard, SuspendedAllowedGuard } from './auth/session.guard.js'
import { type Env, loadEnv } from './env.js'
import { FeatureFlags } from './flags/feature-flags.js'
import { FeatureGuard } from './flags/feature.guard.js'
import { InvitesService } from './invites/invites.service.js'
import { RateLimiter, RedisRateLimiter } from './rate-limit.js'
import { DB, ENV } from './tokens.js'

const providers = [
  { provide: ENV, useFactory: loadEnv },
  { provide: DB, useFactory: (env: Env) => createDb(env.DATABASE_URL).db, inject: [ENV] },
  { provide: SESSION_CACHE, useClass: RedisSessionCache },
  KratosService,
  KratosAdmin,
  { provide: AUTH_SESSION_PROVIDER, useClass: KratosSessionProvider },
  AuthService,
  SessionGuard,
  OptionalSessionGuard,
  SuspendedAllowedGuard,
  InvitesService,
  // Runtime feature flags, per APP_ENV (docs/feature-flags.md).
  { provide: FeatureFlags, useFactory: (db: Db, env: Env) => new FeatureFlags(db, env.APP_ENV), inject: [DB, ENV] },
  FeatureGuard,
  { provide: RateLimiter, useClass: RedisRateLimiter },
]

/**
 * What every part of the API needs: settings, the database, who is signed in,
 * feature flags and rate limits. Global, so feature modules (games/, docs/adr/0018)
 * can use them without AppModule having to know about each one. One instance of
 * each, shared.
 */
@Global()
@Module({
  providers,
  exports: providers.map((p) => ('provide' in p ? p.provide : p)),
})
export class PlatformModule {}
