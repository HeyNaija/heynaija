import type { Db } from '@heynaija/db'
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DB } from '../../tokens.js'

const CHANNEL = 'chess_game'

/** The little of a pg pool client this needs. */
type PoolClient = {
  on(event: 'notification', listener: (msg: { payload?: string }) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  query(text: string): Promise<unknown>
  release(err?: Error): void
}

/** drizzle keeps the pg pool it was made with as `$client`. */
const poolOf = (db: Db) => (db as unknown as { $client: { connect(): Promise<PoolClient> } }).$client

/** Tells every API process a game changed. Runs inside the caller's transaction, if any: Postgres sends it on commit. */
export async function publishGameChange(db: Pick<Db, 'execute'>, gameId: string): Promise<void> {
  await db.execute(sql`select pg_notify(${CHANNEL}, ${gameId})`)
}

/** Waits for a game to change, for the long-poll. */
export interface GameChanges {
  /** Resolves when `gameId` changes, or after `ms`, whichever is first. */
  wait(gameId: string, ms: number): Promise<void>
}

export const GAME_CHANGES = Symbol('GAME_CHANGES')

/**
 * One `LISTEN chess_game` connection per API process (docs/adr/0028): whichever
 * process watches a game on Lichess, every process's long-polls hear about it.
 * If the connection drops, waiters time out as usual and it reconnects.
 */
@Injectable()
export class GameEvents implements GameChanges, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ChessEvents')
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

  wait(gameId: string, ms: number): Promise<void> {
    return new Promise((done) => {
      const set = this.waiters.get(gameId) ?? new Set()
      const finish = () => {
        clearTimeout(timer)
        set.delete(finish)
        if (!set.size) this.waiters.delete(gameId)
        done()
      }
      const timer = setTimeout(finish, ms)
      set.add(finish)
      this.waiters.set(gameId, set)
    })
  }

  private wake(gameId: string) {
    for (const finish of [...(this.waiters.get(gameId) ?? [])]) finish()
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
