import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import type { Db } from '@heynaija/db'
import type { Env } from '../../env.js'
import { DB, ENV } from '../../tokens.js'
import { CompetitionsService } from './competitions.js'
import { scoreUnscored } from './scoring.js'

const QUEUE = 'games-competitions'
const SCHEDULER = 'advance-competitions'
/** Competitions move on (start, finish) within a minute of their times. */
export const COMPETITIONS_EVERY_MS = 60_000

const connection = (env: Pick<Env, 'REDIS_URL'>) => ({ url: env.REDIS_URL, maxRetriesPerRequest: null })

/**
 * The Games core's background work (docs/adr/0028, phase 5): once a minute, one
 * run however many API processes there are, moves competitions on by the clock
 * (CompetitionsService.tick). On start, it also scores any game events written
 * before XP existed, once.
 */
@Injectable()
export class CompetitionsJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('GamesCore')
  private queue?: Queue
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Pick<Env, 'REDIS_URL'>,
    @Inject(DB) private readonly db: Db,
    @Inject(CompetitionsService) private readonly competitions: Pick<CompetitionsService, 'tick'>,
  ) {}

  async onApplicationBootstrap() {
    const scored = await scoreUnscored(this.db).catch((err) => {
      this.logger.warn(`scoring earlier game events: ${(err as Error).message}`)
      return 0
    })
    if (scored) this.logger.log(`scored ${scored} earlier game events for the Game Score`)
    this.queue = new Queue(QUEUE, { connection: connection(this.env), defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } } })
    await this.queue.upsertJobScheduler(SCHEDULER, { every: COMPETITIONS_EVERY_MS }, { name: 'advance', data: {} })
    this.worker = new Worker(
      QUEUE,
      async () => {
        const finished = await this.competitions.tick()
        if (finished.length) this.logger.log(`finished competition${finished.length > 1 ? 's' : ''} ${finished.join(', ')}`)
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
