import { createDb, type Db } from '@heynaija/db'
import { Controller, Get, Module } from '@nestjs/common'
import { AgeVerificationController, DiditWebhookController } from './age-verification/age-verification.controller.js'
import { AgeVerificationService, DIDIT_CONFIG } from './age-verification/age-verification.service.js'
import { diditConfig } from './age-verification/config.js'
import { DIDIT_CLIENT, HttpDiditClient } from './age-verification/didit-client.js'
import { AuthController } from './auth/auth.controller.js'
import { AuthService } from './auth/auth.service.js'
import { AUTH_SESSION_PROVIDER } from './auth/auth-session.provider.js'
import { KratosSessionProvider } from './auth/kratos-session.provider.js'
import { KratosService } from './auth/kratos.service.js'
import { RedisSessionCache, SESSION_CACHE } from './auth/session-cache.js'
import { OptionalSessionGuard, SessionGuard, SuspendedAllowedGuard } from './auth/session.guard.js'
import { CommunitiesController } from './communities/communities.controller.js'
import { CommunitiesService } from './communities/communities.service.js'
import { EMAIL_ADDRESSES, KratosAddresses } from './email/addresses.js'
import { EmailController } from './email/email.controller.js'
import { BullEmailJobs, EmailWorker } from './email/email-queue.js'
import { EMAIL_JOBS, EMAIL_SETTINGS, EmailNotificationsService } from './email/email-notifications.service.js'
import { MAILER, type Mailer, smtpMailer } from './email/mailer.js'
import { unsubscribeKey } from './email/unsubscribe-token.js'
import { type Env, loadEnv } from './env.js'
import { FeatureFlags } from './flags/feature-flags.js'
import { FeatureGuard } from './flags/feature.guard.js'
import { FlagsController } from './flags/flags.controller.js'
import { ExportController } from './export/export.controller.js'
import { ExportService } from './export/export.service.js'
import { GistReconciler } from './gists/gist-queue.js'
import { GistsController, LiveKitWebhookController } from './gists/gists.controller.js'
import { GISTS_CONFIG, GistsService } from './gists/gists.service.js'
import { GistsEnabledGuard } from './gists/gists-enabled.guard.js'
import { roomServiceFor } from './gists/livekit-room-service.js'
import { ROOM_SERVICE } from './gists/room-service.js'
import { GovernanceController } from './governance/governance.controller.js'
import { GovernanceService } from './governance/governance.service.js'
import { IdeasController } from './ideas/ideas.controller.js'
import { IdeasService } from './ideas/ideas.service.js'
import { InvitesService } from './invites/invites.service.js'
import { BullLinkJobs, LinkWorker } from './links/link-queue.js'
import { LINK_JOBS, LinksService, PAGE_FETCHER } from './links/links.service.js'
import { SafeFetcher } from './links/safe-fetch.js'
import { CDN_PURGER, CloudflarePurger, NoPurger } from './media/cdn-purge.js'
import { MediaController, PostImagesController } from './media/media.controller.js'
import { BullMediaJobs, MediaWorker } from './media/media-queue.js'
import { CONTENT_SCANNER, MEDIA_JOBS, MediaService, NoScanner, OBJECT_STORE } from './media/media.service.js'
import { S3ObjectStore } from './media/object-store.js'
import { PhotoDnaScanner } from './media/photodna.js'
import { s3Config } from './media/s3-config.js'
import { MembersController, OwnProfileController } from './members/members.controller.js'
import { MembersService } from './members/members.service.js'
import { ModerationController } from './moderation/moderation.controller.js'
import { ModerationService } from './moderation/moderation.service.js'
import { EmailSafetyAlerts, SAFETY_ALERTS } from './moderation/safety-alerts.js'
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
import { TopicsController } from './topics/topics.controller.js'
import { TopicsService } from './topics/topics.service.js'

@Controller()
class HealthController {
  @Get('healthz')
  health() {
    return { ok: true }
  }
}

@Module({
  controllers: [HealthController, AuthController, PostsController, MembersController, OwnProfileController, CommunitiesController, SearchController, ModerationController, MediaController, PostImagesController, NotificationsController, EmailController, PushController, ExportController, GovernanceController, OnboardingController, TopicsController, IdeasController, GistsController, LiveKitWebhookController, FlagsController, AgeVerificationController, DiditWebhookController],
  providers: [
    { provide: ENV, useFactory: loadEnv },
    { provide: DB, useFactory: (env: Env) => createDb(env.DATABASE_URL).db, inject: [ENV] },
    { provide: SESSION_CACHE, useClass: RedisSessionCache },
    KratosService,
    { provide: AUTH_SESSION_PROVIDER, useClass: KratosSessionProvider },
    AuthService,
    SessionGuard,
    OptionalSessionGuard,
    SuspendedAllowedGuard,
    // Runtime feature flags, per APP_ENV (docs/feature-flags.md).
    { provide: FeatureFlags, useFactory: (db: Db, env: Env) => new FeatureFlags(db, env.APP_ENV), inject: [DB, ENV] },
    FeatureGuard,
    { provide: RateLimiter, useClass: RedisRateLimiter },
    ModerationService,
    { provide: OBJECT_STORE, useFactory: (env: Env) => new S3ObjectStore(s3Config(env)), inject: [ENV] },
    { provide: MEDIA_JOBS, useClass: BullMediaJobs },
    // Until PhotoDNA approves us there is no key, and every image passes; see
    // docs/safety/abuse-material-scanning.md.
    {
      provide: CONTENT_SCANNER,
      useFactory: (env: Env) =>
        env.PHOTODNA_SUBSCRIPTION_KEY ? new PhotoDnaScanner(env.PHOTODNA_SUBSCRIPTION_KEY, env.PHOTODNA_MATCH_URL) : new NoScanner(),
      inject: [ENV],
    },
    {
      provide: CDN_PURGER,
      useFactory: (env: Env) =>
        env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_PURGE_TOKEN
          ? new CloudflarePurger(env.CLOUDFLARE_ZONE_ID, env.CLOUDFLARE_PURGE_TOKEN, [
              `${env.WEB_PUBLIC_URL}/media`,
              ...(env.MEDIA_ORIGIN ? [env.MEDIA_ORIGIN] : []),
            ])
          : new NoPurger(),
      inject: [ENV],
    },
    {
      provide: SAFETY_ALERTS,
      useFactory: (env: Env, mailer: Mailer | null) => new EmailSafetyAlerts(mailer, env.SAFETY_ALERT_EMAIL, env.WEB_PUBLIC_URL),
      inject: [ENV, MAILER],
    },
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
    TopicsService,
    IdeasService,
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
    // Gists (docs/adr/0017): dark unless CALLS_ENABLED, CALLS_GISTS_ENABLED and the LIVEKIT_* settings are all set.
    { provide: ROOM_SERVICE, useFactory: roomServiceFor, inject: [ENV] },
    {
      provide: GISTS_CONFIG,
      useFactory: (env: Env) => ({
        callsMembers: env.CALLS_MEMBERS,
        maxCohosts: env.GISTS_MAX_COHOSTS,
        maxSpeakers: env.GISTS_MAX_SPEAKERS,
        listenerCap: env.GISTS_LISTENER_CAP,
        livekitUrl: env.LIVEKIT_URL ?? '',
      }),
      inject: [ENV],
    },
    // Age verification with Didit (docs/adr/0018): without all three DIDIT_* settings
    // there is no config and no client, and nothing is offered.
    { provide: DIDIT_CONFIG, useFactory: (env: Env) => diditConfig(env), inject: [ENV] },
    {
      provide: DIDIT_CLIENT,
      useFactory: (config: ReturnType<typeof diditConfig>) => (config ? new HttpDiditClient(config) : null),
      inject: [DIDIT_CONFIG],
    },
    AgeVerificationService,
    GistsService,
    GistsEnabledGuard,
    GistReconciler,
  ],
})
export class AppModule {}
