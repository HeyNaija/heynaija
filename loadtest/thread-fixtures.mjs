// Optional, deterministic thread shapes on top of seed.mjs. All authors and
// posts stay in the existing cleanup bookkeeping; normal seeding stays small.
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { connectToThrowaway, die, env } from './lib/target.mjs'

const { values: args } = parseArgs({ options: {
  wide: { type: 'string', default: '10000' },
  depth: { type: 'string', default: '65' },
  filtered: { type: 'string', default: '1000' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean' },
} })
if (args.help) {
  console.log('node thread-fixtures.mjs [--wide=10000|100000] [--depth=65] [--filtered=1000] [--dry-run]')
  process.exit(0)
}
const wide = Number(args.wide)
const depth = Number(args.depth)
const filtered = Number(args.filtered)
if (![wide, depth, filtered].every(Number.isInteger) || wide < 40 || wide > 100000 || depth < 51 || depth > 1000 || filtered < 40 || filtered > 100000) {
  die('wide and filtered must be integers from 40 to 100000; depth must be from 51 to 1000')
}
const plan = { wideReplies: wide, deepReplies: depth, filteredReplies: filtered, readingBranches: 4, readingBranchReplies: 200, timestampTieReplies: 80 }
if (args['dry-run']) {
  console.log(JSON.stringify(plan, null, 2))
  process.exit(0)
}

const pool = await connectToThrowaway()
const db = await pool.connect()
let manifest
try {
  const { rows: [state] } = await db.query(`select
    to_regclass('public.loadtest_members') is not null as seeded,
    to_regclass('public.loadtest_thread_fixtures') is not null as threaded`)
  if (!state.seeded) throw new Error('run seed.mjs first')
  if (state.threaded) throw new Error('thread fixtures already exist; clean and seed again, or restore the pre-fixture snapshot')
  const { rows: viewers } = await db.query(`select lm.id, m.handle from loadtest_members lm
    join members m on m.id = lm.id where lm.kratos and m.active order by lm.idx limit 1`)
  if (!viewers.length) throw new Error('seed at least one Kratos-backed member, then mint its session')
  const viewer = viewers[0]
  const { rows: [author] } = await db.query(`select lm.id from loadtest_members lm
    join members m on m.id = lm.id where lm.id <> $1 and m.active order by lm.idx limit 1`, [viewer.id])
  if (!author) throw new Error('seed at least two active members')

  await db.query('begin')
  await db.query(`create table loadtest_thread_fixtures (name text primary key, id uuid not null)`)
  const { rows: [indices] } = await db.query(`select
    (select coalesce(max(idx), -1) + 1 from loadtest_members) as member,
    (select coalesce(max(idx), -1) + 1 from loadtest_posts) as post`)
  let postIndex = indices.post
  const hidden = Object.fromEntries(['muted', 'blocked', 'blocker', 'inactive'].map((name) => [name, randomUUID()]))
  for (const [i, [name, id]] of Object.entries(hidden).entries()) {
    await db.query('insert into loadtest_members (idx, id) values ($1, $2)', [indices.member + i, id])
    await db.query('insert into members (id, handle, active) values ($1, $2, $3)', [id, `lt_thread_${name}`, name !== 'inactive'])
  }
  await db.query('insert into mutes (muter_id, muted_id) values ($1, $2)', [viewer.id, hidden.muted])
  await db.query('insert into blocks (blocker_id, blocked_id) values ($1, $2), ($3, $1)', [viewer.id, hidden.blocked, hidden.blocker])

  // Tracking and post insertion share a transaction, including bulk statements.
  // All times come from SQL and retain microseconds for the late-page cursor.
  async function post(name, parent = null, root = null, state = 'live', seconds = 0) {
    const id = randomUUID()
    await db.query(`insert into posts (id, author_id, text, reply_parent_id, root_id, created_at, deleted_at, removed_at)
      values ($1, $2, $3, $4, $5, date_trunc('second', now()) - interval '1 day' + $6 * interval '1 second',
        case when $7 = 'deleted' then now() end, case when $7 = 'removed' then now() end)`,
    [id, author.id, `Load test thread ${name}`, parent, root, seconds, state])
    await db.query('insert into loadtest_posts (idx, id) values ($1, $2)', [postIndex++, id])
    await db.query('insert into loadtest_thread_fixtures (name, id) values ($1, $2)', [name, id])
    return id
  }
  async function children(parent, root, count, kind = 'live') {
    await db.query(`with inserted as (
      insert into posts (author_id, text, reply_parent_id, root_id, created_at)
      select case when $5 = 'filtered' then
          case g % 10 when 0 then $1::uuid when 1 then $6::uuid when 2 then $6::uuid
            when 3 then $6::uuid when 4 then $7::uuid when 5 then $7::uuid
            when 6 then $8::uuid when 7 then $8::uuid else $9::uuid end
        else $1::uuid end,
        'Load test thread reply ' || g, $2::uuid, $3::uuid,
        date_trunc('second', now()) - interval '1 day' + interval '10 seconds'
          + case when $5 = 'ties' and g <= 40 then interval '0.000123 seconds'
              when $5 = 'ties' then (g - 40) * interval '0.000001 seconds'
              else g * interval '0.000001 seconds' end
      from generate_series(1, $4::int) g returning id
    ) insert into loadtest_posts (idx, id) select $10::int + row_number() over ()::int - 1, id from inserted`,
    [author.id, parent, root, count, kind, hidden.muted, hidden.blocked, hidden.blocker, hidden.inactive, postIndex])
    postIndex += count
  }

  const reading = [await post('reading')]
  for (let level = 1; level < 4; level++) reading.push(await post(`reading-${level}`, reading.at(-1), reading[0], 'live', level))
  for (const parent of reading) await children(parent, reading[0], 200)
  const wideRoot = await post('wide')
  await children(wideRoot, wideRoot, wide)
  const filteredRoot = await post('filtered')
  await children(filteredRoot, filteredRoot, filtered, 'filtered')
  const ties = await post('ties')
  await children(ties, ties, 80, 'ties')
  const deleted = await post('deleted')
  const deletedFirst = await post('deleted-first', deleted, deleted, 'deleted', 1)
  const deletedSecond = await post('deleted-second', deletedFirst, deleted, 'removed', 2)
  const survivor = await post('survivor', deletedSecond, deleted, 'live', 3)
  await post('deleted-leaf', deleted, deleted, 'deleted', 4)
  const goneRoot = await post('gone-root', null, null, 'deleted')
  const goneRootSurvivor = await post('gone-root-survivor', goneRoot, goneRoot, 'live', 1)
  const hot = await post('hot')
  const deepRoot = await post('deep-root')
  const deepIds = Array.from({ length: depth }, () => randomUUID())
  await db.query(`with inserted as (
    insert into posts (id, author_id, text, reply_parent_id, root_id, created_at)
    select id, $3::uuid, 'Load test deep reply ' || n,
      case when n = 1 then $2::uuid else lag(id) over (order by n) end, $2::uuid,
      date_trunc('second', now()) - interval '1 day' + n * interval '1 second'
    from unnest($1::uuid[]) with ordinality x(id, n) returning id
  ) insert into loadtest_posts (idx, id) select $4::int + row_number() over ()::int - 1, id from inserted`,
  [deepIds, deepRoot, author.id, postIndex])
  await db.query('insert into loadtest_thread_fixtures (name, id) values ($1, $2)', ['deep-leaf', deepIds.at(-1)])

  const { rows: [anchor] } = await db.query(`select id,
    to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
    from posts where reply_parent_id = $1 order by created_at, id offset $2 limit 1`, [wideRoot, Math.floor(wide * 0.9) - 1])
  manifest = {
    version: 1, baseUrl: env.baseUrl, viewerHandle: viewer.handle, ...plan,
    reading, wide: wideRoot,
    // Versioned ascending reply cursor contract; no lossy JavaScript Date conversion.
    wideLateCursor: Buffer.from(JSON.stringify([1, wideRoot, 'asc', anchor.at, anchor.id])).toString('base64url'),
    deep: deepIds.at(-1), filtered: filteredRoot, hiddenAuthors: Object.values(hidden),
    ties, deleted, deletedFirst, deletedSecond, survivor, goneRoot, goneRootSurvivor, hot,
  }
  await db.query('commit')
  await db.query('analyze posts')
} catch (error) {
  await db.query('rollback')
  throw error
} finally {
  db.release()
  await pool.end()
}
await writeFile(new URL('.threads.json', import.meta.url), JSON.stringify(manifest, null, 2))
console.log(`thread fixtures ready: ${wide} wide replies, depth ${depth}, ${filtered} filtered replies -> loadtest/.threads.json`)
