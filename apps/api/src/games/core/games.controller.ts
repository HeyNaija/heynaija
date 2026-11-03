import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common'
import { type AuthedRequest, SessionGuard } from '../../auth/session.guard.js'
import type { Env } from '../../env.js'
import { routeNotFound } from '../../http.js'
import { ENV } from '../../tokens.js'
import { GamesEnabledGuard, gamesFeatureFor } from './games-enabled.js'
import { publicManifest } from './manifest.js'
import { GAME_REGISTRY } from './registry.js'

@Controller('v1/games')
@UseGuards(GamesEnabledGuard, SessionGuard)
export class GamesController {
  constructor(@Inject(ENV) private readonly env: Pick<Env, 'GAMES_ENABLED' | 'GAMES_MEMBERS'>) {}

  /** The registry, for the games homepage. A member off the allow-list gets the same 404 as with the switch off. */
  @Get()
  list(@Req() req: AuthedRequest) {
    if (!gamesFeatureFor(this.env, req.member)) throw routeNotFound(req)
    return { games: GAME_REGISTRY.map(publicManifest) }
  }
}
