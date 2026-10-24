import { type Db, postHashtags } from '@heynaija/db'
import { type SQL, sql } from 'drizzle-orm'
import { findLinks } from '../links/link-text.js'

/** The longest hashtag, in characters after the #. A longer run is not a hashtag at all. */
export const HASHTAG_MAX = 50

// Letters, marks, digits and the underscore. Marks are in so that a tone mark
// typed as a character of its own stays in the word (#Ọ̀ṣun).
const WORD = String.raw`[\p{L}\p{M}\p{N}_]`

// # and a word standing alone: not inside a word ("C#", "no#1"), an address
// ("…/page#top"), an HTML entity ("&#39;") or a doubled ## ("##ad"), and not
// running on past the limit. It has a letter in it: "#1" and "#2027" are numbers.
const HASHTAG = new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}_&#/])#(?=[\p{M}\p{N}_]*\p{L})(${WORD}{1,${HASHTAG_MAX}})(?!${WORD})`, 'gu')

// A hashtag as written, without its #: what a topic page's address carries.
const WRITTEN = new RegExp(String.raw`^(?=[\p{M}\p{N}_]*\p{L})${WORD}{1,${HASHTAG_MAX}}$`, 'u')

/** The key every spelling of a hashtag shares: #EndSARS and #endsars are one topic. */
export const hashtagKey = (written: string) => written.normalize('NFC').toLowerCase()

/** The topic a hashtag written as `written` (without its #) is, or null if it is not one. */
export const parseHashtag = (written: string): string | null => (WRITTEN.test(written) ? hashtagKey(written) : null)

export type FoundHashtag = { tag: string; start: number; length: number }

/**
 * Every #hashtag in `text`, in order, with where it is (in UTF-16 code units).
 * One inside a web address ("…/story#comments") is part of the address.
 */
export function findHashtags(text: string): FoundHashtag[] {
  const links = findLinks(text)
  return [...text.matchAll(HASHTAG)]
    .filter((m) => !links.some((l) => m.index >= l.start && m.index < l.start + l.length))
    .map((m) => ({ tag: hashtagKey(m[1]!), start: m.index, length: m[0].length }))
}

/** Records the hashtags in a new post, inside the transaction that makes it. */
export async function recordHashtags(tx: Pick<Db, 'insert'>, post: { id: string; text: string }): Promise<void> {
  const found = findHashtags(post.text)
  if (found.length) await tx.insert(postHashtags).values(found.map((h) => ({ postId: post.id, ...h })))
}

/** A hashtag as a reader sees it: where it is in the text, and the topic it opens. */
export type PostHashtag = { start: number; length: number; tag: string }

/** A post's hashtags as JSON, for any query with the post in scope. */
export const hashtagsOf = (postId: SQL) =>
  sql<PostHashtag[]>`coalesce((select json_agg(json_build_object('start', ph.start, 'length', ph.length, 'tag', ph.tag) order by ph.start)
  from post_hashtags ph where ph.post_id = ${postId}), '[]'::json)`
