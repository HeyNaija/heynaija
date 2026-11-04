import { Module } from '@nestjs/common'
import type { Env } from '../../env.js'
import { ENV } from '../../tokens.js'
import { TokenBox } from '../core/token-box.js'
import { DrawScheduler } from './draw-scheduler.js'
import { KenoController } from './keno.controller.js'
import { KenoService } from './keno.service.js'
import { KENO_TOKEN_BOX } from './keno-tokens.js'

/** Keno, free to play (docs/games/GAMES.md, docs/adr/0018 phase 4): shared draws, tickets, checking a round, standings. */
@Module({
  controllers: [KenoController],
  providers: [
    // Seeds are sealed until their draw when there is a key; without one they are kept as they are.
    { provide: KENO_TOKEN_BOX, useFactory: (env: Env) => (env.GAMES_TOKEN_KEY ? new TokenBox(env.GAMES_TOKEN_KEY) : null), inject: [ENV] },
    KenoService,
    DrawScheduler,
  ],
})
export class KenoModule {}
