import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import type { Env } from '../../env.js'
import { ENV } from '../../tokens.js'
import { ChessService } from './chess.service.js'

const QUEUE = 'chess-ratings'
const SCHEDULER = 'refresh-chess-ratings'
/** Lichess ratings are read again every six hours, a few hundred accounts a call. */
export const RATINGS_REFRESH_EVERY_MS = 6 * 3600_000

const connection = (env: Pick<Env, 'REDIS_URL'>) => ({ url: env.REDIS_URL, maxRetriesPerRequest: null })

/**
 * Keeps linked members' Lichess ratings fresh (docs/adr/0018). The job scheduler
 * keeps it to one run per interval however many API processes there are. It only
 * touches accounts members linked, so with nobody linked it does nothing.
 */
@Injectable()
export class RatingsRefresher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ChessRatings')
  private queue?: Queue
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Pick<Env, 'REDIS_URL'>,
    @Inject(ChessService) private readonly chess: Pick<ChessService, 'refreshDue'>,
  ) {}

  async onApplicationBootstrap() {
    this.queue = new Queue(QUEUE, { connection: connection(this.env), defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } } })
    await this.queue.upsertJobScheduler(SCHEDULER, { every: RATINGS_REFRESH_EVERY_MS }, { name: 'refresh', data: {} })
    this.worker = new Worker(
      QUEUE,
      async () => {
        const n = await this.chess.refreshDue()
        if (n) this.logger.log(`refreshed Lichess ratings for ${n} members`)
      },
      { connection: connection(this.env) },
    )
    this.worker.on('failed', (job, err) => this.logger.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy() {
    await this.worker?.close()
    await this.queue?.close()
  }
}
