import { createDb } from '@heynaija/db'
import { Controller, Get, Module } from '@nestjs/common'
import { AuthController } from './auth/auth.controller.js'
import { KratosService } from './auth/kratos.service.js'
import { RedisSessionCache, SESSION_CACHE } from './auth/session-cache.js'
import { OptionalSessionGuard, SessionGuard, SuspendedAllowedGuard } from './auth/session.guard.js'
import { CommunitiesController } from './communities/communities.controller.js'
import { CommunitiesService } from './communities/communities.service.js'
import { type Env, loadEnv } from './env.js'
import { ExportController } from './export/export.controller.js'
import { ExportService } from './export/export.service.js'
import { GovernanceController } from './governance/governance.controller.js'
import { GovernanceService } from './governance/governance.service.js'
import { InvitesService } from './invites/invites.service.js'
import { MediaController, PostImagesController } from './media/media.controller.js'
import { BullMediaJobs, MediaWorker } from './media/media-queue.js'
import { CONTENT_SCANNER, MEDIA_JOBS, MediaService, NoScanner, OBJECT_STORE } from './media/media.service.js'
import { S3ObjectStore } from './media/object-store.js'
import { s3Config } from './media/s3-config.js'
import { MembersController, OwnProfileController } from './members/members.controller.js'
import { MembersService } from './members/members.service.js'
import { ModerationController } from './moderation/moderation.controller.js'
import { ModerationService } from './moderation/moderation.service.js'
import { NotificationsController } from './notifications/notifications.controller.js'
import { NotificationsService } from './notifications/notifications.service.js'
import { PostsController } from './posts/posts.controller.js'
import { PostsService } from './posts/posts.service.js'
import { RateLimiter } from './rate-limit.js'
import { SearchController } from './search/search.controller.js'
import { DB, ENV } from './tokens.js'

@Controller()
class HealthController {
  @Get('healthz')
  health() {
    return { ok: true }
  }
}

@Module({
  controllers: [HealthController, AuthController, PostsController, MembersController, OwnProfileController, CommunitiesController, SearchController, ModerationController, MediaController, PostImagesController, NotificationsController, ExportController, GovernanceController],
  providers: [
    { provide: ENV, useFactory: loadEnv },
    { provide: DB, useFactory: (env: Env) => createDb(env.DATABASE_URL).db, inject: [ENV] },
    { provide: SESSION_CACHE, useClass: RedisSessionCache },
    KratosService,
    SessionGuard,
    OptionalSessionGuard,
    SuspendedAllowedGuard,
    RateLimiter,
    ModerationService,
    { provide: OBJECT_STORE, useFactory: (env: Env) => new S3ObjectStore(s3Config(env)), inject: [ENV] },
    { provide: MEDIA_JOBS, useClass: BullMediaJobs },
    // No real abuse-material scanner yet; see docs/safety/abuse-material-scanning.md.
    { provide: CONTENT_SCANNER, useClass: NoScanner },
    MediaService,
    MediaWorker,
    MembersService,
    CommunitiesService,
    InvitesService,
    PostsService,
    NotificationsService,
    ExportService,
    GovernanceService,
  ],
})
export class AppModule {}
