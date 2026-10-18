// Local development only: fills the app with a small, connected demo community
// (members with photos, conversations several levels deep, posts with images,
// likes, follows and notifications), so threads and feeds can be tried by hand.
//
//   pnpm demo:seed    replaces any earlier demo data with a fresh copy
//   pnpm demo:clean   removes it again, with everything anyone did to it
//
// Demo members are real Kratos identities (email <handle>@demo.heynaija.test), so
// you can sign in as one with an emailed code from Mailpit. Their IDs are kept in
// a demo_members table, which is how the clean-up finds them again.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { createDb } from '@heynaija/db'
import sharp from 'sharp'
import { loadEnv } from '../env.js'
import { AVATAR_SIZES, POST_IMAGE_SIZES } from '../media/media.service.js'
import { S3ObjectStore } from '../media/object-store.js'
import { s3Config } from '../media/s3-config.js'
import type { Art } from './demo/art.js'
import { ANSWERS, type DemoImage, type DemoReply, FOLLOWED_REAL_MEMBERS, MEMBERS, THREADS } from './demo/content.js'

const { values: args } = parseArgs({ options: { clean: { type: 'boolean', default: false } } })

const EMAIL_DOMAIN = 'demo.heynaija.test'
const KRATOS_ADMIN_URL = (process.env.KRATOS_ADMIN_URL ?? 'http://127.0.0.1:4534').replace(/\/$/, '')
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/

const env = loadEnv()
for (const [what, value] of [['database', env.DATABASE_URL], ['object storage', env.S3_ENDPOINT], ['Kratos admin', KRATOS_ADMIN_URL]] as const) {
  const url = new URL(value)
  if (!LOOPBACK.test(url.hostname) || /prod|staging|live/i.test(url.pathname)) {
    console.error(`Refusing to run: the ${what} at ${url.host}${url.pathname} is not a local development service.`)
    process.exit(1)
  }
}

const { pool } = createDb(env.DATABASE_URL, { max: 4 })
const store = new S3ObjectStore(s3Config(env))
const MINUTE = 60_000
const now = Date.now()

// ---------------------------------------------------------------- clean-up

async function kratosId(handle: string): Promise<string | null> {
  const res = await fetch(`${KRATOS_ADMIN_URL}/admin/identities?credentials_identifier=${encodeURIComponent(`${handle}@${EMAIL_DOMAIN}`)}`)
  if (!res.ok) throw new Error(`Kratos lookup for ${handle}: ${res.status}`)
  const found = (await res.json()) as { id: string; traits?: { email?: string } }[]
  return found.find((i) => i.traits?.email === `${handle}@${EMAIL_DOMAIN}`)?.id ?? null
}

async function clean() {
  await pool.query('create table if not exists demo_members (id uuid primary key)')
  const kratos = (await Promise.all(MEMBERS.map((m) => kratosId(m.handle)))).filter((id): id is string => id !== null)
  const { rows } = await pool.query<{ id: string }>('select id from demo_members')
  const ids = [...new Set([...rows.map((r) => r.id), ...kratos])]
  if (ids.length === 0) return 0

  const client = await pool.connect()
  let media: { id: string; kind: 'avatar' | 'post_image' }[] = []
  try {
    await client.query('begin')
    await client.query('create temp table d_m on commit drop as select unnest($1::uuid[]) as id', [ids])
    // Their posts and every reply below them, whoever wrote it: a reply whose
    // conversation is gone would point at nothing.
    await client.query(`
      create temp table d_p on commit drop as
      with recursive tree as (
        select id from posts where author_id in (select id from d_m)
        union select p.id from posts p join tree on p.reply_parent_id = tree.id
      ) select id from tree`)
    media = (await client.query<{ id: string; kind: 'avatar' | 'post_image' }>(
      'select id, kind from media where owner_id in (select id from d_m) or post_id in (select id from d_p)',
    )).rows
    const steps: [string, string][] = [
      ['notifications', `delete from notifications where recipient_id in (select id from d_m) or actor_id in (select id from d_m)
        or subject_id in (select id from d_m) or post_id in (select id from d_p)`],
      ['moderation actions', `delete from moderation_actions where actor_id in (select id from d_m) or member_id in (select id from d_m)
        or post_id in (select id from d_p)`],
      ['reports', `delete from reports where reporter_id in (select id from d_m) or member_id in (select id from d_m)
        or post_id in (select id from d_p) or resolved_by in (select id from d_m)`],
      ['notification settings', 'delete from notification_opt_outs where member_id in (select id from d_m)'],
      ['mentions', 'delete from post_mentions where member_id in (select id from d_m) or post_id in (select id from d_p)'],
      ['likes', 'delete from likes where member_id in (select id from d_m) or post_id in (select id from d_p)'],
      ['reposts', 'delete from reposts where member_id in (select id from d_m) or post_id in (select id from d_p)'],
      ['bookmarks', 'delete from bookmarks where member_id in (select id from d_m) or post_id in (select id from d_p)'],
      ['follows', 'delete from follows where follower_id in (select id from d_m) or followee_id in (select id from d_m)'],
      ['blocks', 'delete from blocks where blocker_id in (select id from d_m) or blocked_id in (select id from d_m)'],
      ['mutes', 'delete from mutes where muter_id in (select id from d_m) or muted_id in (select id from d_m)'],
      ['community memberships', 'delete from community_memberships where member_id in (select id from d_m)'],
      ['released handles', 'delete from released_handles where member_id in (select id from d_m)'],
      ['profile badges', 'delete from profile_badges where member_id in (select id from d_m)'],
      ['verifications', `delete from restricted.identity_verifications where member_id in (select id from d_m)
        or reviewed_by in (select id from d_m)`],
      ['voting memberships', 'delete from restricted.governance_memberships where member_id in (select id from d_m)'],
      ['age records', 'delete from restricted.age_assurances where member_id in (select id from d_m)'],
      ['media', 'delete from media where owner_id in (select id from d_m) or post_id in (select id from d_p)'],
      // The counter triggers lower reply counts on the real posts demo members answered.
      ['posts', 'delete from posts where id in (select id from d_p)'],
      ['members', 'delete from members where id in (select id from d_m)'],
      ['bookkeeping', 'delete from demo_members'],
    ]
    for (const [label, sql] of steps) {
      const res = await client.query(sql)
      if (res.rowCount) console.log(`  removed ${label.padEnd(22)} ${res.rowCount}`)
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  for (const m of media) {
    const folder = m.kind === 'avatar' ? 'avatars' : 'posts'
    for (const size of m.kind === 'avatar' ? AVATAR_SIZES : POST_IMAGE_SIZES) await store.remove('media', `${folder}/${m.id}/${size}.webp`)
  }
  for (const id of kratos) {
    const res = await fetch(`${KRATOS_ADMIN_URL}/admin/identities/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`Kratos delete ${id}: ${res.status}`)
  }
  return ids.length
}

// ---------------------------------------------------------------- seeding

/** Deterministic, so a fresh seed always has the same likes and follows. */
let state = 20261015
const rand = () => {
  state = (state * 1103515245 + 12345) % 2147483648
  return state / 2147483648
}
const between = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1))
const sample = <T>(items: T[], count: number) => [...items].sort(() => rand() - 0.5).slice(0, count)
const at = (ms: number) => new Date(Math.min(ms, now - MINUTE))

let brandPhoto: Buffer | null | undefined
async function render(art: Art | 'brand-photo'): Promise<Buffer | null> {
  if (art !== 'brand-photo') return sharp(Buffer.from(art.svg)).png().toBuffer()
  if (brandPhoto === undefined) {
    brandPhoto = await readFile(new URL('../../../web/public/brand/community-conversation.jpg', import.meta.url)).catch(() => null)
  }
  return brandPhoto
}

/** The same versions MediaService.processPostImage publishes, stored the same way. */
async function publishPostImage(ownerId: string, postId: string, position: number, image: DemoImage, createdAt: Date) {
  const original = await render(image.art)
  if (!original) return
  const id = randomUUID()
  let largest = { width: 0, height: 0 }
  for (const px of POST_IMAGE_SIZES) {
    const { data, info } = await sharp(original)
      .resize(px, px, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true })
    await store.write('media', `posts/${id}/${px}.webp`, data, 'image/webp')
    largest = { width: info.width, height: info.height }
  }
  await pool.query(
    `insert into media (id, owner_id, kind, status, content_type, bytes, width, height, post_id, position, alt, created_at, ready_at)
     values ($1, $2, 'post_image', 'ready', $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [id, ownerId, image.art === 'brand-photo' ? 'image/jpeg' : 'image/png', original.length, largest.width, largest.height, postId, position, image.alt, createdAt],
  )
}

async function publishAvatar(ownerId: string, art: Art, createdAt: Date) {
  const original = await render(art)
  const id = randomUUID()
  for (const px of AVATAR_SIZES) {
    const body = await sharp(original!).resize(px, px, { fit: 'cover' }).webp({ quality: 82 }).toBuffer()
    await store.write('media', `avatars/${id}/${px}.webp`, body, 'image/webp')
  }
  await pool.query(
    `insert into media (id, owner_id, kind, status, content_type, bytes, width, height, alt, created_at, ready_at)
     values ($1, $2, 'avatar', 'ready', 'image/png', $3, 512, 512, '', $4, $4)`,
    [id, ownerId, original!.length, createdAt],
  )
  await pool.query('update members set avatar_media_id = $1 where id = $2', [id, ownerId])
}

type Written = { id: string; authorId: string; createdAt: number; parentAuthorId: string | null; depth: number }

async function seed() {
  // 1. Members: a Kratos identity each (its ID is the member ID, as at signup).
  const ids = new Map<string, string>()
  for (const m of MEMBERS) {
    const email = `${m.handle}@${EMAIL_DOMAIN}`
    const res = await fetch(`${KRATOS_ADMIN_URL}/admin/identities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema_id: 'member',
        state: 'active',
        traits: { email, handle: m.handle },
        verifiable_addresses: [{ value: email, via: 'email', verified: true, status: 'completed' }],
      }),
    })
    if (res.status === 409) throw new Error(`the handle @${m.handle} already belongs to someone who is not a demo member`)
    if (!res.ok) throw new Error(`Kratos refused @${m.handle}: ${res.status} ${await res.text()}`)
    const { id } = (await res.json()) as { id: string }
    ids.set(m.handle, id)
    await pool.query('insert into demo_members (id) values ($1)', [id])
    const joined = at(now - m.joinedDaysAgo * 86_400_000)
    await pool.query(
      `insert into members (id, handle, display_name, bio, created_at, last_seen_at) values ($1, $2, $3, $4, $5, $6)`,
      [id, m.handle, m.name, m.bio, joined, at(now - between(5, 600) * MINUTE)],
    )
    if (m.avatar) await publishAvatar(id, m.avatar, joined)
  }
  const demo = [...ids.values()]
  const { rows: realRows } = await pool.query<{ id: string; handle: string }>(
    'select id, handle from members where handle = any($1) and active',
    [FOLLOWED_REAL_MEMBERS],
  )
  const real = new Map(realRows.map((r) => [r.handle, r.id]))
  const { rows: communityRows } = await pool.query<{ id: string; slug: string }>('select id, slug from communities where active')
  const communities = new Map(communityRows.map((c) => [c.slug, c.id]))
  const author = (handle: string) => {
    const id = ids.get(handle)
    if (!id) throw new Error(`content names @${handle}, who is not a demo member`)
    return id
  }

  // 2. Conversations, parents before replies so the reply counters stay right.
  const written: Written[] = []
  const deletions: { id: string; at: Date }[] = []
  async function write(node: DemoReply, parent: Written | null, rootId: string | null, communityId: string | null, createdAt: number) {
    const id = randomUUID()
    const authorId = author(node.by)
    await pool.query(
      `insert into posts (id, author_id, text, reply_parent_id, root_id, community_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, authorId, node.text ?? '', parent?.id ?? null, rootId, communityId, at(createdAt)],
    )
    const self: Written = { id, authorId, createdAt, parentAuthorId: parent?.authorId ?? null, depth: parent ? parent.depth + 1 : 0 }
    written.push(self)
    for (const [position, image] of (node.images ?? []).entries()) await publishPostImage(authorId, id, position, image, at(createdAt))
    let previous = createdAt
    for (const [i, reply] of (node.replies ?? []).entries()) {
      // Each reply comes a little after the one it answers and after its earlier siblings.
      const time = Math.max(createdAt + (reply.after ?? 6 + i * 5) * MINUTE, previous + MINUTE / 2)
      previous = time
      await write(reply, self, rootId ?? id, communityId, time)
    }
    if (node.deleted) deletions.push({ id, at: at(previous + 20 * MINUTE) })
    return self
  }

  for (const thread of THREADS) {
    const communityId = thread.community ? communities.get(thread.community) ?? null : null
    await write(thread, null, null, communityId, now - thread.hoursAgo * 3_600_000)
  }
  let answered = 0
  for (const answer of ANSWERS) {
    const { rows } = await pool.query<{ id: string; author_id: string; root_id: string | null; community_id: string | null; created_at: Date }>(
      `select p.id, p.author_id, p.root_id, p.community_id, p.created_at from posts p join members m on m.id = p.author_id
       where m.handle = $1 and p.text like $2 and p.deleted_at is null and p.removed_at is null order by p.created_at limit 1`,
      [answer.to.handle, `${answer.to.startsWith.replace(/[%_\\]/g, '\\$&')}%`],
    )
    const target = rows[0]
    if (!target) continue
    answered++
    const parent: Written = { id: target.id, authorId: target.author_id, createdAt: target.created_at.getTime(), parentAuthorId: null, depth: 0 }
    const start = Math.max(parent.createdAt + 20 * MINUTE, now - 6 * 3_600_000)
    for (const [i, reply] of answer.replies.entries()) {
      await write(reply, parent, target.root_id ?? target.id, target.community_id, start + i * 25 * MINUTE)
    }
  }
  for (const d of deletions) await pool.query('update posts set deleted_at = $2 where id = $1', [d.id, d.at])

  // 3. Notifications for every reply, as PostsService.create sends them.
  const notify = async (recipientId: string, kind: 'reply' | 'like' | 'follow', actorId: string, postId: string | null, createdAt: Date) => {
    if (recipientId === actorId) return
    // Demo members have "seen" theirs; real members find theirs unread.
    const readAt = demo.includes(recipientId) ? createdAt : null
    await pool.query(
      `insert into notifications (recipient_id, kind, actor_id, post_id, created_at, read_at) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [recipientId, kind, actorId, postId, createdAt, readAt],
    )
  }
  for (const post of written) if (post.parentAuthorId) await notify(post.parentAuthorId, 'reply', post.authorId, post.id, at(post.createdAt))

  // 4. Likes: more on the posts that start conversations.
  let likes = 0
  const liked = [...written, ...(await pool.query<{ id: string; author_id: string; created_at: Date }>(
    'select id, author_id, created_at from posts where author_id = any($1) and reply_parent_id is null and deleted_at is null', [[...real.values()]],
  )).rows.map((r) => ({ id: r.id, authorId: r.author_id, createdAt: Math.max(r.created_at.getTime(), now - 2 * 86_400_000), depth: 0 }))]
  for (const post of liked) {
    const count = post.depth === 0 ? between(2, 11) : between(0, 3)
    for (const memberId of sample(demo.filter((id) => id !== post.authorId), count)) {
      const createdAt = at(post.createdAt + between(2, 240) * MINUTE)
      await pool.query('insert into likes (member_id, post_id, created_at) values ($1, $2, $3) on conflict do nothing', [memberId, post.id, createdAt])
      await notify(post.authorId, 'like', memberId, post.id, createdAt)
      likes++
    }
  }

  // 5. Follows among demo members, of the real members, and back, so the
  //    Following feed and "You follow @…" have something to show.
  let follows = 0
  const follow = async (followerId: string, followeeId: string) => {
    const createdAt = at(now - between(60, 20 * 24 * 60) * MINUTE)
    const res = await pool.query('insert into follows (follower_id, followee_id, created_at) values ($1, $2, $3) on conflict do nothing', [followerId, followeeId, createdAt])
    if (res.rowCount) {
      follows++
      await notify(followeeId, 'follow', followerId, null, createdAt)
    }
  }
  for (const id of demo) for (const other of sample(demo.filter((x) => x !== id), between(4, 8))) await follow(id, other)
  for (const realId of real.values()) {
    for (const id of sample(demo, 6)) await follow(id, realId)
    for (const id of sample(demo, 7)) await follow(realId, id)
  }

  // 6. Communities they post in, plus one or two more.
  for (const [handle, id] of ids) {
    const posted = THREADS.filter((t) => t.by === handle && t.community).map((t) => t.community!)
    const extra = sample([...communities.keys()], between(1, 2))
    for (const slug of new Set([...posted, ...extra])) {
      await pool.query(
        'insert into community_memberships (community_id, member_id, joined_at) values ($1, $2, $3) on conflict do nothing',
        [communities.get(slug), id, at(now - between(2, 10) * 86_400_000)],
      )
    }
  }

  const replies = written.filter((p) => p.depth > 0).length
  console.log(`  ${MEMBERS.length} members, ${written.length - replies} posts, ${replies} replies (${answered} conversations joined), ${likes} likes, ${follows} follows`)
}

try {
  const removed = await clean()
  if (removed) console.log(`removed the earlier demo data (${removed} members)`)
  if (!args.clean) {
    console.log('seeding the demo community…')
    await seed()
    console.log(`done. Sign in as any of them with <handle>@${EMAIL_DOMAIN}; the code arrives in Mailpit.`)
  } else if (!removed) {
    console.log('no demo data here')
  }
} finally {
  await pool.end()
}
