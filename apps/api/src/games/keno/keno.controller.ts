import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../../auth/session.guard.js'
import { Feature, FeatureGuard } from '../../flags/feature.guard.js'
import { parse } from '../../http.js'
import { RateLimiter } from '../../rate-limit.js'
import { KenoError, KenoService, lagosDayStart } from './keno.service.js'

const ticketBody = z.object({ numbers: z.array(z.number().int()).min(1).max(10) })
const ticketsQuery = z.object({ before: z.iso.datetime().optional() })
const roundsQuery = z.object({ before: z.coerce.number().int().positive().optional() })
const boardQuery = z.object({ period: z.enum(['month', 'all']).default('month'), limit: z.coerce.number().int().min(1).max(50).default(50) })
const roundNumber = (raw: string) => {
  if (!/^\d{1,9}$/.test(raw)) throw new NotFoundException()
  return Number(raw)
}

/** A KenoError as an HTTP answer, with a `code` the web app words. */
const run = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (err) {
    if (!(err instanceof KenoError)) throw err
    const body = { code: err.code, message: err.message }
    if (err.code === 'not_found') throw new NotFoundException(body)
    throw new BadRequestException(body)
  }
}

/** Keno, free to play (docs/adr/0018, phase 4). Behind the `games` flag like the rest of Games. */
@Controller('v1/games/keno')
@UseGuards(SessionGuard, FeatureGuard)
@Feature('games')
export class KenoController {
  constructor(
    @Inject(KenoService) private readonly keno: KenoService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** The play page: the open round, the last draw, the member's tickets and tokens. */
  @Get('round')
  async play(@Req() req: AuthedRequest) {
    return this.keno.playView(req.member.id)
  }

  /** Buys a ticket for the next round with one of today's free tokens. */
  @Post('tickets')
  @HttpCode(201)
  async ticket(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { numbers } = parse(ticketBody, body)
    await this.limits.hit('kenoTicket', req.member.id)
    await this.limits.hit('kenoDaily', `${req.member.id}:${lagosDayStart(new Date()).toISOString().slice(0, 10)}`)
    return run(() => this.keno.play(req.member.id, numbers))
  }

  @Get('tickets')
  async tickets(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { before } = parse(ticketsQuery, query)
    return this.keno.tickets(req.member.id, before ? new Date(before) : undefined)
  }

  @Get('rounds')
  async rounds(@Query() query: unknown) {
    const { before } = parse(roundsQuery, query)
    return this.keno.rounds(before)
  }

  /** One round, to check: its seed and numbers once drawn, only its hash before. */
  @Get('rounds/:number')
  async round(@Param('number') number: string) {
    return run(() => this.keno.round(roundNumber(number)))
  }

  @Get('leaderboard')
  async leaderboard(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { period, limit } = parse(boardQuery, query)
    return this.keno.leaderboard(req.member.id, period, new Date(), limit)
  }
}
