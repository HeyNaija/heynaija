import { Module } from '@nestjs/common'
import { ChessModule } from './chess/chess.module.js'
import { GamesCoreModule } from './core/games-core.module.js'
import { KenoModule } from './keno/keno.module.js'

/**
 * The Games section (docs/games/GAMES.md, docs/adr/0018). Built on the global
 * PlatformModule for settings, the database, sign-in, feature flags and rate
 * limits. Behind the `games` flag (docs/feature-flags.md).
 */
@Module({
  imports: [GamesCoreModule, ChessModule, KenoModule],
})
export class GamesModule {}
