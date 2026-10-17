// Fills a throwaway HeyNaija database with a realistic amount of data, so load
// tests read from tables the size production will have, not from an empty box.
//
//   pnpm --filter @heynaija/loadtest seed --members=10000
//   node seed.mjs --members=1000000 --kratos=2000
//
// Every member gets a row in `members`, but only the first --kratos of them get
// a real Kratos identity (and so can sign in). Those are the load-test users k6
// plays. The rest exist only in the app database, which is all the feed, profile
// and notification queries look at. Kratos looks sessions up by token, so its
// speed does not depend on how many identities it holds; see docs/loadtest.md
// for importing all of them anyway.
//
// Everything created is listed in loadtest_members / loadtest_posts, which is
// how clean.mjs finds it again. Refuses to touch anything but a local or
// explicitly named throwaway database (lib/target.mjs).
import { parseArgs } from 'node:util'
import { checkKratosAdmin, connectToThrowaway, die, env } from './lib/target.mjs'

const { values: args } = parseArgs({
  options: {
    members: { type: 'string', default: '10000' },
    kratos: { type: 'string', default: '2000' },
    'posts-per-member': { type: 'string', default: '3' },
    'follows-per-member': { type: 'string', default: '12' },
    'likes-per-member': { type: 'string', default: '10' },
  },
})
const N = Number(args.members)
const K = Math.min(Number(args.kratos), N)
const P = Math.round(N * Number(args['posts-per-member']))
const F = Math.round(N * Number(args['follows-per-member']))
const L = Math.round(N * Number(args['likes-per-member']))
if (![N, K, P, F, L].every((n) => Number.isInteger(n) && n >= 0) || N < 10) die('bad counts')

// Popularity is a power law over a "rank", and rank -> member is a fixed shuffle
// (rank * A + B mod N), so the most-followed accounts are not simply the first
// ones, which are the Kratos-backed users k6 signs in as.
const gcd = (a, b) => (b ? gcd(b, a % b) : a)
const coprime = (start) => {
  let a = start
  while (gcd(a, N) !== 1) a++
  return a
}
const A = coprime(7919)
const A2 = coprime(104729)
const rankToIdx = (expr, a = A, b = 13) => `((${expr})::bigint * ${a} + ${b}) % ${N}`

const TOP = [
  'Who else is stuck in traffic on Third Mainland Bridge right now?',
  'Jollof debate is settled: Nigerian jollof wins, no further questions.',
  'Just shipped my first side project. Feedback welcome!',
  'NEPA took light again. Generator don start.',
  'Anyone know a good tailor around Yaba? Need agbada for a wedding.',
  'ASUU strike update: lecturers say talks continue next week.',
  'Super Eagles squad list is out. Thoughts?',
  'Lagos rent is wild. 2.5m for a mini flat in Lekki??',
  'Looking for a frontend dev role, 3 years React. DMs open.',
  'Best suya spot in Abuja, go.',
  'The new Burna album is on repeat all week.',
  'Small business owners: how are you handling the dollar rate?',
  'Wahala be like bicycle. Today na my turn.',
  'Fuel queue for two hours this morning. Make e no happen to you.',
  'Grateful for this community. You people are the best.',
]
const REPLIES = [
  'Omo, this one dey hot.', 'Facts!', 'I no gree o.', 'Same here, honestly.', 'Thanks for sharing.',
  'Which area exactly?', 'Can you send more details?', 'Lol this made my day.', 'Wahala.', 'Congrats!',
]
const FIRST = ['Ada', 'Chidi', 'Tunde', 'Ngozi', 'Emeka', 'Bisi', 'Musa', 'Aisha', 'Ifeoma', 'Segun', 'Zainab', 'Kelechi']
const LAST = ['Okafor', 'Adeyemi', 'Bello', 'Eze', 'Ibrahim', 'Okonkwo', 'Balogun', 'Nwosu', 'Abubakar', 'Olawale']
const BIOS = ['Software engineer in Lagos.', 'Student. UNILAG.', 'Football, food and Afrobeats.', 'Building things.', 'Abuja based.']

const pool = await connectToThrowaway()
checkKratosAdmin()
const db = await pool.connect()
await db.query(`set synchronous_commit = off; set statement_timeout = 0; set work_mem = '64MB'`)

const { rows: [{ seeded }] } = await db.query(`select to_regclass('public.loadtest_members') is not null as seeded`)
if (seeded) die('this database already has load-test data; run `pnpm --filter @heynaija/loadtest clean` first')
const { rows: comms } = await db.query(`select id from communities where active`)
if (!comms.length) die('no communities; run `pnpm db:seed` first')
const communityIds = comms.map((c) => c.id)

const started = Date.now()
const step = async (label, sql, params) => {
  const t = Date.now()
  const res = await db.query(sql, params)
  console.log(`${label.padEnd(36)} ${String(res.rowCount ?? '').padStart(10)} rows  ${((Date.now() - t) / 1000).toFixed(1)}s`)
}
// Large inserts in slices, so progress shows and no single statement runs for an hour.
const SLICE = 1_000_000
const sliced = async (label, total, sqlFor) => {
  for (let lo = 0; lo < total; lo += SLICE) {
    const hi = Math.min(total, lo + SLICE)
    await step(`${label} ${lo}-${hi}`, sqlFor(lo, hi))
  }
}

console.log(`seeding ${N} members (${K} with Kratos identities), ${P} posts, ~${F} follows, ~${L} likes\n`)

await db.query(`
  create table loadtest_members (idx int primary key, id uuid not null unique, kratos boolean not null default false);
  create table loadtest_posts (idx int primary key, id uuid not null unique)`)

// 1. Kratos identities for the members k6 will sign in as, in batches through
//    the admin API. Their Kratos ID is their member ID, as for a real signup.
const BATCH = 500
let created = 0
const createBatch = async (from) => {
  const idxs = Array.from({ length: Math.min(BATCH, K - from) }, (_, i) => from + i)
  const res = await fetch(`${env.kratosAdminUrl}/admin/identities`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identities: idxs.map((i) => ({
        create: {
          schema_id: 'member',
          state: 'active',
          traits: { email: `lt_${i}@loadtest.test`, handle: `lt_${i}` },
          verifiable_addresses: [{ value: `lt_${i}@loadtest.test`, via: 'email', verified: true, status: 'completed' }],
        },
      })),
    }),
  })
  if (!res.ok) throw new Error(`Kratos batch create: ${res.status} ${await res.text()}`)
  const { identities } = await res.json()
  const ids = identities.map((r, i) => {
    if (!r.identity) throw new Error(`Kratos refused lt_${idxs[i]}: ${JSON.stringify(r.error ?? r)}`)
    return r.identity
  })
  await pool.query(
    `insert into loadtest_members (idx, id, kratos) select * , true from unnest($1::int[], $2::uuid[])`,
    [idxs, ids],
  )
  created += ids.length
}
{
  const t = Date.now()
  const starts = Array.from({ length: Math.ceil(K / BATCH) }, (_, i) => i * BATCH)
  for (let i = 0; i < starts.length; i += 4) await Promise.all(starts.slice(i, i + 4).map(createBatch))
  console.log(`${'kratos identities'.padEnd(36)} ${String(created).padStart(10)} rows  ${((Date.now() - t) / 1000).toFixed(1)}s`)
}

// 2. Members.
await step('member ids', `insert into loadtest_members (idx, id) select g, gen_random_uuid() from generate_series(${K}, ${N - 1}) g`)
await step('members', `
  insert into members (id, handle, display_name, bio, created_at, last_seen_at)
  select id, 'lt_' || idx,
    case when random() < 0.6 then ($1::text[])[1 + floor(random() * cardinality($1))::int] || ' ' || ($2::text[])[1 + floor(random() * cardinality($2))::int] end,
    case when random() < 0.3 then ($3::text[])[1 + floor(random() * cardinality($3))::int] else '' end,
    now() - random() * interval '730 days',
    case when random() < 0.4 then now() - random() * interval '30 days' end
  from loadtest_members`, [FIRST, LAST, BIOS])
await step('community memberships', `
  insert into community_memberships (community_id, member_id, joined_at)
  select ($1::uuid[])[1 + floor(random() * cardinality($1))::int], id, now() - random() * interval '365 days'
  -- 30% join one community, 10% a second. The subquery keeps random() per row:
  -- as a plain WHERE it would be pushed down and drawn once per n.
  from (select id, n, random() as r from loadtest_members, generate_series(1, 2) as g(n) offset 0) x
  where r < (case n when 1 then 0.3 else 0.1 end)
  on conflict do nothing`, [communityIds])

// 3. Posts: four in five are top-level, spread over the last 90 days (newer posts
//    have higher idx); one in five is a reply, mostly to a recent post.
await step('post ids', `insert into loadtest_posts select g, gen_random_uuid() from generate_series(0, ${P - 1}) g`)
await sliced('posts (top-level)', P, (lo, hi) => ({
  text: `
    insert into posts (id, author_id, text, community_id, created_at, deleted_at)
    select p.id, m.id, ($1::text[])[1 + floor(random() * cardinality($1))::int] || ' #' || p.idx,
      case when random() < 0.25 then ($2::uuid[])[1 + floor(random() * cardinality($2))::int] end,
      p.at, case when random() < 0.01 then p.at + interval '1 hour' end
    from (
      select idx, id, ${rankToIdx(`floor(${N} * power(random(), 2.5))`)} as aidx,
        now() - interval '90 days' * (1 - idx::float8 / ${P}) - random() * interval '10 minutes' as at
      from loadtest_posts where idx >= ${lo} and idx < ${hi} and idx % 5 <> 4
    ) p join loadtest_members m on m.idx = p.aidx`,
  values: [TOP, communityIds],
}))
await sliced('posts (replies)', P, (lo, hi) => ({
  text: `
    insert into posts (id, author_id, text, reply_parent_id, root_id, community_id, created_at)
    select r.id, m.id, ($1::text[])[1 + floor(random() * cardinality($1))::int],
      par.id, coalesce(par.root_id, par.id), par.community_id,
      par.created_at + random() * least(interval '2 days', now() - par.created_at)
    from (
      select idx, id, ${rankToIdx(`floor(${N} * power(random(), 2))`)} as aidx,
        5 * floor((idx / 5) * (1 - power(random(), 3)))::int as pidx
      from loadtest_posts where idx >= ${lo} and idx < ${hi} and idx % 5 = 4
    ) r
    join loadtest_members m on m.idx = r.aidx
    join loadtest_posts lp on lp.idx = r.pidx
    join posts par on par.id = lp.id`,
  values: [REPLIES],
}))

// 4. Follows: everyone follows a few accounts; who gets followed is a power law,
//    so a handful of accounts have a large share of all followers.
await sliced('follows', F, (lo, hi) => `
  insert into follows (follower_id, followee_id, created_at)
  select a.id, b.id, now() - random() * interval '365 days'
  from (
    select floor(random() * ${N})::int as fi, ${rankToIdx(`floor(${N} * power(random(), 3))`)} as ti
    from generate_series(${lo}, ${hi - 1})
  ) x
  join loadtest_members a on a.idx = x.fi
  join loadtest_members b on b.idx = x.ti
  where a.id <> b.id
  on conflict do nothing`)

// 5. Likes: active members like more, and recent posts get most of the likes.
await sliced('likes', L, (lo, hi) => `
  insert into likes (member_id, post_id, created_at)
  select m.id, po.id, po.created_at + random() * least(interval '3 days', now() - po.created_at)
  from (
    select ${rankToIdx(`floor(${N} * power(random(), 1.5))`, A2, 7)} as mi,
      least(${P - 1}, floor(${P} * (1 - power(random(), 4))))::int as pi
    from generate_series(${lo}, ${hi - 1})
  ) x
  join loadtest_members m on m.idx = x.mi
  join loadtest_posts lp on lp.idx = x.pi
  join posts po on po.id = lp.id
  on conflict do nothing`)

// 6. Notifications, as the app writes them: one per like, follow and reply
//    someone else did. Anything older than two days has been read.
const readAt = (at) => `case when ${at} < now() - interval '2 days' then ${at} + interval '1 hour' end`
await step('notifications (likes)', `
  insert into notifications (recipient_id, kind, actor_id, post_id, created_at, read_at)
  select po.author_id, 'like', l.member_id, l.post_id, l.created_at, ${readAt('l.created_at')}
  from likes l join loadtest_posts lp on lp.id = l.post_id join posts po on po.id = l.post_id
  where po.author_id <> l.member_id
  on conflict do nothing`)
await step('notifications (follows)', `
  insert into notifications (recipient_id, kind, actor_id, created_at, read_at)
  select f.followee_id, 'follow', f.follower_id, f.created_at, ${readAt('f.created_at')}
  from follows f join loadtest_members lm on lm.id = f.follower_id
  on conflict do nothing`)
await step('notifications (replies)', `
  insert into notifications (recipient_id, kind, actor_id, post_id, created_at, read_at)
  select par.author_id, 'reply', r.author_id, r.id, r.created_at, ${readAt('r.created_at')}
  from loadtest_posts lp join posts r on r.id = lp.id join posts par on par.id = r.reply_parent_id
  where par.author_id <> r.author_id`)

await step('analyze', 'analyze')
db.release()
await pool.end()
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s. Next: pnpm --filter @heynaija/loadtest sessions`)
