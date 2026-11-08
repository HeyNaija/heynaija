import { BadRequestException, Body, Controller, HttpCode, Inject, NotFoundException, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { AppleCodeRefusedError, AppleTokensService } from './apple-tokens.service.js'

// Apple's authorization codes are some 64 characters of letters, digits, dots and dashes.
const tokenBody = z.object({ code: z.string().regex(/^[\w.-]{16,512}$/, 'an authorization code') })

/** What the iOS app sends after signing in with Apple (docs/adr/0026). */
@Controller('v1/apple')
export class AppleController {
  constructor(
    @Inject(AppleTokensService) private readonly tokens: AppleTokensService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /**
   * Keeps what revoking Sign in with Apple needs when the account is erased: the
   * app sends the authorization code Apple gave it with the ID token it signed in
   * with. 404 when this server has no Apple key; 400 when Apple refuses the code.
   */
  @Post('token')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async keep(@Req() req: AuthedRequest, @Body() body: unknown) {
    if (!this.tokens.enabled) throw new NotFoundException('This server does not keep Apple tokens')
    const { code } = parse(tokenBody, body)
    await this.limits.hit('action', req.member.id)
    try {
      await this.tokens.keep(req.member.id, code)
    } catch (error) {
      if (error instanceof AppleCodeRefusedError) throw new BadRequestException({ code: 'apple_code_refused', message: 'Apple refused that code.' })
      throw new ServiceUnavailableException('Apple could not be reached')
    }
  }
}
