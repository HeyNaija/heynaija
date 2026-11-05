import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../../auth/session.guard.js'
import { Feature, FeatureGuard } from '../../flags/feature.guard.js'
import { handleParam, parse } from '../../http.js'
import { RateLimiter } from '../../rate-limit.js'
import { ChessGamesService } from './chess-games.service.js'
import { ChessError, ChessService } from './chess.service.js'
import { TeamsService } from './teams.js'

const completeBody = z.object({ code: z.string().min(1).max(500), state: z.string().min(1).max(200) })
const challengeBody = z.object({
  handle: z.string().trim().max(21),
  rated: z.boolean(),
  timeControl: z.string().max(10),
  color: z.enum(['random', 'white', 'black']).default('random'),
  // A public thread in Chess Arena when the game starts (docs/adr/0018); on unless turned off.
  openThread: z.boolean().default(true),
})
const opponentsQuery = z.object({ q: z.string().max(30).default('') })
const linkQuery = z.object({ scope: z.enum(['tournaments']).optional() })
const communitySlug = z.string().regex(/^[a-z0-9-]{1,60}$/)
const teamBody = z.object({ team: z.string().trim().min(1).max(200) })
const tournamentBody = z.object({
  name: z.string().max(60),
  kind: z.enum(['arena', 'swiss']),
  timeControl: z.string().max(10),
  rated: z.boolean(),
  startsAt: z.coerce.date(),
  minutes: z.number().int().optional(),
  rounds: z.number().int().optional(),
})
const challengeId = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}

/** A ChessError as an HTTP answer: `code` lets the web app say what to do next. */
export function answer(err: unknown): never {
  if (!(err instanceof ChessError)) throw err
  const body = { code: err.code, message: err.message }
  switch (err.code) {
    case 'not_found':
      throw new NotFoundException(body)
    case 'not_available':
    case 'lichess_busy':
      throw new ServiceUnavailableException(body)
    case 'lichess_unavailable':
      throw new HttpException(body, 502)
    case 'not_moderator':
    case 'not_leader':
      throw new ForbiddenException(body)
    case 'duplicate':
    case 'already_linked':
    case 'team_taken':
    case 'reconnect':
    case 'game_over':
      throw new ConflictException(body)
    default:
      throw new BadRequestException(body)
  }
}

export const run = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (err) {
    answer(err)
  }
}

/** Chess on Lichess (docs/adr/0018). Every route is behind the `games` flag: a 404 while it is off for the member. */
@Controller('v1/games/chess')
@UseGuards(SessionGuard, FeatureGuard)
@Feature('games')
export class ChessController {
  constructor(
    @Inject(ChessService) private readonly chess: ChessService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Inject(ChessGamesService) private readonly games: Pick<ChessGamesService, 'playingNow'>,
    @Inject(TeamsService) private readonly teams: TeamsService,
  ) {}

  @Get()
  overview(@Req() req: AuthedRequest) {
    return this.chess.overview(req.member.id)
  }

  /** Where to send the member to link their Lichess account; `?scope=tournaments` also asks to make tournaments (phase 6). */
  @Post('link')
  async startLink(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { scope } = parse(linkQuery, query)
    await this.limits.hit('lichessLink', req.member.id)
    return run(() => this.chess.startLink(req.member.id, new Date(), { tournaments: scope === 'tournaments' }))
  }

  /** What Lichess sent back to /games/chess/callback, passed on by the web app. */
  @Post('link/complete')
  async completeLink(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { code, state } = parse(completeBody, body)
    await this.limits.hit('lichessLink', req.member.id)
    return run(() => this.chess.completeLink(req.member.id, code, state))
  }

  @Delete('link')
  @HttpCode(204)
  async unlink(@Req() req: AuthedRequest) {
    await this.chess.unlink(req.member.id)
  }

  @Post('ratings/refresh')
  async refresh(@Req() req: AuthedRequest) {
    await this.limits.hit('lichessRefresh', req.member.id)
    return run(() => this.chess.refreshMine(req.member.id))
  }

  /** A member's Lichess account, for their profile; the same 404 whether they have none or cannot be seen. */
  @Get('members/:handle')
  async member(@Req() req: AuthedRequest, @Param('handle') handle: string) {
    const name = parse(handleParam, handle.toLowerCase())
    const account = await this.chess.memberAccount(req.member.id, name)
    if (!account) throw new NotFoundException()
    // The game they are playing now, for "Playing now · Watch".
    return { ...account, playing: await this.games.playingNow(req.member.id, name) }
  }

  @Get('opponents')
  async opponents(@Req() req: AuthedRequest, @Query() query: unknown) {
    await this.limits.hit('mentionSuggest', req.member.id)
    return { members: await this.chess.opponents(req.member.id, parse(opponentsQuery, query).q) }
  }

  @Post('challenges')
  async challenge(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(challengeBody, body)
    await this.limits.hit('chessChallenge', req.member.id)
    return run(() => this.chess.challenge(req.member.id, input))
  }

  @Post('challenges/:id/accept')
  async accept(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    return run(() => this.chess.accept(req.member.id, challengeId(id)))
  }

  @Post('challenges/:id/decline')
  @HttpCode(204)
  async decline(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    await run(() => this.chess.decline(req.member.id, challengeId(id)))
  }

  @Post('challenges/:id/cancel')
  @HttpCode(204)
  async cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    await run(() => this.chess.cancel(req.member.id, challengeId(id)))
  }

  // --- Community teams and tournaments (phase 6) -------------------------------

  @Get('teams/:slug')
  team(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    return run(() => this.teams.view(req.member.id, parse(communitySlug, slug)))
  }

  @Put('teams/:slug')
  @HttpCode(204)
  async linkTeam(@Req() req: AuthedRequest, @Param('slug') slug: string, @Body() body: unknown) {
    const { team } = parse(teamBody, body)
    await this.limits.hit('chessTeam', req.member.id)
    await run(() => this.teams.link(req.member.id, parse(communitySlug, slug), team))
  }

  @Delete('teams/:slug')
  @HttpCode(204)
  async unlinkTeam(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    await this.limits.hit('chessTeam', req.member.id)
    await run(() => this.teams.unlink(req.member.id, parse(communitySlug, slug)))
  }

  @Post('teams/:slug/tournaments')
  async createTournament(@Req() req: AuthedRequest, @Param('slug') slug: string, @Body() body: unknown) {
    const input = parse(tournamentBody, body)
    const name = parse(communitySlug, slug)
    await this.limits.hit('chessTournament', req.member.id)
    return { id: await run(() => this.teams.createTournament(req.member.id, name, input)) }
  }

  @Post('tournaments/:id/cancel')
  async cancelTournament(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    return run(() => this.teams.cancelTournament(req.member.id, challengeId(id)))
  }
}
