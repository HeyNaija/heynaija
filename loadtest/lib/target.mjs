// Where the load-test scripts point, and the checks that stop them from ever
// writing into a database that real people use.
//
// A database is accepted only if it is either:
//   - local: reached on a loopback address, with no more than a handful of real
//     (non-load-test) members in it, as on a developer's machine; or
//   - explicitly named as throwaway: its Postgres runs with
//     cluster_name = 'heynaija-loadtest' (loadtest/compose.loadtest.yml sets this),
//     and LOADTEST_THROWAWAY_DB names the same host/database, e.g. "127.0.0.1/heynaija".
// Anything else (staging, production, a copy someone forgot about) is refused.
import pg from 'pg'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const THROWAWAY_CLUSTER = 'heynaija-loadtest'
// More real members than this means people use the database: not a dev box.
const MAX_REAL_MEMBERS = 500

export const env = {
  databaseUrl: process.env.LOADTEST_DATABASE_URL ?? process.env.DATABASE_URL,
  kratosAdminUrl: (process.env.KRATOS_ADMIN_URL ?? 'http://127.0.0.1:4534').replace(/\/$/, ''),
  // The web app; sessions are minted through its /kratos proxy like a browser would.
  baseUrl: (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, ''),
  mailpitUrl: (process.env.MAILPIT_URL ?? 'http://127.0.0.1:8026').replace(/\/$/, ''),
}

export function die(message) {
  console.error(`\nrefusing to run: ${message}\n`)
  process.exit(1)
}

/** Connects and checks the database is one we may fill with junk. Returns the pool. */
export async function connectToThrowaway() {
  if (!env.databaseUrl) die('set LOADTEST_DATABASE_URL (or DATABASE_URL in .env)')
  const url = new URL(env.databaseUrl)
  const host = url.hostname
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || decodeURIComponent(url.username)

  if (/prod|staging|live/i.test(`${host}/${database}`)) die(`${host}/${database} looks like a real environment`)
  if (process.env.NODE_ENV === 'production') die('NODE_ENV is production')

  const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 4 })
  const { rows: [{ cluster }] } = await pool.query(`select current_setting('cluster_name') as cluster`)
  const named = process.env.LOADTEST_THROWAWAY_DB
  const local = LOOPBACK.has(host)

  if (cluster === THROWAWAY_CLUSTER) {
    if (named !== `${host}/${database}`) {
      die(`this is a throwaway load-test cluster; confirm it with LOADTEST_THROWAWAY_DB=${host}/${database}`)
    }
  } else if (!local) {
    die(`${host} is not a loopback address and its Postgres is not cluster_name=${THROWAWAY_CLUSTER}`)
  }

  const { rows: [{ exists }] } = await pool.query(`select to_regclass('public.members') is not null as exists`)
  if (!exists) die('the app schema is missing; run the migrations first (pnpm db:migrate)')

  if (cluster !== THROWAWAY_CLUSTER) {
    const { rows: [{ seeded }] } = await pool.query(`select to_regclass('public.loadtest_members') is not null as seeded`)
    const { rows: [{ real }] } = await pool.query(
      seeded
        ? `select count(*)::int as real from members m where not exists (select 1 from loadtest_members lm where lm.id = m.id)`
        : `select count(*)::int as real from members`,
    )
    if (real > MAX_REAL_MEMBERS) die(`${real} real members in ${database}: this is not a throwaway database`)
  }

  console.log(`target: ${host}/${database}${cluster ? ` (cluster ${cluster})` : ''}`)
  return pool
}

/** Kratos admin must also be local, or on the named throwaway host. */
export function checkKratosAdmin() {
  const host = new URL(env.kratosAdminUrl).hostname
  const named = process.env.LOADTEST_THROWAWAY_DB?.split('/')[0]
  if (!LOOPBACK.has(host) && host !== named) die(`Kratos admin ${host} is neither loopback nor the named throwaway host`)
}
