import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Put, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { parse } from '../http.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { RateLimiter } from '../rate-limit.js'
import { FeatureFlags, FlagChangeError } from './feature-flags.js'

// `enabled` must be given: null means "no override", which is not the same as leaving it out.
const changeBody = z.object({
  enabled: z.boolean().nullable(),
  handles: z.array(z.string().trim().min(1).max(21)).max(100).default([]),
})

/**
 * Site admins listing and changing feature flags. "Admin" here is the site-wide
 * moderator role (members.role), the only site-wide role there is.
 */
@Controller('v1/admin/flags')
export class FlagsController {
  constructor(
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  private async requireAdmin(req: AuthedRequest): Promise<void> {
    if (!(await this.moderation.scope(req.member.id)).siteWide) throw new ForbiddenException()
  }

  @Get()
  @UseGuards(SessionGuard)
  async list(@Req() req: AuthedRequest) {
    await this.requireAdmin(req)
    return this.flags.describe()
  }

  @Put(':key')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async put(@Req() req: AuthedRequest, @Param('key') key: string, @Body() body: unknown) {
    await this.requireAdmin(req)
    await this.limits.hit('flagChange', req.member.id)
    const change = parse(changeBody, body)
    try {
      await this.flags.set(req.member.id, key, change)
    } catch (err) {
      if (err instanceof FlagChangeError) {
        if (err.reason === 'unknown_flag') throw new NotFoundException(err.message)
        throw new BadRequestException(err.message)
      }
      throw err
    }
  }
}
