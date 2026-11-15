import { Module } from '@nestjs/common'
import { ROUND_CHANGES, RoundEvents } from './round-events.js'
import { TriviaController } from './trivia.controller.js'
import { TriviaJob } from './trivia-job.js'
import { TriviaService } from './trivia.service.js'

/** Trivia (docs/games/GAMES.md, docs/adr/0028 phase 7): live rounds, answers kept apart until each question closes, points and results. */
@Module({
  controllers: [TriviaController],
  providers: [TriviaService, RoundEvents, { provide: ROUND_CHANGES, useExisting: RoundEvents }, TriviaJob],
})
export class TriviaModule {}
