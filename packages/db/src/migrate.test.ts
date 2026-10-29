import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import pg from 'pg'
import { DEFAULT_LOCK_TIMEOUT_MS, MIGRATE_LOCK_KEY, parseLockTimeout, runMigrations } from './index.js'

// The database tests need Postgres (run via `pnpm --filter @heynaija/db test`). They use
// a throwaway database and migration folders of their own: Drizzle remembers the newest
// migration it applied, so fake migrations must never share a database with the real ones.

type T = { after: (fn: () => void | Promise<void>) => void }

function withEnv(value: string | undefined): () => void {
  const before = process.env.MIGRATE_LOCK_TIMEOUT_MS
  if (value === undefined) delete process.env.MIGRATE_LOCK_TIMEOUT_MS
  else process.env.MIGRATE_LOCK_TIMEOUT_MS = value
  return () => {
    if (before === undefined) delete process.env.MIGRATE_LOCK_TIMEOUT_MS
    else process.env.MIGRATE_LOCK_TIMEOUT_MS = before
  }
}

test('MIGRATE_LOCK_TIMEOUT_MS: unset and empty mean the default, 0 disables, junk is refused', () => {
  assert.equal(parseLockTimeout(undefined), DEFAULT_LOCK_TIMEOUT_MS)
  assert.equal(DEFAULT_LOCK_TIMEOUT_MS, 5000)
  assert.equal(parseLockTimeout(''), DEFAULT_LOCK_TIMEOUT_MS)
  assert.equal(parseLockTimeout('  '), DEFAULT_LOCK_TIMEOUT_MS)
  assert.equal(parseLockTimeout('0'), 0)
  assert.equal(parseLockTimeout('250'), 250)
  for (const bad of ['abc', '-1', '1.5', '1e3x']) assert.throws(() => parseLockTimeout(bad), /MIGRATE_LOCK_TIMEOUT_MS must be a non-negative integer/, bad)
})

test('runMigrations refuses a bad MIGRATE_LOCK_TIMEOUT_MS before it connects', async () => {
  const restore = withEnv('soon')
  try {
    await assert.rejects(runMigrations('postgres://nobody@127.0.0.1:1/none'), /MIGRATE_LOCK_TIMEOUT_MS must be/)
  } finally {
    restore()
  }
})

const testUrl = process.env.TEST_DATABASE_URL
const scratchName = `heynaija_migrate_${process.pid}`
const scratchUrl = (() => {
  const u = new URL(testUrl ?? 'postgres://localhost/x')
  u.pathname = `/${scratchName}`
  return u.toString()
})()
const noLog = () => {}

async function connect(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  return c
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>, url = testUrl as string): Promise<T> {
  const c = await connect(url)
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** A migrations folder whose nth entry runs `sqls[n]`. */
function folder(t: T, sqls: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'db-migrate-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'meta'))
  const entries = sqls.map((sql, idx) => {
    const tag = `${String(idx).padStart(4, '0')}_m`
    writeFileSync(join(dir, `${tag}.sql`), sql)
    return { idx, version: '7', when: 1_700_000_000_000 + idx, tag, breakpoints: true }
  })
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries }))
  return dir
}

/** Each test gets an empty database so no earlier run's journal rows leak in. */
const freshDb = () =>
  admin(async (c) => {
    await c.query(`drop database if exists ${scratchName} with (force)`)
    await c.query(`create database ${scratchName}`)
  })

const lockIsFree = () =>
  admin(async (c) => (await c.query('select pg_try_advisory_lock($1) as ok', [MIGRATE_LOCK_KEY])).rows[0].ok as boolean, scratchUrl)

/** Polls until `condition` holds, instead of sleeping for a guessed time. */
async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** True when some other session in the scratch database is waiting for a lock in a query that mentions `table`. */
const blockedOnLock = (table: string) =>
  admin(
    async (c) =>
      (
        await c.query(
          `select 1 from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like $2`,
          [scratchName, `%${table}%`],
        )
      ).rowCount === 1,
    scratchUrl,
  )

/** A second connection holding an ACCESS EXCLUSIVE lock on `busy` until it rolls back. */
async function holdBusy(t: T): Promise<pg.Client> {
  await admin((c) => c.query('create table busy (id int)'), scratchUrl)
  const holder = await connect(scratchUrl)
  t.after(() => holder.end())
  await holder.query('begin')
  await holder.query('lock table busy in access exclusive mode')
  return holder
}

if (testUrl) {
  after(() => admin((c) => c.query(`drop database if exists ${scratchName} with (force)`)))

  test('two runs at once: the second waits, then finds nothing left to do', async (t) => {
    await freshDb()
    // The first run is parked on a table lock the test holds, so it stays inside its migration
    // (and holds the migration lock) for exactly as long as the test wants: no sleeps to race.
    const holder = await holdBusy(t)
    const dir = folder(t, ['select count(*) from busy;--> statement-breakpoint\ncreate table once (id int);'])
    const logs: string[] = []
    const order: string[] = []
    const first = runMigrations(scratchUrl, { migrationsFolder: dir, lockTimeoutMs: 0, log: noLog }).then(() => order.push('first'))
    await waitFor(() => blockedOnLock('busy'), 'the first run to block on the table lock')
    const second = runMigrations(scratchUrl, { migrationsFolder: dir, log: (m) => logs.push(m) }).then(() => order.push('second'))
    await waitFor(async () => logs.length > 0, 'the second run to report that it is waiting')
    assert.deepEqual(order, [], 'neither run can have finished while the first is blocked')
    await holder.query('rollback')
    await Promise.all([first, second])
    assert.deepEqual(order, ['first', 'second'])
    assert.deepEqual(logs, ['waiting for another migration run to finish'])
    // Had they raced, the second `create table once` would have failed.
    await admin(async (c) => assert.equal((await c.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0].n, 1), scratchUrl)
  })

  test('a run gives up if the lock is held longer than lockWaitMs', async (t) => {
    await freshDb()
    const dir = folder(t, ['create table w (id int);'])
    const holder = await connect(scratchUrl)
    t.after(() => holder.end())
    await holder.query('select pg_advisory_lock($1)', [MIGRATE_LOCK_KEY])
    await assert.rejects(runMigrations(scratchUrl, { migrationsFolder: dir, lockWaitMs: 700, log: noLog }), /still holds the migration lock/)
  })

  test('lock_timeout is set on the connection that migrates', async (t) => {
    await freshDb()
    const dir = folder(t, ["create table seen as select current_setting('lock_timeout') as v;"])
    await runMigrations(scratchUrl, { migrationsFolder: dir, lockTimeoutMs: 1234, log: noLog })
    await admin(async (c) => assert.equal((await c.query('select v from seen')).rows[0].v, '1234ms'), scratchUrl)
  })

  test('lock_timeout wins over an ?options= in DATABASE_URL', async (t) => {
    await freshDb()
    const dir = folder(t, ["create table seen as select current_setting('lock_timeout') as v;"])
    const u = new URL(scratchUrl)
    u.searchParams.set('options', '-c lock_timeout=1')
    await runMigrations(u.toString(), { migrationsFolder: dir, lockTimeoutMs: 4321, log: noLog })
    await admin(async (c) => assert.equal((await c.query('select v from seen')).rows[0].v, '4321ms'), scratchUrl)
  })

  test('a connection that is killed mid-run rejects the run instead of crashing the process', async (t) => {
    await freshDb()
    const holder = await holdBusy(t)
    const dir = folder(t, ['select count(*) from busy;'])
    const run = runMigrations(scratchUrl, { migrationsFolder: dir, lockTimeoutMs: 0, attempts: 1, log: noLog })
    await waitFor(() => blockedOnLock('busy'), 'the run to block on the table lock')
    await admin((c) => c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() and wait_event_type = 'Lock'`, [scratchName]), scratchUrl)
    await assert.rejects(run)
    await holder.query('rollback')
    assert.equal(await lockIsFree(), true)
  })

  test('an empty MIGRATE_LOCK_TIMEOUT_MS gives the 5s default on the connection', async (t) => {
    await freshDb()
    const dir = folder(t, ["create table seen as select current_setting('lock_timeout') as v;"])
    const restore = withEnv('')
    try {
      await runMigrations(scratchUrl, { migrationsFolder: dir, log: noLog })
    } finally {
      restore()
    }
    await admin(async (c) => assert.equal((await c.query('select v from seen')).rows[0].v, '5s'), scratchUrl)
  })

  test('a held table lock fails the run with lock_timeout, rolls it back and leaves the migration lock free', async (t) => {
    await freshDb()
    const holder = await holdBusy(t)
    const dir = folder(t, ['create table first_stmt (id int);--> statement-breakpoint\nalter table busy add column x int;'])
    const started = Date.now()
    await assert.rejects(
      runMigrations(scratchUrl, { migrationsFolder: dir, lockTimeoutMs: 200, attempts: 1, log: noLog }),
      (err: { code?: string; cause?: { code?: string } }) => (err.code ?? err.cause?.code) === '55P03',
    )
    assert.ok(Date.now() - started < 5_000, 'it should fail at lock_timeout, not wait for the lock')
    await holder.query('rollback')
    await admin(async (c) => assert.equal((await c.query(`select to_regclass('first_stmt') as t`)).rows[0].t, null), scratchUrl)
    assert.equal(await lockIsFree(), true)
  })

  test('lock_timeout is retried, holding nothing in between, and the run then succeeds', async (t) => {
    await freshDb()
    const holder = await holdBusy(t)
    const dir = folder(t, ['alter table busy add column x int;'])
    const logs: string[] = []
    // The lock is released the moment the run reports its first failed try, i.e. while it pauses
    // holding nothing. Later tries, if the release is slow, simply time out again and retry.
    await runMigrations(scratchUrl, {
      migrationsFolder: dir,
      lockTimeoutMs: 200,
      attempts: 5,
      retryPauseMs: 300,
      log: (m) => {
        logs.push(m)
        if (m.includes('trying again')) void holder.query('rollback')
      },
    })
    assert.ok(logs.some((m) => m.includes('trying again')), logs.join('\n'))
    await admin(
      async (c) => assert.equal((await c.query(`select count(*)::int as n from information_schema.columns where table_name = 'busy' and column_name = 'x'`)).rows[0].n, 1),
      scratchUrl,
    )
    assert.equal(await lockIsFree(), true)
  })

  test('the run is tried at most `attempts` times, then the lock_timeout error is raised', async (t) => {
    await freshDb()
    const holder = await holdBusy(t)
    const dir = folder(t, ['alter table busy add column x int;'])
    const logs: string[] = []
    await assert.rejects(runMigrations(scratchUrl, { migrationsFolder: dir, lockTimeoutMs: 100, attempts: 3, retryPauseMs: 50, log: (m) => logs.push(m) }))
    assert.equal(logs.filter((m) => m.includes('trying again')).length, 2)
    await holder.query('rollback')
  })

  test('a failing migration is not retried, rolls back, and releases the lock', async (t) => {
    await freshDb()
    const dir = folder(t, ['create table ok_first (id int);--> statement-breakpoint\nselect * from does_not_exist;'])
    const logs: string[] = []
    await assert.rejects(runMigrations(scratchUrl, { migrationsFolder: dir, retryPauseMs: 10, log: (m) => logs.push(m) }), /does_not_exist/)
    assert.deepEqual(logs, [])
    await admin(async (c) => assert.equal((await c.query(`select to_regclass('ok_first') as t`)).rows[0].t, null), scratchUrl)
    assert.equal(await lockIsFree(), true)
  })
}
