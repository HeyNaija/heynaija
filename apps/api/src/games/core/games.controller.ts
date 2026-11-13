import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import type { Db } from '@heynaija/db'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../../auth/session.guard.js'
import { Feature, FeatureGuard } from '../../flags/feature.guard.js'
import { parse } from '../../http.js'
import { RateLimiter } from '../../rate-limit.js'
import { DB } from '../../tokens.js'
import { PAYOUT_TABLES, CURRENT_TABLE } from '../keno/payouts.js'
import { CompetitionError, CompetitionsService, ELIGIBILITIES, FORMATS } from './competitions.js'
import { BOARDS, FILTERS, leaderboard, seasonsWithScores } from './leaderboards.js'
import { publicManifest } from './manifest.js'
import { GAME_REGISTRY } from './registry.js'
import { XP_RULES } from './scoring.js'
import { lagosMonth } from './seasons.js'

const boardQuery = z.object({
  board: z.enum(BOARDS).default('score'),
  period: z.string().regex(/^(all|\d{4}-(0[1-9]|1[0-2]))$/).optional(),
  filter: z.enum(FILTERS).default('everyone'),
  community: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
const competitionBody = z.object({
  name: z.string().max(200),
  game: z.string().max(30),
  format: z.string().max(40),
  eligibility: z.enum(ELIGIBILITIES),
  community: z.string().max(60).nullish(),
  invite: z.array(z.string().max(40)).max(500).optional(),
  entryOpensAt: z.iso.datetime({ offset: true }),
  entryClosesAt: z.iso.datetime({ offset: true }),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  publish: z.boolean().default(false),
})
const competitionId = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}
const input = (b: z.infer<typeof competitionBody>) => ({
  ...b,
  entryOpensAt: new Date(b.entryOpensAt),
  entryClosesAt: new Date(b.entryClosesAt),
  startsAt: new Date(b.startsAt),
  endsAt: new Date(b.endsAt),
})

/** A CompetitionError as an HTTP answer, with a `code` the web app words. */
const run = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (err) {
    if (!(err instanceof CompetitionError)) throw err
    const body = { code: err.code, message: err.message }
    if (err.code === 'not_found') throw new NotFoundException(body)
    if (err.code === 'not_moderator') throw new ForbiddenException(body)
    throw new BadRequestException(body)
  }
}

/**
 * Every Games route is behind the `games` flag (docs/feature-flags.md, docs/adr/0028):
 * while it is off for the member, or they are not on its allow-list, the route is a 404.
 */
@Controller('v1/games')
@UseGuards(SessionGuard, FeatureGuard)
@Feature('games')
export class GamesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CompetitionsService) private readonly competitions: CompetitionsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** The registry, for the games homepage. */
  @Get()
  list() {
    return { games: GAME_REGISTRY.map(publicManifest) }
  }

  /** Every scoring rule, for "How games scoring works": the page shows the numbers the scoring uses. */
  @Get('scoring')
  scoring() {
    return { xp: XP_RULES, keno: { tableVersion: CURRENT_TABLE, payouts: PAYOUT_TABLES[CURRENT_TABLE] }, formats: FORMATS, season: lagosMonth(new Date()).slug }
  }

  @Get('leaderboard')
  async leaderboard(@Req() req: AuthedRequest, @Query() query: unknown) {
    const q = parse(boardQuery, query)
    return leaderboard(this.db, req.member.id, q)
  }

  /** Seasons with scores, newest first, and the one now. */
  @Get('seasons')
  async seasons() {
    return { current: lagosMonth(new Date()).slug, seasons: await seasonsWithScores(this.db) }
  }

  // --- Competitions -------------------------------------------------------------

  @Get('competitions')
  async competitionList(@Req() req: AuthedRequest) {
    return this.competitions.list(req.member.id)
  }

  @Get('competitions/:id')
  async competition(@Req() req: AuthedRequest, @Param('id') id: string) {
    return run(() => this.competitions.view(req.member.id, competitionId(id)))
  }

  @Post('competitions')
  @HttpCode(201)
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const b = parse(competitionBody, body)
    await this.limits.hit('action', req.member.id)
    return { id: await run(() => this.competitions.create(req.member.id, input(b), b.publish)) }
  }

  @Put('competitions/:id')
  @HttpCode(204)
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(competitionBody, body)
    await this.limits.hit('action', req.member.id)
    await run(() => this.competitions.update(req.member.id, competitionId(id), input(b)))
  }

  @Post('competitions/:id/publish')
  @HttpCode(204)
  async publish(@Req() req: AuthedRequest, @Param('id') id: string) {
    await run(() => this.competitions.publish(req.member.id, competitionId(id)))
  }

  @Post('competitions/:id/cancel')
  @HttpCode(204)
  async cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    await run(() => this.competitions.cancel(req.member.id, competitionId(id)))
  }

  @Post('competitions/:id/entry')
  @HttpCode(204)
  async enter(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    await run(() => this.competitions.enter(req.member.id, competitionId(id)))
  }

  @Delete('competitions/:id/entry')
  @HttpCode(204)
  async withdraw(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    await run(() => this.competitions.withdraw(req.member.id, competitionId(id)))
  }
}
