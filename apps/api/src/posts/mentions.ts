import { type Db, postMentions } from '@heynaija/db'
import { type SQL, sql } from 'drizzle-orm'
import { strangerToMinor } from '../governance/minors.js'
import { findLinks } from '../links/link-text.js'
import { membersForHandles } from '../members/members.service.js'

/** How many of the members a post mentions are notified; the rest are only linked. */
export const MENTIONS_NOTIFIED_MAX = 10

// @ and a handle as Kratos allows them (infra/kratos/identity.schema.json),
// standing alone: not inside a word, an email address or a URL path
// ("ada@example.com", "medium.com/@ada"), and not running on into more letters.
// Capitals are accepted and read as lower case, since handles have none.
const MENTION = /(?<![\p{L}\p{M}\p{N}_@/])@([A-Za-z0-9_]{3,20})(?![\p{L}\p{M}\p{N}_@])/gu

export type FoundMention = { handle: string; start: number; length: number }

/** Every @handle in `text`, in order, with where it is (in UTF-16 code units). */
export const findMentions = (text: string): FoundMention[] =>
  [...text.matchAll(MENTION)].map((m) => ({ handle: m[1]!.toLowerCase(), start: m.index, length: m[0].length }))

/**
 * Records the members a new post mentions, inside the transaction that makes the
 * post, and returns the ones who may be told about it: in order of first
 * mention, without the author or anyone either side has blocked. A handle that
 * leads nobody stays plain text, and so does a minor's, unless they follow the
 * author (ADR 0020).
 */
export async function recordMentions(
  tx: Pick<Db, 'execute' | 'insert'>,
  post: { id: string; authorId: string; text: string },
): Promise<string[]> {
  // A handle inside a web address ("…/profile?u=@ada") is part of the address.
  const links = findLinks(post.text)
  const found = findMentions(post.text).filter((m) => !links.some((l) => m.start >= l.start && m.start < l.start + l.length))
  if (!found.length) return []
  const holders = await membersForHandles(tx, [...new Set(found.map((m) => m.handle))])
  if (!holders.size) return []
  const { rows: guarded } = await tx.execute<{ id: string }>(sql`
    select m.id from unnest(${sql.param([...new Set(holders.values())])}::uuid[]) as m(id)
    where ${strangerToMinor(post.authorId, sql`m.id`)}`)
  const strangers = new Set(guarded.map((r) => r.id))
  const rows = found.flatMap(({ handle, start, length }) => {
    const memberId = holders.get(handle)
    return memberId && !strangers.has(memberId) ? [{ postId: post.id, memberId, start, length }] : []
  })
  if (!rows.length) return []
  await tx.insert(postMentions).values(rows)

  const named = [...new Set(rows.map((r) => r.memberId))].filter((id) => id !== post.authorId)
  if (!named.length) return []
  const { rows: blocked } = await tx.execute<{ id: string }>(sql`
    select m.id from unnest(${sql.param(named)}::uuid[]) as m(id)
    where exists(select 1 from blocks b
      where (b.blocker_id = m.id and b.blocked_id = ${post.authorId}) or (b.blocker_id = ${post.authorId} and b.blocked_id = m.id))`)
  const out = new Set(blocked.map((r) => r.id))
  return named.filter((id) => !out.has(id))
}

/** A mention as a reader sees it: where it is in the text, and the handle it leads to now. */
export type PostMention = { start: number; length: number; handle: string }

/**
 * A post's mentions as JSON, for any query with the post in scope. Left out:
 * members who are inactive or have blocked `viewerId`, whose profile the viewer
 * could not open, so their @handle reads as plain text; and a minor named by
 * someone they do not follow, such as a mention from before they were known to
 * be under 18 (ADR 0020).
 */
export const mentionsOf = (viewerId: string | null, postId: SQL) =>
  sql<PostMention[]>`coalesce((select json_agg(json_build_object('start', pm.start, 'length', pm.length, 'handle', mm.handle) order by pm.start)
  from post_mentions pm join members mm on mm.id = pm.member_id join posts mpost on mpost.id = pm.post_id
  where pm.post_id = ${postId} and mm.active
    and not ${strangerToMinor(sql`mpost.author_id`, sql`mm.id`)}
    ${viewerId ? sql`and not exists(select 1 from blocks mb where mb.blocker_id = mm.id and mb.blocked_id = ${viewerId})` : sql``}), '[]'::json)`
