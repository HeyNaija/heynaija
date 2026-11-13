import { Controller, Get, Module } from '@nestjs/common'
import { AccountController } from './account/account.controller.js'
import { AccountDeletionService, DELETION_NOTICES, GAMES_ERASER } from './account/account-deletion.service.js'
import { AccountWorker, BullAccountJobs } from './account/account-queue.js'
import { EmailDeletionNotices } from './account/deletion-notices.js'
import { PrivacyRequestsService } from './account/privacy-requests.service.js'
import { RetentionService } from './account/retention.service.js'
import { AppleController } from './apple/apple.controller.js'
import { AppleTokensService } from './apple/apple-tokens.service.js'
import { AuthController } from './auth/auth.controller.js'
import { CommunitiesController } from './communities/communities.controller.js'
import { CommunitiesService } from './communities/communities.service.js'
import { EMAIL_ADDRESSES, type EmailAddresses, KratosAddresses } from './email/addresses.js'
import { EmailController } from './email/email.controller.js'
import { BullEmailJobs, EmailWorker } from './email/email-queue.js'
import { EMAIL_JOBS, EMAIL_SETTINGS, EmailNotificationsService } from './email/email-notifications.service.js'
import { MAILER, type Mailer, smtpMailer } from './email/mailer.js'
import { unsubscribeKey } from './email/unsubscribe-token.js'
import { appleKey, type Env } from './env.js'
import { FlagsController } from './flags/flags.controller.js'
import { ExportController } from './export/export.controller.js'
import { ExportService } from './export/export.service.js'
import { ChessService } from './games/chess/chess.service.js'
import { GamesModule } from './games/games.module.js'
import { GistReconciler } from './gists/gist-queue.js'
import { GistRepliesController } from './gists/gist-replies.controller.js'
import { GistRepliesService } from './gists/gist-replies.service.js'
import { GistsController, LiveKitWebhookController } from './gists/gists.controller.js'
import { GISTS_CONFIG, GistsService } from './gists/gists.service.js'
import { GistsEnabledGuard, GistsGate, LiveKitConfiguredGuard } from './gists/gists-enabled.guard.js'
import { roomServiceFor } from './gists/livekit-room-service.js'
import { ROOM_SERVICE } from './gists/room-service.js'
import { HighlightsController } from './highlights/highlights.controller.js'
import { BullHighlightsJobs, HighlightsWorker } from './highlights/highlights-queue.js'
import { HIGHLIGHTS_JOBS, HIGHLIGHTS_SETTINGS, HighlightsService } from './highlights/highlights.service.js'
import { GovernanceController } from './governance/governance.controller.js'
import { GovernanceService } from './governance/governance.service.js'
import { IdeasController } from './ideas/ideas.controller.js'
import { IdeasService } from './ideas/ideas.service.js'
import { BullLinkJobs, LinkWorker } from './links/link-queue.js'
import { LINK_JOBS, LinksService, PAGE_FETCHER } from './links/links.service.js'
import { SafeFetcher } from './links/safe-fetch.js'
import { CDN_PURGER, CloudflarePurger, NoPurger } from './media/cdn-purge.js'
import { CommunityPhotoController, MediaController, PostImagesController } from './media/media.controller.js'
import { MEDIA_URLS, MediaUrls } from './media/media-urls.js'
import { PrivateMediaController } from './media/private-media.controller.js'
import { BullMediaJobs, MediaWorker } from './media/media-queue.js'
import { CONTENT_SCANNER, MEDIA_JOBS, MediaService, OBJECT_STORE } from './media/media.service.js'
import { S3ObjectStore } from './media/object-store.js'
import { scannerFromEnv } from './media/scanners.js'
import { s3Config } from './media/s3-config.js'
import { MembersController, OwnProfileController, OwnSensitiveSettingsController } from './members/members.controller.js'
import { MembersService } from './members/members.service.js'
import { ModerationController } from './moderation/moderation.controller.js'
import { ModerationService } from './moderation/moderation.service.js'
import { EmailSafetyAlerts, SAFETY_ALERTS } from './moderation/safety-alerts.js'
import { NotificationsController } from './notifications/notifications.controller.js'
import { NotificationsService } from './notifications/notifications.service.js'
import { OnboardingController } from './onboarding/onboarding.controller.js'
import { OnboardingService } from './onboarding/onboarding.service.js'
import { PostsController } from './posts/posts.controller.js'
import { PushController } from './push/push.controller.js'
import { PUSH_JOBS, PushNotificationsService } from './push/push-notifications.service.js'
import { BullPushJobs, PushWorker } from './push/push-queue.js'
import { PlatformModule } from './platform.module.js'
import { appPushSender } from './push/app-push-sender.js'
import { APP_PUSH_SENDER, PUSH_SENDER, webPushSender } from './push/push-sender.js'
import { SearchController } from './search/search.controller.js'
import { ENV } from './tokens.js'
import { TopicsController } from './topics/topics.controller.js'
import { TopicsService } from './topics/topics.service.js'
import { type VideoConfig, videoConfig } from './video/video-config.js'
import { VideoGate, VideoPostsGuard } from './video/video-gate.js'
import { BullVideoJobs } from './video/video-queue.js'
import { VideosController } from './video/video.controller.js'
import { VIDEO_CONFIG, VIDEO_JOBS, VIDEO_STORE, VideoService } from './video/video.service.js'

@Controller()
class HealthController {
  @Get('healthz')
  health() {
    return { ok: true }
  }
}

@Module({
  // Settings, the database, sign-in, feature flags and rate limits; then the modules built on them.
  imports: [PlatformModule, GamesModule],
  controllers: [HealthController, AuthController, AppleController, PostsController, MembersController, OwnProfileController, OwnSensitiveSettingsController, CommunitiesController, SearchController, ModerationController, MediaController, PostImagesController, CommunityPhotoController, PrivateMediaController, NotificationsController, EmailController, PushController, HighlightsController, ExportController, GovernanceController, OnboardingController, TopicsController, IdeasController, GistsController, GistRepliesController, LiveKitWebhookController, AccountController, FlagsController, VideosController],
  providers: [
    ModerationService,
    { provide: OBJECT_STORE, useFactory: (env: Env) => new S3ObjectStore(s3Config(env)), inject: [ENV] },
    { provide: MEDIA_JOBS, useClass: BullMediaJobs },
    // Arachnid Shield and PhotoDNA, each once its key is set; with neither every image
    // passes and every video is held (docs/safety/abuse-material-scanning.md).
    { provide: CONTENT_SCANNER, useFactory: (env: Env) => scannerFromEnv(env), inject: [ENV] },
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
    TopicsService,
    IdeasService,
    NotificationsService,
    { provide: EMAIL_JOBS, useClass: BullEmailJobs },
    // Without an SMTP account (SMTP_CONNECTION_URI) this is null and no email is sent.
    { provide: MAILER, useFactory: smtpMailer, inject: [ENV] },
    { provide: EMAIL_ADDRESSES, useFactory: (env: Env) => new KratosAddresses(env.KRATOS_ADMIN_URL), inject: [ENV] },
    {
      provide: EMAIL_SETTINGS,
      useFactory: (env: Env) => ({
        webUrl: env.WEB_PUBLIC_URL,
        unsubscribeKey: unsubscribeKey(env.KRATOS_WEBHOOK_SECRET),
        delayS: env.EMAIL_DIGEST_DELAY_S,
        gapS: env.EMAIL_DIGEST_GAP_S,
        // Whatever is pushed is not emailed, so email waits for the push side.
        waitForPush: Boolean(env.PUSH_VAPID_PUBLIC_KEY || env.FCM_SERVICE_ACCOUNT || appleKey(env)),
      }),
      inject: [ENV],
    },
    EmailNotificationsService,
    EmailWorker,
    { provide: PUSH_JOBS, useClass: BullPushJobs },
    // Without VAPID keys (PUSH_VAPID_*) this is null and nothing is pushed.
    { provide: PUSH_SENDER, useFactory: webPushSender, inject: [ENV] },
    // Without FCM's service account (FCM_SERVICE_ACCOUNT) or the Apple key (APPLE_*) this is null and the apps are not pushed to.
    { provide: APP_PUSH_SENDER, useFactory: appPushSender, inject: [ENV] },
    PushNotificationsService,
    PushWorker,
    // Weekly highlights (docs/adr/0027): pushed where a member has push, emailed where they have email on.
    { provide: HIGHLIGHTS_JOBS, useClass: BullHighlightsJobs },
    {
      provide: HIGHLIGHTS_SETTINGS,
      useFactory: (env: Env) => ({
        webUrl: env.WEB_PUBLIC_URL,
        unsubscribeKey: unsubscribeKey(env.KRATOS_WEBHOOK_SECRET),
        weekday: env.HIGHLIGHTS_WEEKDAY,
        hourUtc: env.HIGHLIGHTS_HOUR_UTC,
      }),
      inject: [ENV],
    },
    HighlightsService,
    HighlightsWorker,
    ExportService,
    GovernanceService,
    OnboardingService,
    // Account deletion (docs/adr/0016). Its emails go through the notification mailer, so none without SMTP.
    {
      provide: DELETION_NOTICES,
      useFactory: (env: Env, mailer: Mailer | null, addresses: EmailAddresses) => new EmailDeletionNotices(mailer, addresses, env.WEB_PUBLIC_URL),
      inject: [ENV, MAILER, EMAIL_ADDRESSES],
    },
    { provide: GAMES_ERASER, useExisting: ChessService },
    AccountDeletionService,
    AppleTokensService,
    PrivacyRequestsService,
    RetentionService,
    BullAccountJobs,
    AccountWorker,
    // Gists (docs/adr/0017): dark unless the gists flag is on and the LIVEKIT_* settings are all set.
    { provide: ROOM_SERVICE, useFactory: roomServiceFor, inject: [ENV] },
    {
      provide: GISTS_CONFIG,
      useFactory: (env: Env) => ({
        maxCohosts: env.GISTS_MAX_COHOSTS,
        maxSpeakers: env.GISTS_MAX_SPEAKERS,
        listenerCap: env.GISTS_LISTENER_CAP,
        livekitUrl: env.LIVEKIT_URL ?? '',
      }),
      inject: [ENV],
    },
    GistsGate,
    GistsService,
    GistRepliesService,
    GistsEnabledGuard,
    LiveKitConfiguredGuard,
    GistReconciler,
    // Video posts (docs/adr/0019): dark behind the videoPosts flag and, in production, a bound scanner.
    // The encoding runs in the separate video-worker process; these are the API's half.
    { provide: VIDEO_STORE, useExisting: OBJECT_STORE },
    { provide: VIDEO_CONFIG, useFactory: (env: Env) => videoConfig(env), inject: [ENV] },
    // Signed URLs for the files of posts marked sensitive (docs/adr/0025), keyed from the storage secret
    // only the API holds, so no new setting is needed; absolute on the site for video.
    {
      provide: MEDIA_URLS,
      useFactory: (env: Env, cfg: VideoConfig) => new MediaUrls(env.S3_SECRET_ACCESS_KEY, env.WEB_PUBLIC_URL, cfg.filesBase),
      inject: [ENV, VIDEO_CONFIG],
    },
    BullVideoJobs,
    {
      provide: VIDEO_JOBS,
      useFactory: (video: BullVideoJobs, media: BullMediaJobs) => ({
        processVideo: (id: string) => video.processVideo(id),
        purgeCdn: (keys: string[]) => media.purgeCdn(keys),
      }),
      inject: [BullVideoJobs, MEDIA_JOBS],
    },
    VideoService,
    VideoGate,
    VideoPostsGuard,
  ],
})
export class AppModule {}
