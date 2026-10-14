// Direct database access, for the two things the UI cannot do quickly: removing
// earlier runs' data, and giving the feed test more posts than the rate limits allow.
import pg from 'pg'
import { assertLocal, env, MARK } from './env.ts'

export function pool() {
  assertLocal()
  return new pg.Pool({ connectionString: env.databaseUrl, max: 2 })
}

/**
 * Removes every member these tests created, everything they did and everything
 * done to them, their invites and their Kratos identities. A member counts only
 * if their handle starts with e2e_ and their Kratos email ends in @e2e.test, so a
 * real member who picked an e2e_ handle is left alone.
 */
export async function cleanTestData(log = (_: string) => {}) {
  const db = pool()
  try {
    const { rows } = await db.query<{ id: string }>(`select id from members where handle like $1`, [
      `${MARK.handlePrefix.replace('_', '\\_')}%`,
    ])
    const ids: string[] = []
    for (const { id } of rows) {
      const res = await fetch(`${env.kratosAdminUrl}/admin/identities/${id}`)
      if (res.status === 404) {
        ids.push(id) // Kratos already forgot it; the app rows are still ours to remove.
        continue
      }
      if (!res.ok) throw new Error(`Kratos identity ${id}: ${res.status}`)
      const identity = (await res.json()) as { traits?: { email?: string } }
      if (identity.traits?.email?.endsWith(`@${MARK.emailDomain}`)) ids.push(id)
    }

    const client = await db.connect()
    try {
      await client.query('begin')
      await client.query(`create temp table e2e_m on commit drop as select unnest($1::uuid[]) as id`, [ids])
      await client.query(`create temp table e2e_p on commit drop as select id from posts where author_id in (select id from e2e_m)`)
      const steps: [string, string][] = [
        ['notifications', `delete from notifications where recipient_id in (select id from e2e_m) or actor_id in (select id from e2e_m)
           or subject_id in (select id from e2e_m) or post_id in (select id from e2e_p)`],
        ['moderation actions', `delete from moderation_actions where actor_id in (select id from e2e_m) or member_id in (select id from e2e_m)
           or post_id in (select id from e2e_p) or report_id in (select id from reports where reporter_id in (select id from e2e_m)
           or member_id in (select id from e2e_m) or post_id in (select id from e2e_p))`],
        ['reports', `delete from reports where reporter_id in (select id from e2e_m) or member_id in (select id from e2e_m)
           or post_id in (select id from e2e_p) or resolved_by in (select id from e2e_m)`],
        ['likes', `delete from likes where member_id in (select id from e2e_m) or post_id in (select id from e2e_p)`],
        ['bookmarks', `delete from bookmarks where member_id in (select id from e2e_m) or post_id in (select id from e2e_p)`],
        ['follows', `delete from follows where follower_id in (select id from e2e_m) or followee_id in (select id from e2e_m)`],
        ['blocks', `delete from blocks where blocker_id in (select id from e2e_m) or blocked_id in (select id from e2e_m)`],
        ['mutes', `delete from mutes where muter_id in (select id from e2e_m) or muted_id in (select id from e2e_m)`],
        ['community memberships', `delete from community_memberships where member_id in (select id from e2e_m)`],
        ['media', `delete from media where owner_id in (select id from e2e_m) or post_id in (select id from e2e_p)`],
        // Replies by others to these posts would be orphaned; tests only reply among themselves.
        ['posts', `delete from posts where id in (select id from e2e_p)`],
        ['invite redemptions', `delete from invite_redemptions where identity_id in (select id from e2e_m)
           or code_hash in (select code_hash from invites where note = $1)`],
        ['members', `delete from members where id in (select id from e2e_m)`],
        ['invites', `delete from invites where note = $1`],
      ]
      for (const [label, sql] of steps) {
        const res = await client.query(sql, sql.includes('$1') ? [MARK.inviteNote] : [])
        if (res.rowCount) log(`${label}: ${res.rowCount}`)
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }

    // Kratos last: if the database step fails, the identities still say what is left.
    for (const id of ids) {
      const res = await fetch(`${env.kratosAdminUrl}/admin/identities/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`Kratos delete ${id}: ${res.status}`)
    }
    if (ids.length) log(`identities: ${ids.length}`)
    return ids.length
  } finally {
    await db.end()
  }
}

/**
 * Gives `handle` `count` plain posts, one second apart, newest last. Returns their
 * ids, newest first. They are dated a day back, so they fill the member's profile
 * without pushing other tests' fresh posts out of the top of Latest.
 */
export async function seedPosts(handle: string, count: number): Promise<string[]> {
  const db = pool()
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into posts (author_id, text, created_at)
       select m.id, 'Seeded post ' || n, now() - interval '1 day' - make_interval(secs => $2 - n)
       from members m, generate_series(1, $2::int) as n
       where m.handle = $1
       returning id`,
      [handle, count],
    )
    if (rows.length !== count) throw new Error(`no member @${handle} to seed posts for`)
    return rows.map((r) => r.id).reverse()
  } finally {
    await db.end()
  }
}
