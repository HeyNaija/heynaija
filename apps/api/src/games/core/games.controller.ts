import { Controller, Get, UseGuards } from '@nestjs/common'
import { SessionGuard } from '../../auth/session.guard.js'
import { Feature, FeatureGuard } from '../../flags/feature.guard.js'
import { publicManifest } from './manifest.js'
import { GAME_REGISTRY } from './registry.js'

/**
 * Every Games route is behind the `games` flag (docs/feature-flags.md, docs/adr/0018):
 * while it is off for the member, or they are not on its allow-list, the route is a 404.
 */
@Controller('v1/games')
@UseGuards(SessionGuard, FeatureGuard)
@Feature('games')
export class GamesController {
  /** The registry, for the games homepage. */
  @Get()
  list() {
    return { games: GAME_REGISTRY.map(publicManifest) }
  }
}
