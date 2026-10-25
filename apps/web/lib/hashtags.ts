/** The topic page for a hashtag, written without its #. */
export const hashtagHref = (tag: string) => `/hashtag/${encodeURIComponent(tag)}`

/** The key every spelling of a hashtag shares, as the API keeps it: #EndSARS and #endsars are one topic. */
export const hashtagKey = (tag: string) => tag.normalize('NFC').toLowerCase()

// A hashtag as the API reads one (apps/api/src/posts/hashtags.ts), without its #:
// letters, marks, digits and underscores, at most 50, at least one of them a letter.
const HASHTAG = /^(?=[\p{M}\p{N}_]*\p{L})[\p{L}\p{M}\p{N}_]{1,50}$/u

/** Whether `tag`, written without its #, is a hashtag at all. */
export const isHashtag = (tag: string) => HASHTAG.test(tag)

/** The hashtag, without its #, when `query` is one hashtag and nothing else ("#EndSARS"). */
export function hashtagIn(query: string): string | null {
  const q = query.trim()
  return q.startsWith('#') && isHashtag(q.slice(1)) ? q.slice(1) : null
}

/**
 * A topic page's tag as the visitor's address has it. Next.js may leave the
 * segment percent-encoded; a % cannot be part of a hashtag, so decoding is safe.
 */
export function tagParam(raw: string): string {
  if (!raw.includes('%')) return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
