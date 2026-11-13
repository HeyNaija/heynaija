import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import type { Env } from '../../env.js'
import { ENV } from '../../tokens.js'
import { TeamsService } from './teams.js'

const QUEUE = 'chess-tournaments'
const SCHEDULER = 'sync-chess-tournaments'

const connection = (env: Pick<Env, 'REDIS_URL'>) => ({ url: env.REDIS_URL, maxRetriesPerRequest: null })

/**
 * Follows community tournaments on Lichess (docs/adr/0028, phase 6): reads the
 * standings of those under way and finishes those Lichess has finished
 * (TeamsService.sync). One run at a time however many API processes there are,
 * as often as standings may be read but at least once a minute.
 */
@Injectable()
export class TournamentsJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ChessTournaments')
  private queue?: Queue
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Pick<Env, 'REDIS_URL' | 'CHESS_STANDINGS_EVERY_MS'>,
    @Inject(TeamsService) private readonly teams: Pick<TeamsService, 'sync'>,
  ) {}

  async onApplicationBootstrap() {
    this.queue = new Queue(QUEUE, { connection: connection(this.env), defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } } })
    await this.queue.upsertJobScheduler(SCHEDULER, { every: Math.min(60_000, this.env.CHESS_STANDINGS_EVERY_MS) }, { name: 'sync', data: {} })
    this.worker = new Worker(
      QUEUE,
      async () => {
        const finished = await this.teams.sync()
        if (finished.length) this.logger.log(`finished tournament${finished.length > 1 ? 's' : ''} ${finished.join(', ')}`)
      },
      { connection: connection(this.env), concurrency: 1 },
    )
    this.worker.on('failed', (job, err) => this.logger.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy() {
    await this.worker?.close()
    await this.queue?.close()
  }
}
