import { createDb } from '@heynaija/db'
import { Controller, Get, Module } from '@nestjs/common'
import { AuthFlowsController } from './auth/auth-flows.controller.js'
import { AUTH_DEFAULT_PROVIDER } from './auth/auth-flow.provider.js'
import { KratosAccountProvider } from './auth/kratos-account.provider.js'
import { KratosFlowProvider } from './auth/kratos-flow.provider.js'
import { KratosLifecycleProvider } from './auth/kratos-lifecycle.provider.js'
import { AuthController } from './auth/auth.controller.js'
import { AUTH_SESSION_PROVIDERS, type AuthRequest } from './auth/auth-session.provider.js'
import { AuthService } from './auth/auth.service.js'
import { KratosSessionProvider } from './auth/kratos-session.provider.js'
import { KratosService } from './auth/kratos.service.js'
import { IdentityMappingService } from './auth/identity-mapping.service.js'
import { RedisSessionCache, SESSION_CACHE } from './auth/session-cache.js'
import { OptionalSessionGuard, SessionGuard, SuspendedAllowedGuard } from './auth/session.guard.js'
import { CommunitiesController } from './communities/communities.controller.js'
import { CommunitiesService } from './communities/communities.service.js'
import { EMAIL_ADDRESSES, KratosAddresses } from './email/addresses.js'
import { EmailController } from './email/email.controller.js'
import { BullEmailJobs, EmailWorker } from './email/email-queue.js'
import { EMAIL_JOBS, EMAIL_SETTINGS, EmailNotificationsService } from './email/email-notifications.service.js'
import { MAILER, smtpMailer } from './email/mailer.js'
import { unsubscribeKey } from './email/unsubscribe-token.js'
import { type Env, loadEnv } from './env.js'
import { ExportController } from './export/export.controller.js'
import { ExportService } from './export/export.service.js'
import { GovernanceController } from './governance/governance.controller.js'
import { GovernanceService } from './governance/governance.service.js'
import { InvitesService } from './invites/invites.service.js'
import { BullLinkJobs, LinkWorker } from './links/link-queue.js'
import { LINK_JOBS, LinksService, PAGE_FETCHER } from './links/links.service.js'
import { SafeFetcher } from './links/safe-fetch.js'
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
import { OnboardingController } from './onboarding/onboarding.controller.js'
import { OnboardingService } from './onboarding/onboarding.service.js'
import { PostsController } from './posts/posts.controller.js'
import { PostsService } from './posts/posts.service.js'
import { PushController } from './push/push.controller.js'
import { PUSH_JOBS, PushNotificationsService } from './push/push-notifications.service.js'
import { BullPushJobs, PushWorker } from './push/push-queue.js'
import { PUSH_SENDER, webPushSender } from './push/push-sender.js'
import { RateLimiter, RedisRateLimiter } from './rate-limit.js'
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
  controllers: [AuthFlowsController, HealthController, AuthController, PostsController, MembersController, OwnProfileController, CommunitiesController, SearchController, ModerationController, MediaController, PostImagesController, NotificationsController, EmailController, PushController, ExportController, GovernanceController, OnboardingController],
  providers: [
    { provide: ENV, useFactory: loadEnv },
    { provide: DB, useFactory: (env: Env) => createDb(env.DATABASE_URL).db, inject: [ENV] },
    { provide: SESSION_CACHE, useClass: RedisSessionCache },
    KratosService,
    // Kratos is the only enabled provider; its subjects resolve through the
    // application mapping with a compatibility fallback until cutover.
    KratosSessionProvider,
    KratosFlowProvider,
    KratosAccountProvider,
    KratosLifecycleProvider,
    IdentityMappingService,
    { provide: AUTH_DEFAULT_PROVIDER, useValue: 'kratos' },
    {
      provide: AUTH_SESSION_PROVIDERS,
      useFactory: (kratos: KratosSessionProvider, flows: KratosFlowProvider, account: KratosAccountProvider, lifecycle: KratosLifecycleProvider) => ({
        kratos: {
          hasCredentials: (request: AuthRequest) => kratos.hasCredentials(request),
          authenticate: (request: AuthRequest) => kratos.authenticate(request),
          invalidateSessionCache: (request: AuthRequest) => kratos.invalidateSessionCache(request),
          account,
          flows,
          lifecycle,
        },
      }),
      inject: [KratosSessionProvider, KratosFlowProvider, KratosAccountProvider, KratosLifecycleProvider],
    },
    AuthService,
    SessionGuard,
    OptionalSessionGuard,
    SuspendedAllowedGuard,
    { provide: RateLimiter, useClass: RedisRateLimiter },
    ModerationService,
    { provide: OBJECT_STORE, useFactory: (env: Env) => new S3ObjectStore(s3Config(env)), inject: [ENV] },
    { provide: MEDIA_JOBS, useClass: BullMediaJobs },
    // No real abuse-material scanner yet; see docs/safety/abuse-material-scanning.md.
    { provide: CONTENT_SCANNER, useClass: NoScanner },
    MediaService,
    MediaWorker,
    { provide: LINK_JOBS, useClass: BullLinkJobs },
    // Reads linked pages for previews, and only ever from the public internet.
    { provide: PAGE_FETCHER, useFactory: () => new SafeFetcher() },
    LinksService,
    LinkWorker,
    MembersService,
    CommunitiesService,
    InvitesService,
    PostsService,
    NotificationsService,
    { provide: EMAIL_JOBS, useClass: BullEmailJobs },
    // Without an SMTP account (SMTP_CONNECTION_URI) these are null and no email is sent.
    { provide: MAILER, useFactory: smtpMailer, inject: [ENV] },
    { provide: EMAIL_ADDRESSES, useFactory: (env: Env) => (env.KRATOS_ADMIN_URL ? new KratosAddresses(env.KRATOS_ADMIN_URL) : null), inject: [ENV] },
    {
      provide: EMAIL_SETTINGS,
      useFactory: (env: Env) => ({
        webUrl: env.WEB_PUBLIC_URL,
        unsubscribeKey: unsubscribeKey(env.KRATOS_WEBHOOK_SECRET),
        delayS: env.EMAIL_DIGEST_DELAY_S,
        gapS: env.EMAIL_DIGEST_GAP_S,
        // Whatever is pushed is not emailed, so email waits for the push side.
        waitForPush: Boolean(env.PUSH_VAPID_PUBLIC_KEY),
      }),
      inject: [ENV],
    },
    EmailNotificationsService,
    EmailWorker,
    { provide: PUSH_JOBS, useClass: BullPushJobs },
    // Without VAPID keys (PUSH_VAPID_*) this is null and nothing is pushed.
    { provide: PUSH_SENDER, useFactory: webPushSender, inject: [ENV] },
    PushNotificationsService,
    PushWorker,
    ExportService,
    GovernanceService,
    OnboardingService,
  ],
})
export class AppModule {}
