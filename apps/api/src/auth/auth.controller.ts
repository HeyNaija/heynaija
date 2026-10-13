import { timingSafeEqual } from 'node:crypto'
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
import { z } from 'zod'
import type { Env } from '../env.js'
import { InvitesService } from '../invites/invites.service.js'
import { ENV } from '../tokens.js'
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
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('v1/me')
  @UseGuards(SessionGuard)
  me(@Req() req: AuthedRequest) {
    return req.member
  }

  /** Lets /join tell someone their code is wrong before they fill in a signup form. */
  @Post('v1/invites/check')
  @HttpCode(200)
  async checkInvite(@Body() body: unknown) {
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
