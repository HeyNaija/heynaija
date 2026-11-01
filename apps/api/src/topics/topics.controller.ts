import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { OptionalSessionGuard } from '../auth/session.guard.js'
import { Feature, FeatureGuard } from '../flags/feature.guard.js'
import { TopicsService } from './topics.service.js'

@Controller('v1/topics')
export class TopicsController {
  constructor(@Inject(TopicsService) private readonly topics: TopicsService) {}

  /** The same for everyone, signed in or not. */
  @Get('trending')
  @UseGuards(OptionalSessionGuard, FeatureGuard)
  @Feature('topicDiscovery')
  trending() {
    return this.topics.trending()
  }
}
