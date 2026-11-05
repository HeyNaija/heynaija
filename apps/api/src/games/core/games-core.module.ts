import { Module } from '@nestjs/common'
import { CompetitionsService } from './competitions.js'
import { CompetitionsJob } from './competitions-job.js'
import { GamesController } from './games.controller.js'

/** The registry, seasons, the Game Score, leaderboards and competitions (docs/games/GAMES.md, docs/adr/0018). */
@Module({
  controllers: [GamesController],
  providers: [CompetitionsService, CompetitionsJob],
  // Chess makes and finishes Lichess tournaments through it (chess/teams.ts).
  exports: [CompetitionsService],
})
export class GamesCoreModule {}
