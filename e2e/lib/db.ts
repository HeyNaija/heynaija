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
        ['notification settings', `delete from notification_opt_outs where member_id in (select id from e2e_m)`],
        ['push subscriptions', `delete from push_subscriptions where member_id in (select id from e2e_m)`],
        ['link previews', `delete from link_previews where url like 'https://links.e2e.test/%'`],
        ['mentions', `delete from post_mentions where member_id in (select id from e2e_m) or post_id in (select id from e2e_p)`],
        ['hashtags', `delete from post_hashtags where post_id in (select id from e2e_p)`],
        ['likes', `delete from likes where member_id in (select id from e2e_m) or post_id in (select id from e2e_p)`],
        ['reposts', `delete from reposts where member_id in (select id from e2e_m) or post_id in (select id from e2e_p)`],
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
        ['released handles', `delete from released_handles where member_id in (select id from e2e_m)`],
        ['profile badges', `delete from profile_badges where member_id in (select id from e2e_m)`],
        ['verifications', `delete from restricted.identity_verifications where member_id in (select id from e2e_m)
           or reviewed_by in (select id from e2e_m)`],
        ['voting memberships', `delete from restricted.governance_memberships where member_id in (select id from e2e_m)`],
        ['age records', `delete from restricted.age_assurances where member_id in (select id from e2e_m)`],
        ['governance audit', `delete from restricted.governance_audit_log where subject_id in (select id from e2e_m)`],
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

/** A wide conversation plus a branch through two deleted intermediate replies. */
export async function seedThread(handle: string) {
  const db = pool()
  const client = await db.connect()
  try {
    await client.query('begin')
    const { rows: authors } = await client.query<{ id: string }>('select id from members where handle = $1', [handle])
    const author = authors[0]?.id
    if (!author) throw new Error(`no member @${handle} to seed a conversation for`)
    const { rows: roots } = await client.query<{ id: string }>(
      "insert into posts (author_id, text, created_at) values ($1, $2, now() - interval '1 day') returning id",
      [author, `Thread fixture from ${handle}`],
    )
    const root = roots[0]!.id
    const { rows: replies } = await client.query<{ id: string; text: string }>(
      `insert into posts (author_id, text, reply_parent_id, root_id, created_at)
       select $1, 'Thread reply ' || lpad(n::text, 2, '0') || ' from ' || $3, $2, $2,
         now() - interval '1 day' + make_interval(secs => n)
       from generate_series(1, 25) as n returning id, text`,
      [author, root, handle],
    )
    const first = replies.find((r) => r.text.startsWith('Thread reply 01 '))!.id
    const bridgeParent = replies.find((r) => r.text.startsWith('Thread reply 02 '))!.id
    const { rows: nested } = await client.query<{ id: string; text: string }>(
      `insert into posts (author_id, text, reply_parent_id, root_id, created_at)
       select $1, 'Nested reply ' || n || ' from ' || $4, $2, $3,
         now() - interval '1 day' + make_interval(secs => 30 + n)
       from generate_series(1, 2) as n returning id, text`,
      [author, first, root, handle],
    )
    const { rows: bridges } = await client.query<{ id: string }>(
      `insert into posts (author_id, text, reply_parent_id, root_id, deleted_at)
       values ($1, 'Deleted bridge content must not appear', $2, $3, now()) returning id`,
      [author, bridgeParent, root],
    )
    const bridge = bridges[0]!.id
    const { rows: nextBridges } = await client.query<{ id: string }>(
      `insert into posts (author_id, text, reply_parent_id, root_id, removed_at)
       values ($1, 'Moderated bridge content must not appear', $2, $3, now()) returning id`,
      [author, bridge, root],
    )
    const nextBridge = nextBridges[0]!.id
    const survivorText = `Surviving reply from ${handle}`
    const { rows: survivors } = await client.query<{ id: string }>(
      `insert into posts (author_id, text, reply_parent_id, root_id)
       values ($1, $2, $3, $4) returning id`,
      [author, survivorText, nextBridge, root],
    )
    await client.query('commit')
    return { root, first, replies: replies.map((r) => r.id), nested: nested.map((r) => r.id), bridgeParent, bridge, nextBridge, survivor: survivors[0]!.id, survivorText }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await db.end()
  }
}

/**
 * Makes a member's sign-in look `minutes` old, so Kratos asks them to verify it is
 * them again before a change in Settings (privileged_session_max_age is 15m).
 */
export async function ageSignIn(handle: string, minutes: number) {
  assertLocal()
  // Kratos keeps its tables in its own database on the same server.
  const kratos = new pg.Client({ connectionString: env.databaseUrl!.replace(/\/[^/?]+(\?|$)/, '/kratos$1') })
  await kratos.connect()
  try {
    const { rowCount } = await kratos.query(
      `update sessions set authenticated_at = now() - make_interval(mins => $2)
       where identity_id = (select id from identities where traits->>'handle' = $1) and active`,
      [handle, minutes],
    )
    if (!rowCount) throw new Error(`no active Kratos session for @${handle}`)
  } finally {
    await kratos.end()
  }
}

/**
 * Gives an address a ready preview card without the page being fetched: the API
 * (rightly) refuses to read pages from this machine, and tests cannot reach the
 * internet. Use an address under https://links.e2e.test/, which cleaning removes.
 */
export async function seedLinkPreview(url: string, { title, description }: { title: string; description: string }) {
  if (!url.startsWith('https://links.e2e.test/')) throw new Error('seed previews only for https://links.e2e.test/')
  const db = pool()
  try {
    await db.query(
      `insert into link_previews (url, status, title, description, site_name, fetched_at) values ($1, 'ready', $2, $3, 'E2E News', now())
       on conflict (url) do update set status = 'ready', title = $2, description = $3, fetched_at = now()`,
      [url, title, description],
    )
  } finally {
    await db.end()
  }
}

/**
 * Makes what has happened to `handle` so far look `minutes` old, so the email job
 * treats it as ready to send instead of waiting out its real delay (five minutes).
 */
export async function ageNotifications(handle: string, minutes = 10) {
  const db = pool()
  try {
    const { rowCount } = await db.query(
      `update notifications set created_at = created_at - make_interval(mins => $2)
       where recipient_id = (select id from members where handle = $1)`,
      [handle, minutes],
    )
    if (!rowCount) throw new Error(`no notifications for @${handle} to age`)
  } finally {
    await db.end()
  }
}

/** Waits until the email job has dealt with every notification `handle` has: sent, or passed over. */
export async function waitForEmailJob(handle: string, timeoutMs = 90_000) {
  const db = pool()
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const { rows } = await db.query<{ waiting: number; total: number }>(
        `select count(*) filter (where n.email_settled_at is null)::int as waiting, count(*)::int as total
         from notifications n join members m on m.id = n.recipient_id where m.handle = $1`,
        [handle],
      )
      if (rows[0]!.total > 0 && rows[0]!.waiting === 0) return
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`the email job did not deal with @${handle}'s notifications within ${timeoutMs / 1000}s`)
  } finally {
    await db.end()
  }
}

/** Waits until the push job has dealt with every notification `handle` has: pushed, or passed over. */
export async function waitForPushJob(handle: string, timeoutMs = 60_000) {
  const db = pool()
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const { rows } = await db.query<{ waiting: number; total: number }>(
        `select count(*) filter (where n.push_settled_at is null)::int as waiting, count(*)::int as total
         from notifications n join members m on m.id = n.recipient_id where m.handle = $1`,
        [handle],
      )
      if (rows[0]!.total > 0 && rows[0]!.waiting === 0) return
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`the push job did not deal with @${handle}'s notifications within ${timeoutMs / 1000}s`)
  } finally {
    await db.end()
  }
}

/** How many browsers `handle`'s notifications are pushed to. */
export async function pushSubscriptionCount(handle: string): Promise<number> {
  const db = pool()
  try {
    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from push_subscriptions s join members m on m.id = s.member_id where m.handle = $1`,
      [handle],
    )
    return rows[0]!.count
  } finally {
    await db.end()
  }
}
