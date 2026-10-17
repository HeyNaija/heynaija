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

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  })
}
