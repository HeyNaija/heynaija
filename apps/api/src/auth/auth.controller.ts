import { timingSafeEqual } from 'node:crypto'
import { type Db, members } from '@heynaija/db'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Optional,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Env } from '../env.js'
import { InvitesService } from '../invites/invites.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { signupAgeDecision } from '../governance/age.js'
import { GovernanceService } from '../governance/governance.service.js'
import { avatarPath } from '../media/media.service.js'
import { MembersService } from '../members/members.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { RateLimiter, visitor } from '../rate-limit.js'
import { DB, ENV } from '../tokens.js'
import { AuthService } from './auth.service.js'
import { IdentityMappingService } from './identity-mapping.service.js'
import { type AuthedRequest, SessionGuard } from './session.guard.js'

const inviteCheckBody = z.object({ code: z.string().max(100) })

// The shape Kratos expects from a webhook that aborts a flow; `text` is shown to
// the person on the signup form.
const rejectSignup = (text: string) =>
  new HttpException(
    { messages: [{ messages: [{ id: 4900001, text, type: 'error', context: {} }] }] },
    400,
  )

// The same, shown under the handle field in Settings. (At signup the field is
// hidden by the time the hooks run, so the signup uses a message above the form.)
const handleUnavailable = () =>
  new HttpException(
    {
      messages: [
        {
          instance_ptr: '#/traits/handle',
          messages: [{ id: 4900002, text: 'That handle is not available.', type: 'error', context: {} }],
        },
      ],
    },
    400,
  )

const handleTaken = () =>
  new HttpException(
    {
      messages: [
        {
          instance_ptr: '#/traits/handle',
          messages: [{ id: 4000007, text: 'An account with that email or handle already exists.', type: 'error', context: {} }],
        },
      ],
    },
    400,
  )

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(
    @Inject(InvitesService) private readonly invites: InvitesService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: Pick<AuthService, 'invalidateSessionCache' | 'registrationCallback' | 'settingsCallback'>,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Optional() @Inject(IdentityMappingService) private readonly mappings?: IdentityMappingService,
  ) {}

  @Get('v1/me')
  @UseGuards(SessionGuard)
  async me(@Req() req: AuthedRequest) {
    const [scope, unread, [row]] = await Promise.all([
      this.moderation.scope(req.member.id),
      this.notifications.unreadCount(req.member.id),
      this.db
        .select({
          avatarMediaId: members.avatarMediaId,
          displayName: members.displayName,
          bio: members.bio,
          onboardedAt: members.onboardedAt,
        })
        .from(members)
        .where(eq(members.id, req.member.id)),
    ])
    // `moderates` only decides whether the web app shows the moderation link; every
    // moderation endpoint checks the role again.
    return {
      ...req.member,
      avatar: avatarPath(row?.avatarMediaId ?? null),
      displayName: row?.displayName ?? null,
      bio: row?.bio ?? '',
      unreadNotifications: unread,
      moderates: scope.siteWide || scope.communityIds.length > 0,
      // False until the member finishes or skips the welcome flow; the web app's
      // home page sends them to /welcome until then.
      onboarded: Boolean(row?.onboardedAt),
    }
  }

  /**
   * The web app's /logout calls this just before sending the browser to Kratos to
   * end the session, so the cached whoami answer for the cookie is not reused.
   * No guard: all it can do is make the caller's own next request ask Kratos.
   */
  @Post('v1/logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest) {
    await this.auth.invalidateSessionCache({
      cookieHeader: req.headers.cookie,
      authorizationHeader: req.headers.authorization,
    })
  }

  /** Lets /join tell someone their code is wrong before they fill in a signup form. */
  @Post('v1/invites/check')
  @HttpCode(200)
  async checkInvite(@Req() req: FastifyRequest, @Body() body: unknown) {
    await this.limits.hit('inviteCheck', visitor(req))
    const parsed = inviteCheckBody.safeParse(body)
    return { usable: parsed.success && (await this.invites.isUsable(parsed.data.code)) }
  }

  private assertFromKratos(secret: string | undefined) {
    const expected = Buffer.from(this.env.KRATOS_WEBHOOK_SECRET)
    const given = Buffer.from(secret ?? '')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException()
    }
  }

  /**
   * Called by Kratos (never by browsers; the web app does not proxy /internal)
   * just before it saves a new account. A 2xx lets the signup proceed. Nothing is
   * spent here: the signup can still fail, for example on a duplicate email. A
   * handle someone gave up recently is refused (MembersService.handleHeld).
   */
  @Post('internal/kratos/registration')
  @HttpCode(200)
  async registration(@Headers('x-webhook-secret') secret: string | undefined, @Body() body: unknown) {
    this.assertFromKratos(secret)
    const parsed = await this.auth.registrationCallback('kratos', body)
    if (!parsed || !(await this.invites.isUsable(parsed.inviteCode))) {
      throw rejectSignup('That invite code is not valid any more. Ask whoever invited you for a new one.')
    }
    if (await this.members.handleHeld(parsed.handle, null)) {
      const owner = await this.members.currentHandleOwner(parsed.handle)
      throw rejectSignup(owner ? 'An account with that email or handle already exists.' : 'That handle is not available. Go back and choose another.')
    }
    // During the beta, accounts are 18+ (a temporary rule; see signupAgeDecision).
    // Checked here, not only on /join, so a signup that skips that page is refused too.
    if (!signupAgeDecision(parsed.adultDeclared ? 'adult' : null).allowed) {
      throw rejectSignup('During the beta, HeyNaija is open to people aged 18 or older. Go back to your invite link and confirm your age to join.')
    }
    return {}
  }

  /**
   * Called by Kratos just before it saves a change a member made in Settings. A
   * handle someone else gave up recently is refused; one the member gives up is
   * held for them. Kratos itself refuses a handle another account has now.
   */
  @Post('internal/kratos/settings')
  @HttpCode(200)
  async settings(@Headers('x-webhook-secret') secret: string | undefined, @Body() body: unknown) {
    this.assertFromKratos(secret)
    const parsed = await this.auth.settingsCallback('kratos', body)
    if (!parsed) throw new BadRequestException()
    const memberId = this.mappings
      ? (await this.mappings.resolve(parsed.providerId, parsed.subject)) ?? parsed.subject
      : parsed.subject
    const { handle, previousHandle: previous } = parsed
    if (handle === previous) return {}
    if (await this.members.handleHeld(handle, memberId)) {
      const owner = await this.members.currentHandleOwner(handle)
      throw owner && owner !== memberId ? handleTaken() : handleUnavailable()
    }
    await this.members.holdHandle(memberId, previous)
    return {}
  }

  /** Called by Kratos once the account exists: this is where the invite is spent. */
  @Post('internal/kratos/registered')
  @HttpCode(200)
  async registered(@Headers('x-webhook-secret') secret: string | undefined, @Body() body: unknown) {
    this.assertFromKratos(secret)
    const parsed = await this.auth.registrationCallback('kratos', body)
    const redeemed =
      parsed !== null && (await this.invites.redeem(parsed.inviteCode, parsed.subject))
    // Losing a race for the last use leaves an account without membership; the
    // session guard refuses it. Kratos cannot undo the signup at this point.
    if (!redeemed) this.logger.warn(`signup without a redeemable invite: ${parsed?.subject}`)
    if (redeemed && parsed) {
      // Create the application row after invite admission. The ID remains the
      // legacy Kratos UUID during compatibility mode; the mapping is what lets
      // the later cutover stop depending on that coincidence.
      await this.db.insert(members).values({ id: parsed.subject, handle: parsed.handle }).onConflictDoNothing()
      if (this.mappings) await this.mappings.ensure(parsed.providerId, parsed.subject, parsed.subject)
      if (parsed.adultDeclared) await this.governance.recordAgeDeclaration(parsed.subject)
    }
    return { redeemed }
  }
}
