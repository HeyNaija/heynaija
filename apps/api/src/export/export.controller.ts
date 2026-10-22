import { Controller, Get, Header, Inject, NotFoundException, Req, UseGuards } from '@nestjs/common'
import { AuthService } from '../auth/auth.service.js'
import { type AuthedRequest, SuspendedAllowedGuard } from '../auth/session.guard.js'
import { RateLimiter } from '../rate-limit.js'
import { ExportService } from './export.service.js'

/** A member's own data, as one JSON document (the web app offers it as a download). */
@Controller('v1/me/export')
export class ExportController {
  constructor(
    @Inject(ExportService) private readonly exports: Pick<ExportService, 'export'>,
    @Inject(AuthService) private readonly auth: Pick<AuthService, 'emailForRequest'>,
    @Inject(RateLimiter) private readonly limits: Pick<RateLimiter, 'hit'>,
  ) {}

  // Suspended members may still take their data with them.
  @Get()
  @UseGuards(SuspendedAllowedGuard)
  @Header('cache-control', 'no-store')
  async export(@Req() req: AuthedRequest) {
    await this.limits.hit('export', req.member.id)
    const email = await this.auth.emailForRequest({
      cookieHeader: req.headers.cookie,
      authorizationHeader: req.headers.authorization,
    })
    const data = await this.exports.export(req.member.id, email)
    if (!data) throw new NotFoundException()
    return data
  }
}
