import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import type { Env } from '../../env.js'
import { ENV } from '../../tokens.js'
import { KenoService } from './keno.service.js'

const QUEUE = 'keno-draws'
const SCHEDULER = 'keno-draw'

const connection = (env: Pick<Env, 'REDIS_URL'>) => ({ url: env.REDIS_URL, maxRetriesPerRequest: null })

/**
 * Makes Keno's shared draws (docs/adr/0018, phase 4). The job scheduler runs one
 * draw job per interval, lined up with the clock, however many API processes
 * there are, and each run draws whatever is due (KenoService.tick), so a run that
 * comes twice or late changes nothing. On start it draws any round missed while
 * the API was down.
 */
@Injectable()
export class DrawScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('KenoDraws')
  private queue?: Queue
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Pick<Env, 'REDIS_URL' | 'KENO_DRAW_EVERY_MS'>,
    @Inject(KenoService) private readonly keno: Pick<KenoService, 'tick'>,
  ) {}

  async onApplicationBootstrap() {
    this.queue = new Queue(QUEUE, { connection: connection(this.env), defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } } })
    await this.queue.upsertJobScheduler(SCHEDULER, { every: this.env.KENO_DRAW_EVERY_MS }, { name: 'draw', data: {} })
    this.worker = new Worker(QUEUE, async () => void (await this.keno.tick()), { connection: connection(this.env) })
    this.worker.on('failed', (job, err) => this.logger.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
    await this.keno.tick().catch((err) => this.logger.warn(`catching up on draws: ${(err as Error).message}`))
  }

  async onModuleDestroy() {
    await this.worker?.close()
    await this.queue?.close()
  }
}
