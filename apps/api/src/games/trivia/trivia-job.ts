import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import type { Env } from '../../env.js'
import { ENV } from '../../tokens.js'
import { TriviaService } from './trivia.service.js'

const QUEUE = 'trivia'
const SCHEDULER = 'trivia-tick'
/** Questions nobody is watching are judged, idle rounds end, and results publish themselves within this. */
export const TRIVIA_EVERY_MS = 30_000

const connection = (env: Pick<Env, 'REDIS_URL'>) => ({ url: env.REDIS_URL, maxRetriesPerRequest: null })

/**
 * Trivia's background work (docs/adr/0028, phase 7): one run every half minute
 * however many API processes there are. Players' own requests judge a question
 * the moment it closes; this catches the rest (TriviaService.tick).
 */
@Injectable()
export class TriviaJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Trivia')
  private queue?: Queue
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Pick<Env, 'REDIS_URL'>,
    @Inject(TriviaService) private readonly trivia: Pick<TriviaService, 'tick'>,
  ) {}

  async onApplicationBootstrap() {
    this.queue = new Queue(QUEUE, { connection: connection(this.env), defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } } })
    await this.queue.upsertJobScheduler(SCHEDULER, { every: TRIVIA_EVERY_MS }, { name: 'tick', data: {} })
    this.worker = new Worker(QUEUE, async () => void (await this.trivia.tick()), { connection: connection(this.env) })
    this.worker.on('failed', (job, err) => this.logger.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy() {
    await this.worker?.close()
    await this.queue?.close()
  }
}
