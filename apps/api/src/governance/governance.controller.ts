import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { SAFETY_ALERTS, type SafetyAlerts } from '../moderation/safety-alerts.js'
import { RateLimiter } from '../rate-limit.js'
import { ADULT_AGE, MINIMUM_AGE, ageOn, birthDateFrom } from './age.js'
import { GovernanceService } from './governance.service.js'

const birthDateBody = z.object({ birthDate: z.string().max(20) })

/**
 * The signed-in member's own age, verification and voting-membership status.
 * There is deliberately no endpoint to start a verification, show a badge or
 * join: those wait for the approvals in docs/governance/open-items.md.
 */
@Controller('v1/me')
export class GovernanceController {
  constructor(
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Optional() @Inject(SAFETY_ALERTS) private readonly alerts?: SafetyAlerts,
  ) {}

  @Get('governance')
  @UseGuards(SessionGuard)
  status(@Req() req: AuthedRequest) {
    return this.governance.statusFor(req.member.id)
  }

  /**
   * A member who joined before signup asked for a date of birth gives theirs
   * (ADR 0020, section 1); the web app shows nothing else until they do. Unlike
   * a signup, an age under 18 is not refused, because the account already exists
   * in an 18+ beta: the date is kept, so the rules treat them as a minor at once,
   * and moderators are told, to follow the mistaken-age process in /rules#age.
   * Under MINIMUM_AGE, the account is also suspended until a moderator looks.
   */
  @Post('birth-date')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async giveBirthDate(@Req() req: AuthedRequest, @Body() body: unknown) {
    await this.limits.hit('birthDate', req.member.id)
    const now = new Date()
    const parsed = birthDateBody.safeParse(body)
    const date = parsed.success ? birthDateFrom(parsed.data.birthDate, now) : null
    if (!date) return { outcome: 'not_a_date' }
    if ((await this.governance.giveBirthDate(req.member.id, date, now)) === 'already_given') return { outcome: 'already_given' }
    const age = ageOn(date, now)
    if (age >= ADULT_AGE) return { outcome: 'recorded' }
    const below = age < MINIMUM_AGE
    if (below) await this.governance.holdUnderMinimumAge(req.member.id, now)
    // Says who and what to do, never the date itself.
    await this.alerts?.alert(below ? `A member gave an age under ${MINIMUM_AGE}` : 'A member gave an age under 18', [
      `Member: @${req.member.handle}`,
      below
        ? 'Their account is suspended until a moderator looks. Reinstate it, as any suspension, if the date was a mistake.'
        : 'They are treated as under 18. Follow the mistaken-age process in /rules#age.',
      'Their date of birth is in Settings for them only; ask them through contact@heynaija.ng if you need it.',
    ])
    return { outcome: below ? 'suspended' : 'recorded' }
  }
}
