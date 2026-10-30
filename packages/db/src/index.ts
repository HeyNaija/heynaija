import { fileURLToPath } from 'node:url'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as schema from './schema.js'

export * from './schema.js'
export { schema }

export type Db = NodePgDatabase<typeof schema>

/**
 * pg's default of 10 connections made API requests queue for a connection under
 * load while Postgres sat idle. DATABASE_POOL_MAX overrides it (staging uses less).
 */
const DEFAULT_POOL_MAX = 20

export function createDb(url: string, { max = poolMaxFromEnv() }: { max?: number } = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max })
  return { db: drizzle(pool, { schema }), pool }
}

function poolMaxFromEnv(): number {
  const raw = process.env.DATABASE_POOL_MAX
  if (!raw) return DEFAULT_POOL_MAX
  const max = Number(raw)
  if (!Number.isInteger(max) || max < 1) throw new Error(`DATABASE_POOL_MAX must be a positive integer, got ${raw}`)
  return max
}

/**
 * Drizzle's migrator takes no lock and reads the last applied migration without
 * one, so two runners (overlapping deploys) would both apply the same files.
 * A session-level advisory lock, on a fixed key nothing else uses, serialises them.
 */
export const MIGRATE_LOCK_KEY = 7_340_001

/**
 * A migration that cannot get its table lock queues behind whatever is using the
 * table, and every later query on that table queues behind it. Failing the run
 * after this long is better. No statement_timeout: a legitimate long index build
 * must not be killed. MIGRATE_LOCK_TIMEOUT_MS overrides (0 disables). Unset or
 * empty (compose passes an empty string when the server's .env does not set it)
 * means the default.
 */
export const DEFAULT_LOCK_TIMEOUT_MS = 5_000

export function parseLockTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_LOCK_TIMEOUT_MS
  const ms = Number(raw)
  if (!Number.isInteger(ms) || ms < 0) throw new Error(`MIGRATE_LOCK_TIMEOUT_MS must be a non-negative integer, got ${raw}`)
  return ms
}

export interface MigrateOptions {
  /** Defaults to MIGRATE_LOCK_TIMEOUT_MS, then 5000. 0 disables. */
  lockTimeoutMs?: number
  /** How many times to run the whole batch when lock_timeout fires (default 3). */
  attempts?: number
  /** Pause between those tries (default 2000). No lock is held during it. */
  retryPauseMs?: number
  /** How long to wait for another run to release the migration lock (default 60000). */
  lockWaitMs?: number
  migrationsFolder?: string
  log?: (message: string) => void
}

const LOCK_RETRY_MS = 500
const LOCK_TIMEOUT_SQLSTATE = '55P03'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Drizzle wraps driver errors, so look down the `cause` chain for the SQLSTATE. */
function isLockTimeout(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 5; e = e.cause as typeof e, depth++) {
    if (e.code === LOCK_TIMEOUT_SQLSTATE) return true
  }
  return false
}

/**
 * Applies the pending migrations, alone: the advisory lock and the migrations
 * share ONE connection, so the lock lives exactly as long as the session that
 * migrates (a dropped connection frees it and stops the run). lock_timeout is
 * set on that connection. If lock_timeout fires the batch has rolled back, so it
 * is tried again a couple of times, holding nothing in between.
 */
export async function runMigrations(url: string, options: MigrateOptions = {}): Promise<void> {
  const lockTimeoutMs = options.lockTimeoutMs ?? parseLockTimeout(process.env.MIGRATE_LOCK_TIMEOUT_MS)
  const attempts = options.attempts ?? 3
  const retryPauseMs = options.retryPauseMs ?? 2_000
  const log = options.log ?? console.log
  for (let attempt = 1; ; attempt++) {
    try {
      await runOnce(url, lockTimeoutMs, options.lockWaitMs ?? 60_000, options.migrationsFolder, log)
      return
    } catch (err) {
      if (!isLockTimeout(err) || attempt >= attempts) throw err
      log(`migration could not get a table lock within ${lockTimeoutMs}ms (try ${attempt} of ${attempts}); trying again in ${retryPauseMs}ms`)
      await sleep(retryPauseMs)
    }
  }
}

async function runOnce(
  url: string,
  lockTimeoutMs: number,
  lockWaitMs: number,
  migrationsFolder: string | undefined,
  log: (message: string) => void,
): Promise<void> {
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 0) throw new Error(`lockTimeoutMs must be a non-negative integer, got ${lockTimeoutMs}`)
  const client = new pg.Client({ connectionString: url })
  // An idle connection that drops emits 'error'; with no listener that would be an uncaught exception.
  // Remember it, and the run fails through the finally below (the lock went with the session).
  let lost: Error | undefined
  client.on('error', (err) => {
    lost = err
  })
  await client.connect()
  try {
    // SET, not the startup `options` parameter: a DATABASE_URL with its own ?options= would override that.
    await client.query(`set lock_timeout = ${lockTimeoutMs}`)
    const deadline = Date.now() + lockWaitMs
    let announced = false
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [MIGRATE_LOCK_KEY])
      if (rows[0]?.locked) break
      if (Date.now() >= deadline) throw new Error(`another migration run still holds the migration lock after ${lockWaitMs / 1000}s`)
      if (!announced) log('waiting for another migration run to finish')
      announced = true
      await sleep(LOCK_RETRY_MS)
    }
    await migrate(drizzle(client, { schema }), {
      migrationsFolder: migrationsFolder ?? fileURLToPath(new URL('../drizzle', import.meta.url)),
    })
    if (lost) throw new Error(`the migration connection dropped during the run: ${lost.message}`)
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]).catch(() => {})
    await client.end().catch(() => {})
  }
}
