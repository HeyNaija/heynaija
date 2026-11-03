import { Module } from '@nestjs/common'
import { GamesController } from './games.controller.js'

/** Registry, manifests and the switch now; seasons, scoring, leaderboards and competitions later (docs/games/GAMES.md). */
@Module({
  controllers: [GamesController],
})
export class GamesCoreModule {}
