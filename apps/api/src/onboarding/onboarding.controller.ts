import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { handleParam, parse, slugParam } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { OnboardingService } from './onboarding.service.js'

/** At most this many communities, and this many people, in one go. */
const MAX_CHOICES = 50

// `communities` is a comma-separated list of slugs, as the web app's step 2 sends it.
const suggestionsQuery = z.object({
  communities: z
    .string()
    .max(MAX_CHOICES * 41)
    .default('')
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(slugParam).max(MAX_CHOICES)),
})

const completeBody = z.object({
  communities: z.array(slugParam).max(MAX_CHOICES).default([]),
  follow: z.array(handleParam).max(MAX_CHOICES).default([]),
})

/** The welcome flow a newcomer is sent through once (see OnboardingService). */
@Controller('v1/me/onboarding')
export class OnboardingController {
  constructor(
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** People to follow, drawn from the communities chosen (and from the whole site to fill up). */
  @Get('suggestions')
  @UseGuards(SessionGuard)
  suggestions(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { communities } = parse(suggestionsQuery, query)
    return this.onboarding.suggestions(req.member.id, communities)
  }

  /** Joins and follows everything chosen in one transaction, and ends the flow. */
  @Post('complete')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async complete(@Req() req: AuthedRequest, @Body() body: unknown) {
    const choices = parse(completeBody, body)
    // Each join and follow draws on the shared budget, as it would one at a time.
    const actions = Math.max(1, choices.communities.length + choices.follow.length)
    for (let i = 0; i < actions; i++) await this.limits.hit('action', req.member.id)
    return this.onboarding.complete(req.member.id, choices)
  }

  /** Ends the flow without joining or following anyone. */
  @Post('skip')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async skip(@Req() req: AuthedRequest) {
    await this.limits.hit('action', req.member.id)
    await this.onboarding.skip(req.member.id)
  }
}
