import { fileURLToPath } from 'node:url'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as schema from './schema.js'

export * from './schema.js'
export { schema }

export type Db = NodePgDatabase<typeof schema>

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url })
  return { db: drizzle(pool, { schema }), pool }
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  })
}
