import type { Db } from '@heynaija/db'
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { DB } from '../../tokens.js'

const CHANNEL = 'trivia_round'

type PoolClient = {
  on(event: 'notification', listener: (msg: { payload?: string }) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  query(text: string): Promise<unknown>
  release(err?: Error): void
}

const poolOf = (db: Db) => (db as unknown as { $client: { connect(): Promise<PoolClient> } }).$client

/** Waits for a round to change, for the long-poll. */
export interface RoundChanges {
  /** Resolves when `roundId` changes, or after `ms`, whichever is first. */
  wait(roundId: string, ms: number): Promise<void>
}

export const ROUND_CHANGES = Symbol('ROUND_CHANGES')

/**
 * One `LISTEN trivia_round` connection per API process, as chess's GameEvents: a
 * question opened, judged or voided in any process wakes every process's
 * long-polls (notifyRound in trivia.service.ts). If it drops, waiters time out as
 * usual and it reconnects.
 */
@Injectable()
export class RoundEvents implements RoundChanges, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('TriviaEvents')
  private readonly waiters = new Map<string, Set<() => void>>()
  private client?: PoolClient
  private closed = false

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap() {
    await this.connect()
  }

  async onModuleDestroy() {
    this.closed = true
    this.client?.release()
  }

  wait(roundId: string, ms: number): Promise<void> {
    return new Promise((done) => {
      const set = this.waiters.get(roundId) ?? new Set()
      const finish = () => {
        clearTimeout(timer)
        set.delete(finish)
        if (!set.size) this.waiters.delete(roundId)
        done()
      }
      const timer = setTimeout(finish, Math.max(0, ms))
      set.add(finish)
      this.waiters.set(roundId, set)
    })
  }

  private wake(roundId: string) {
    for (const finish of [...(this.waiters.get(roundId) ?? [])]) finish()
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    try {
      const client = await poolOf(this.db).connect()
      client.on('notification', (msg) => msg.payload && this.wake(msg.payload))
      client.on('error', (err) => {
        this.logger.warn(`lost the ${CHANNEL} listener: ${err.message}; reconnecting`)
        client.release(err)
        this.client = undefined
        setTimeout(() => void this.connect(), 1000)
      })
      await client.query(`LISTEN ${CHANNEL}`)
      this.client = client
    } catch (err) {
      this.logger.warn(`could not listen for ${CHANNEL}: ${(err as Error).message}; trying again`)
      setTimeout(() => void this.connect(), 5000)
    }
  }
}
