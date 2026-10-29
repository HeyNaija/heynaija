import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { runMigrations, schema } from './index.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

/**
 * Drizzle's migrator takes no lock and reads the last applied migration without
 * one, so two runners (overlapping deploys) would both apply the same files.
 * A session-level advisory lock, on a fixed key nothing else uses, serialises them.
 */
const MIGRATE_LOCK_KEY = 7_340_001
const LOCK_WAIT_MS = 60_000
const LOCK_RETRY_MS = 500

/**
 * A migration that cannot get its table lock queues behind whatever is using the
 * table, and every later query on that table queues behind it. Failing the
 * deploy after this long is better. No statement_timeout: a legitimate long
 * index build must not be killed. MIGRATE_LOCK_TIMEOUT_MS overrides (0 disables).
 */
const DEFAULT_LOCK_TIMEOUT_MS = 5_000

function lockTimeoutFromEnv(): number {
  const raw = process.env.MIGRATE_LOCK_TIMEOUT_MS
  if (!raw) return DEFAULT_LOCK_TIMEOUT_MS
  const ms = Number(raw)
  if (!Number.isInteger(ms) || ms < 0) throw new Error(`MIGRATE_LOCK_TIMEOUT_MS must be a non-negative integer, got ${raw}`)
  return ms
}

async function acquireLock(client: pg.PoolClient): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS
  let announced = false
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [MIGRATE_LOCK_KEY])
    if (rows[0]?.locked) return
    if (Date.now() >= deadline) {
      throw new Error(`another migration run still holds the migration lock after ${LOCK_WAIT_MS / 1000}s`)
    }
    if (!announced) console.log('waiting for another migration run to finish')
    announced = true
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
  }
}

// The timeout goes in the startup options so every connection the migrator uses has it.
const pool = new pg.Pool({ connectionString: url, max: 2, options: `-c lock_timeout=${lockTimeoutFromEnv()}` })
try {
  // Held on its own connection for the whole run; it is released if that connection drops.
  const lockClient = await pool.connect()
  try {
    await acquireLock(lockClient)
    await runMigrations(drizzle(pool, { schema }))
  } finally {
    await lockClient.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]).catch(() => {})
    lockClient.release()
  }
  console.log('migrations applied')
} finally {
  await pool.end()
}
