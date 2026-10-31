import { BadGatewayException, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Post, Body, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { Feature, FeatureGuard } from '../flags/feature.guard.js'
import { RateLimiter } from '../rate-limit.js'
import { AgeVerificationError, AgeVerificationService, WebhookRejectedError } from './age-verification.service.js'

/** The member's own age check (docs/adr/0018). Dark, as a missing route, while the `ageVerification` flag is off for them. */
@Controller('v1/me/age-verification')
@UseGuards(SessionGuard, FeatureGuard)
@Feature('ageVerification')
export class AgeVerificationController {
  constructor(
    @Inject(AgeVerificationService) private readonly service: AgeVerificationService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** What is on record, whether a check can be started, and (while a result is open) a look at Didit's side. */
  @Get()
  async status(@Req() req: AuthedRequest) {
    await this.limits.hit('ageVerificationStatus', req.member.id)
    return this.service.refresh(req.member.id)
  }

  /** Creates a Didit session and returns its hosted address; the web app sends the member there. */
  @Post('session')
  @HttpCode(200)
  async session(@Req() req: AuthedRequest) {
    await this.limits.hit('ageVerificationStart', req.member.id)
    try {
      return await this.service.start(req.member.id)
    } catch (err) {
      if (err instanceof AgeVerificationError) {
        if (err.code === 'unavailable') throw new ServiceUnavailableException({ code: 'unavailable', message: 'Age verification is not available right now.' })
        throw new BadGatewayException({ code: 'upstream', message: 'The verification service did not answer. Try again in a few minutes.' })
      }
      throw err
    }
  }
}

/**
 * Didit's webhook. Reached as POST /api/v1/webhooks/didit through the web app's
 * existing /api/v1 proxy. Not behind the flag: a result is recorded even if the flag
 * has since been turned off. The signature is the whole of its authentication.
 */
@Controller('v1/webhooks')
export class DiditWebhookController {
  constructor(@Inject(AgeVerificationService) private readonly service: AgeVerificationService) {}

  @Post('didit')
  @HttpCode(200)
  async webhook(@Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    try {
      await this.service.handleWebhook(body, headers)
    } catch (err) {
      if (err instanceof WebhookRejectedError) {
        // With no secret configured the route does not exist; otherwise it is a refusal.
        if (err.message === 'not configured') throw new NotFoundException()
        throw new UnauthorizedException('bad signature')
      }
      throw err
    }
    return {}
  }
}
