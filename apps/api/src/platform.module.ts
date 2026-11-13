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
import { BullMediaJobs } from './media/media-queue.js'
import { MEDIA_URLS, MediaUrls } from './media/media-urls.js'
import { MEDIA_JOBS } from './media/media.service.js'
import { PostsService } from './posts/posts.service.js'
import { RateLimiter, RedisRateLimiter } from './rate-limit.js'
import { DB, ENV } from './tokens.js'
import { type VideoConfig, videoConfig } from './video/video-config.js'
import { VIDEO_CONFIG } from './video/video.service.js'

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
  // Posts, which Games also writes (The Arbiter's threads and results, docs/adr/0018), and what
  // PostsService asks for. Those are optional to it, so one left in AppModule, where this module
  // cannot see it, would be quietly missing: video limits at their defaults, a sensitive post's
  // files never moved to private storage, and its links signed with a key nothing accepts.
  { provide: VIDEO_CONFIG, useFactory: (env: Env) => videoConfig(env), inject: [ENV] },
  { provide: MEDIA_JOBS, useClass: BullMediaJobs },
  // Signed URLs for the files of posts marked sensitive (docs/adr/0025), keyed from the storage secret
  // only the API holds, so no new setting is needed; absolute on the site for video.
  {
    provide: MEDIA_URLS,
    useFactory: (env: Env, cfg: VideoConfig) => new MediaUrls(env.S3_SECRET_ACCESS_KEY, env.WEB_PUBLIC_URL, cfg.filesBase),
    inject: [ENV, VIDEO_CONFIG],
  },
  PostsService,
]

/**
 * What every part of the API needs: settings, the database, who is signed in,
 * feature flags, rate limits and posts (with the video settings, media queue and signed
 * media addresses posts need). Global, so feature modules (games/, docs/adr/0018)
 * can use them without AppModule having to know about each one. One instance of
 * each, shared.
 */
@Global()
@Module({
  providers,
  exports: providers.map((p) => ('provide' in p ? p.provide : p)),
})
export class PlatformModule {}
