import { Controller, ForbiddenException, Get, Inject, Req, UseGuards } from '@nestjs/common'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { KekeService } from './keke.service.js'

/** Keke (docs/adr/0030): what it is on this server, publicly, and its month's numbers, for site moderators. */
@Controller('v1/keke')
export class KekeController {
  constructor(
    @Inject(KekeService) private readonly keke: KekeService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
  ) {}

  /**
   * For /about/keke and /privacy: whether Keke is answering, which models this
   * server uses and who a question is sent to, read from the server's own settings
   * so the pages never say more or less than is true.
   */
  @Get('about')
  about() {
    return this.keke.about()
  }

  /** This month's questions, answers by kind, spend and which model answered. Site moderators only. */
  @Get('month')
  @UseGuards(SessionGuard)
  async month(@Req() req: AuthedRequest) {
    if (!(await this.moderation.scope(req.member.id)).siteWide) throw new ForbiddenException()
    return this.keke.month()
  }
}
