import { Module } from '@nestjs/common'
import type { Env } from '../../env.js'
import { ENV } from '../../tokens.js'
import { TokenBox } from '../core/token-box.js'
import { ChessController } from './chess.controller.js'
import { ChessService, LICHESS, TOKEN_BOX } from './chess.service.js'
import { HttpLichess } from './lichess.js'
import { RatingsRefresher } from './ratings-refresher.js'

/**
 * Chess on Lichess (docs/games/GAMES.md, docs/adr/0018): linking, ratings and
 * challenges in phase 2; playing inside HeyNaija in phase 3.
 */
@Module({
  controllers: [ChessController],
  providers: [
    { provide: LICHESS, useFactory: (env: Env) => new HttpLichess(env.LICHESS_URL), inject: [ENV] },
    // Without GAMES_TOKEN_KEY there is nowhere safe to keep tokens, so linking is not offered.
    { provide: TOKEN_BOX, useFactory: (env: Env) => (env.GAMES_TOKEN_KEY ? new TokenBox(env.GAMES_TOKEN_KEY) : null), inject: [ENV] },
    ChessService,
    RatingsRefresher,
  ],
  exports: [ChessService],
})
export class ChessModule {}
