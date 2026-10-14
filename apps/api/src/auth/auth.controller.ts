import { timingSafeEqual } from 'node:crypto'
import { type Db, members } from '@heynaija/db'
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Env } from '../env.js'
import { InvitesService } from '../invites/invites.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { avatarPath } from '../media/media.service.js'
import { RateLimiter } from '../rate-limit.js'
import { DB, ENV } from '../tokens.js'
import { type AuthedRequest, SessionGuard } from './session.guard.js'

// identity_id is all zeros in the first hook (the account is not saved yet).
const registrationHook = z.object({ identity_id: z.guid(), invite_code: z.string().max(100) })
const inviteCheckBody = z.object({ code: z.string().max(100) })

// The shape Kratos expects from a webhook that aborts a flow; `text` is shown to
// the person on the signup form.
const rejectSignup = (text: string) =>
  new HttpException(
    { messages: [{ messages: [{ id: 4900001, text, type: 'error', context: {} }] }] },
    400,
  )

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(
    @Inject(InvitesService) private readonly invites: InvitesService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get('v1/me')
  @UseGuards(SessionGuard)
  async me(@Req() req: AuthedRequest) {
    const [scope, [row]] = await Promise.all([
      this.moderation.scope(req.member.id),
      this.db
        .select({ avatarMediaId: members.avatarMediaId, displayName: members.displayName, bio: members.bio })
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
      moderates: scope.siteWide || scope.communityIds.length > 0,
    }
  }

  /** Lets /join tell someone their code is wrong before they fill in a signup form. */
  @Post('v1/invites/check')
  @HttpCode(200)
  async checkInvite(@Body() body: unknown) {
    // Signed-out callers all arrive via the web app, so this is one shared budget.
    this.limits.hit('inviteCheck', 'anonymous')
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
   * spent here: the signup can still fail, for example on a duplicate email.
   */
  @Post('internal/kratos/registration')
  @HttpCode(200)
  async registration(@Headers('x-webhook-secret') secret: string | undefined, @Body() body: unknown) {
    this.assertFromKratos(secret)
    const parsed = registrationHook.safeParse(body)
    if (!parsed.success || !(await this.invites.isUsable(parsed.data.invite_code))) {
      throw rejectSignup('That invite code is not valid any more. Ask whoever invited you for a new one.')
    }
    return {}
  }

  /** Called by Kratos once the account exists: this is where the invite is spent. */
  @Post('internal/kratos/registered')
  @HttpCode(200)
  async registered(@Headers('x-webhook-secret') secret: string | undefined, @Body() body: unknown) {
    this.assertFromKratos(secret)
    const parsed = registrationHook.safeParse(body)
    const redeemed =
      parsed.success && (await this.invites.redeem(parsed.data.invite_code, parsed.data.identity_id))
    // Losing a race for the last use leaves an account without membership; the
    // session guard refuses it. Kratos cannot undo the signup at this point.
    if (!redeemed) this.logger.warn(`signup without a redeemable invite: ${parsed.data?.identity_id}`)
    return { redeemed }
  }
}
