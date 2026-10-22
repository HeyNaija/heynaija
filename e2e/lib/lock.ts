// One end-to-end run at a time on this machine. Every run starts by deleting all
// test members (global-setup.ts), so a second run at once deletes the first one's
// members mid-test; in the same checkout Playwright also empties the first one's
// test-results. The lock is a Postgres advisory lock on the dev database, which
// every checkout and worktree shares, and Postgres lets go of it when the run's
// connection closes, however the run ends.
import { basename } from 'node:path'
import pg from 'pg'
import { assertLocal, env, root } from './env.ts'

const NAME = 'heynaija e2e'
const WAIT_MINUTES = 30

/** Waits until no other run holds the lock and takes it. Call what it returns to let go. */
export async function holdRunLock(): Promise<() => Promise<void>> {
  assertLocal()
  const client = new pg.Client({
    connectionString: env.databaseUrl,
    application_name: `${NAME}: pid ${process.pid} in ${basename(root)}`.slice(0, 63),
  })
  // Without this a dropped connection would crash the run; the lock just goes with it.
  client.on('error', (error) => console.warn(`e2e lock: ${error.message}`))
  await client.connect()

  const deadline = Date.now() + WAIT_MINUTES * 60_000
  let waiting = false
  while (!(await tryLock(client))) {
    if (Date.now() > deadline) {
      const who = await holder(client)
      await client.end()
      throw new Error(`gave up after ${WAIT_MINUTES} minutes waiting for ${who}`)
    }
    if (!waiting) console.log(`Waiting for ${await holder(client)} to finish…`)
    waiting = true
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  return () => client.end()
}

async function tryLock(client: pg.Client) {
  const { rows } = await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(hashtext($1)) as ok`, [NAME])
  return rows[0]?.ok === true
}

/** Who holds the lock, as far as Postgres knows: "the e2e run (pid 123 in heynaija, since 14:02:11)". */
async function holder(client: pg.Client) {
  const { rows } = await client.query<{ application_name: string; backend_start: Date }>(
    `select a.application_name, a.backend_start from pg_stat_activity a
       join pg_locks l on l.pid = a.pid and l.locktype = 'advisory' and l.granted
      where a.application_name like $1 and a.pid <> pg_backend_pid()
      limit 1`,
    [`${NAME}:%`],
  )
  if (!rows[0]) return 'another e2e run'
  const { application_name: name, backend_start: since } = rows[0]
  return `the e2e run (${name.slice(NAME.length + 2)}, since ${since.toLocaleTimeString()})`
}
