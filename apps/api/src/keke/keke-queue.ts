import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { KEKE_QUEUE, type KekeJob, kekeConfigured, kekeConnection } from './keke-jobs.js'
import { KekeService } from './keke.service.js'

// Each answer is mostly waiting on the model. A few at a time keeps one slow answer
// from holding up the rest without letting a burst of mentions run up the bill at once.
const CONCURRENCY = 2

/**
 * The consumer side, in the API process like the other workers: answers the
 * posts that mention Keke. Does nothing when the server has no model key.
 * Whether Keke answers anyone is the keke flag's to say, read for each post, so
 * turning it on or off needs no restart.
 */
@Injectable()
export class KekeWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Keke')
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(KekeService) private readonly keke: KekeService,
  ) {}

  onApplicationBootstrap(): void {
    if (!kekeConfigured(this.env)) {
      this.log.log('Keke is off: neither ANTHROPIC_API_KEY nor OPENROUTER_API_KEY is set')
      return
    }
    this.worker = new Worker(
      KEKE_QUEUE,
      async (job) => {
        const { name, data } = job as unknown as KekeJob
        if (name !== 'answer') return
        const result = await this.keke.answer(data.postId)
        if (result.done === 'failed') this.log.warn(`no answer for ${data.postId}: every model failed`)
      },
      { connection: kekeConnection(this.env), concurrency: CONCURRENCY },
    )
    this.worker.on('failed', (job, err) => this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
