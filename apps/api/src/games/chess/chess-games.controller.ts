import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../../auth/session.guard.js'
import { Feature, FeatureGuard } from '../../flags/feature.guard.js'
import { parse } from '../../http.js'
import { RateLimiter } from '../../rate-limit.js'
import { ChessGamesService } from './chess-games.service.js'
import { run } from './chess.controller.js'
import { GAME_CHANGES, type GameChanges } from './game-events.js'

/** How long a page's request waits for the next change before answering "nothing new" (docs/adr/0018). */
export const LONG_POLL_MS = 25_000

const gameId = (id: string) => {
  if (!/^[A-Za-z0-9]{8,12}$/.test(id)) throw new NotFoundException()
  return id
}
const afterQuery = z.object({ after: z.coerce.number().int().min(-1).default(-1) })
// UCI: from and to squares, and a promotion piece.
const moveBody = z.object({ uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/) })
const drawBody = z.object({ answer: z.enum(['offer', 'accept', 'decline']) })

/** Playing and watching games (docs/adr/0018, phase 3). Behind the `games` flag like the rest. */
@Controller('v1/games/chess/games')
@UseGuards(SessionGuard, FeatureGuard)
@Feature('games')
export class ChessGamesController {
  constructor(
    @Inject(ChessGamesService) private readonly games: ChessGamesService,
    @Inject(GAME_CHANGES) private readonly changes: GameChanges,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** Games being played now, for "Live now". */
  @Get('live')
  async live(@Req() req: AuthedRequest) {
    return { games: await this.games.live(req.member.id) }
  }

  /**
   * A game. With `after`, the version the page has: answers at once with anything
   * newer, else waits up to LONG_POLL_MS for the next change and answers then
   * (the same game when nothing changed). One plain answer each time, so nothing
   * between the browser and here has to keep a stream open.
   */
  @Get(':id')
  async view(@Req() req: AuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const { after } = parse(afterQuery, query)
    const game = await this.games.view(req.member.id, gameId(id))
    if (!game) throw new NotFoundException()
    if (game.version > after || game.finished) return game
    await this.changes.wait(game.id, LONG_POLL_MS)
    return (await this.games.view(req.member.id, game.id)) ?? game
  }

  @Post(':id/move')
  @HttpCode(204)
  async move(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { uci } = parse(moveBody, body)
    await this.limits.hit('chessMove', req.member.id)
    await run(() => this.games.act(req.member.id, gameId(id), { kind: 'move', uci }))
  }

  @Post(':id/draw')
  @HttpCode(204)
  async draw(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { answer } = parse(drawBody, body)
    await this.limits.hit('chessMove', req.member.id)
    await run(() => this.games.act(req.member.id, gameId(id), { kind: 'draw', answer }))
  }

  @Post(':id/resign')
  @HttpCode(204)
  async resign(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('chessMove', req.member.id)
    await run(() => this.games.act(req.member.id, gameId(id), { kind: 'resign' }))
  }

  @Post(':id/abort')
  @HttpCode(204)
  async abort(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('chessMove', req.member.id)
    await run(() => this.games.act(req.member.id, gameId(id), { kind: 'abort' }))
  }
}
