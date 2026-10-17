import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { GovernanceService } from './governance.service.js'

/**
 * The signed-in member's own verification and voting-membership status. There
 * is deliberately no endpoint to start a verification, show a badge or join:
 * those wait for the approvals in docs/governance/open-items.md.
 */
@Controller('v1/me/governance')
export class GovernanceController {
  constructor(@Inject(GovernanceService) private readonly governance: GovernanceService) {}

  @Get()
  @UseGuards(SessionGuard)
  status(@Req() req: AuthedRequest) {
    return this.governance.statusFor(req.member.id)
  }
}
