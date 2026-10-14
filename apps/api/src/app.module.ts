import { createDb } from '@heynaija/db'
import { Controller, Get, Module } from '@nestjs/common'
import { AuthController } from './auth/auth.controller.js'
import { KratosService } from './auth/kratos.service.js'
import { OptionalSessionGuard, SessionGuard, SuspendedAllowedGuard } from './auth/session.guard.js'
import { CommunitiesController } from './communities/communities.controller.js'
import { CommunitiesService } from './communities/communities.service.js'
import { type Env, loadEnv } from './env.js'
import { InvitesService } from './invites/invites.service.js'
import { MembersController } from './members/members.controller.js'
import { MembersService } from './members/members.service.js'
import { ModerationController } from './moderation/moderation.controller.js'
import { ModerationService } from './moderation/moderation.service.js'
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
  controllers: [HealthController, AuthController, PostsController, MembersController, CommunitiesController, SearchController, ModerationController],
  providers: [
    { provide: ENV, useFactory: loadEnv },
    { provide: DB, useFactory: (env: Env) => createDb(env.DATABASE_URL).db, inject: [ENV] },
    KratosService,
    SessionGuard,
    OptionalSessionGuard,
    SuspendedAllowedGuard,
    RateLimiter,
    ModerationService,
    MembersService,
    CommunitiesService,
    InvitesService,
    PostsService,
  ],
})
export class AppModule {}
