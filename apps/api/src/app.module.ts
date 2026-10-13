import { createDb } from '@heynaija/db'
import { Controller, Get, Module } from '@nestjs/common'
import { AuthController } from './auth/auth.controller.js'
import { KratosService } from './auth/kratos.service.js'
import { SessionGuard } from './auth/session.guard.js'
import { type Env, loadEnv } from './env.js'
import { InvitesService } from './invites/invites.service.js'
import { PostsController } from './posts/posts.controller.js'
import { PostsService } from './posts/posts.service.js'
import { DB, ENV } from './tokens.js'

@Controller()
class HealthController {
  @Get('healthz')
  health() {
    return { ok: true }
  }
}

@Module({
  controllers: [HealthController, AuthController, PostsController],
  providers: [
    { provide: ENV, useFactory: loadEnv },
    { provide: DB, useFactory: (env: Env) => createDb(env.DATABASE_URL).db, inject: [ENV] },
    KratosService,
    SessionGuard,
    InvitesService,
    PostsService,
  ],
})
export class AppModule {}
