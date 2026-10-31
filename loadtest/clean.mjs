// Removes everything seed.mjs and the k6 runs created: the seeded members, their
// posts, likes, follows and notifications, anything real members did to them,
// and their Kratos identities. Meant for a dev database; a throwaway server is
// simply deleted instead.
import { rm } from 'node:fs/promises'
import { checkKratosAdmin, connectToThrowaway, env } from './lib/target.mjs'

const pool = await connectToThrowaway()
checkKratosAdmin()
const { rows: [{ seeded }] } = await pool.query(`select to_regclass('public.loadtest_members') is not null as seeded`)
if (!seeded) {
  console.log('no load-test data here')
  await pool.end()
  process.exit(0)
}

// Kratos first: if this stops halfway, the tables still say what is left to do.
const { rows: identities } = await pool.query(`select id from loadtest_members where kratos`)
const queue = identities.map((r) => r.id)
await Promise.all(
  Array.from({ length: 10 }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const res = await fetch(`${env.kratosAdminUrl}/admin/identities/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`Kratos delete ${id}: ${res.status}`)
    }
  }),
)
console.log(`deleted ${identities.length} Kratos identities`)

const db = await pool.connect()
await db.query(`set statement_timeout = 0`)
await db.query('begin')
// Posts by load-test members, including any k6 created during a run.
await db.query(`
  create temp table lt_m on commit drop as select id from loadtest_members;
  create temp table lt_p on commit drop as select id from posts where author_id in (select id from lt_m);
  create index on lt_m (id); create index on lt_p (id); analyze lt_m; analyze lt_p`)
const steps = [
  ['notifications', `delete from notifications where recipient_id in (select id from lt_m) or actor_id in (select id from lt_m)
     or subject_id in (select id from lt_m) or post_id in (select id from lt_p)`],
  ['moderation actions', `delete from moderation_actions where actor_id in (select id from lt_m) or member_id in (select id from lt_m)
     or post_id in (select id from lt_p) or report_id in (select id from reports where reporter_id in (select id from lt_m)
     or member_id in (select id from lt_m) or post_id in (select id from lt_p))`],
  ['reports', `delete from reports where reporter_id in (select id from lt_m) or member_id in (select id from lt_m)
     or post_id in (select id from lt_p) or resolved_by in (select id from lt_m)`],
  ['notification settings', `delete from notification_opt_outs where member_id in (select id from lt_m)`],
  ['mentions', `delete from post_mentions where member_id in (select id from lt_m) or post_id in (select id from lt_p)`],
  ['hashtags', `delete from post_hashtags where post_id in (select id from lt_p)`],
  ['likes', `delete from likes where member_id in (select id from lt_m) or post_id in (select id from lt_p)`],
  ['reposts', `delete from reposts where member_id in (select id from lt_m) or post_id in (select id from lt_p)`],
  ['bookmarks', `delete from bookmarks where member_id in (select id from lt_m) or post_id in (select id from lt_p)`],
  ['follows', `delete from follows where follower_id in (select id from lt_m) or followee_id in (select id from lt_m)`],
  ['blocks', `delete from blocks where blocker_id in (select id from lt_m) or blocked_id in (select id from lt_m)`],
  ['mutes', `delete from mutes where muter_id in (select id from lt_m) or muted_id in (select id from lt_m)`],
  ['community memberships', `delete from community_memberships where member_id in (select id from lt_m)`],
  ['media', `delete from media where owner_id in (select id from lt_m) or post_id in (select id from lt_p)`],
  ['idea votes', `delete from idea_votes where member_id in (select id from lt_m) or post_id in (select id from lt_p)`],
  ['idea history', `delete from idea_status_changes where post_id in (select id from lt_p) or moderator_id in (select id from lt_m)`],
  ['problem details', `delete from problem_details where post_id in (select id from lt_p)`],
  ['duplicates reopened', `update ideas set status = 'under_review', duplicate_of = null where duplicate_of in (select id from lt_p) and post_id not in (select id from lt_p)`],
  ['ideas', `delete from ideas where post_id in (select id from lt_p)`],
  ['posts', `delete from posts where id in (select id from lt_p)`],
  ['privacy requests', `delete from privacy_requests where member_id in (select id from lt_m) or handled_by in (select id from lt_m)`],
  ['members', `delete from members where id in (select id from lt_m)`],
  ['thread bookkeeping', `drop table if exists loadtest_thread_fixtures`],
  ['bookkeeping', `drop table loadtest_posts, loadtest_members`],
]
for (const [label, sql] of steps) {
  const res = await db.query(sql)
  console.log(`${label.padEnd(24)} ${res.rowCount ?? ''}`)
}
await db.query('commit')
db.release()
await pool.end()
await rm(new URL('.sessions.json', import.meta.url), { force: true })
await rm(new URL('.threads.json', import.meta.url), { force: true })
console.log('clean')
