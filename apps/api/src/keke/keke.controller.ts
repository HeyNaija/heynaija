import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { parse } from '../http.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { RateLimiter } from '../rate-limit.js'
import { KekeService } from './keke.service.js'
import { SENTENCE_MAX } from './news-rule.js'
import { KekeNews, NewsDecisionError } from './news.service.js'

const day = z.iso.date()
const approval = z.object({
  stories: z.array(z.object({ index: z.number().int().min(0).max(20), sentence: z.string().trim().min(1).max(SENTENCE_MAX) })).min(1).max(20),
})

/** Keke (docs/adr/0030): what it is on this server, publicly, and its month's numbers, for site moderators. */
@Controller('v1/keke')
export class KekeController {
  constructor(
    @Inject(KekeService) private readonly keke: KekeService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(KekeNews) private readonly news: KekeNews,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  private async siteModerator(req: AuthedRequest): Promise<void> {
    if (!(await this.moderation.scope(req.member.id)).siteWide) throw new ForbiddenException()
  }

  /**
   * For /about/keke and /privacy: whether Keke is answering, which models this
   * server uses and who a question is sent to, read from the server's own settings
   * so the pages never say more or less than is true.
   */
  @Get('about')
  async about() {
    const [help, news] = await Promise.all([this.keke.about(), this.news.about()])
    return { ...help, news }
  }

  /** This month's questions, answers by kind, spend and which model answered. Site moderators only. */
  @Get('month')
  @UseGuards(SessionGuard)
  async month(@Req() req: AuthedRequest) {
    await this.siteModerator(req)
    return this.keke.month()
  }

  /** Today's news draft (null if none yet), for site moderators on /mod. */
  @Get('news')
  @UseGuards(SessionGuard)
  async newsToday(@Req() req: AuthedRequest) {
    await this.siteModerator(req)
    return { draft: await this.news.today() }
  }

  /** Approves the day's news with the stories kept, by their place in the draft, in the moderator's words. */
  @Post('news/:day/approve')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async approve(@Req() req: AuthedRequest, @Param('day') raw: string, @Body() body: unknown) {
    await this.siteModerator(req)
    await this.limits.hit('action', req.member.id)
    await decided(() => this.news.decide(req.member.id, parse(day, raw), parse(approval, body)))
  }

  /** Skips the day's news: nothing is posted. */
  @Post('news/:day/skip')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async skip(@Req() req: AuthedRequest, @Param('day') raw: string) {
    await this.siteModerator(req)
    await this.limits.hit('action', req.member.id)
    await decided(() => this.news.decide(req.member.id, parse(day, raw), { skip: true }))
  }
}

/** A decision the draft's state refuses is a 400 with its reason. */
async function decided(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (err) {
    if (err instanceof NewsDecisionError) throw new BadRequestException({ code: err.code, message: err.message })
    throw err
  }
}
