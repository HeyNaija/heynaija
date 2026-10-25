import { Controller, Get, Inject } from '@nestjs/common'
import { TopicsService } from './topics.service.js'

@Controller('v1/topics')
export class TopicsController {
  constructor(@Inject(TopicsService) private readonly topics: TopicsService) {}

  /** The same for everyone, signed in or not, so it needs no session. */
  @Get('trending')
  trending() {
    return this.topics.trending()
  }
}
