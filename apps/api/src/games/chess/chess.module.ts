import { Module } from '@nestjs/common'
import type { Env } from '../../env.js'
import { ENV } from '../../tokens.js'
import { TokenBox } from '../core/token-box.js'
import { ArenaSetup } from './arena-setup.js'
import { ChessGamesController } from './chess-games.controller.js'
import { ChessGamesService } from './chess-games.service.js'
import { ChessController } from './chess.controller.js'
import { ChessService } from './chess.service.js'
import { GAME_STARTER, LICHESS, TOKEN_BOX } from './chess-tokens.js'
import { GAME_CHANGES, GameEvents } from './game-events.js'
import { GameWatcher } from './game-watcher.js'
import { HttpLichess } from './lichess.js'
import { RatingsRefresher } from './ratings-refresher.js'

/**
 * Chess on Lichess (docs/games/GAMES.md, docs/adr/0018): linking, ratings and
 * challenges (phase 2); playing, watching, Chess Arena and results (phase 3).
 */
@Module({
  controllers: [ChessController, ChessGamesController],
  providers: [
    { provide: LICHESS, useFactory: (env: Env) => new HttpLichess(env.LICHESS_URL), inject: [ENV] },
    // Without GAMES_TOKEN_KEY there is nowhere safe to keep tokens, so linking is not offered.
    { provide: TOKEN_BOX, useFactory: (env: Env) => (env.GAMES_TOKEN_KEY ? new TokenBox(env.GAMES_TOKEN_KEY) : null), inject: [ENV] },
    ChessService,
    ChessGamesService,
    GameEvents,
    { provide: GAME_CHANGES, useExisting: GameEvents },
    GameWatcher,
    { provide: GAME_STARTER, useExisting: GameWatcher },
    RatingsRefresher,
    // The Arbiter and Chess Arena, made when the API starts if they are not there yet.
    ArenaSetup,
  ],
  exports: [ChessService],
})
export class ChessModule {}
