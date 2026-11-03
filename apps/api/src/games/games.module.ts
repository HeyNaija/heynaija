import { Module } from '@nestjs/common'
import { ChessModule } from './chess/chess.module.js'
import { GamesCoreModule } from './core/games-core.module.js'
import { KenoModule } from './keno/keno.module.js'

/**
 * The Games section (docs/games/GAMES.md, docs/adr/0018). Built on the global
 * PlatformModule for settings, the database, sign-in and rate limits. Dark unless
 * GAMES_ENABLED is on.
 */
@Module({
  imports: [GamesCoreModule, ChessModule, KenoModule],
})
export class GamesModule {}
