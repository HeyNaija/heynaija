import type { MentionSuggestion } from './api'

// An @ standing alone, as the API reads mentions (apps/api/src/posts/mentions.ts).
const TYPING = /(?<![\p{L}\p{M}\p{N}_@/])@([A-Za-z0-9_]{1,20})$/u

/** An @mention being typed: where its @ is, and the handle so far in lower case. */
export type Typing = { start: number; query: string }

/** The @mention just before the caret, or null; a bare @ is not one yet. */
export function mentionBeforeCaret(text: string, caret: number): Typing | null {
  const match = TYPING.exec(text.slice(0, caret))
  return match ? { start: match.index, query: match[1]!.toLowerCase() } : null
}

/** The text with the typed mention (and the rest of its word) replaced by `@handle `, and the new caret. */
export function insertMention(text: string, typing: Typing, caret: number, handle: string): { text: string; caret: number } {
  const rest = text.slice(caret).replace(/^[A-Za-z0-9_]*/, '')
  const mention = `@${handle}`
  const spaced = rest.startsWith(' ') ? rest : ` ${rest}`
  return { text: text.slice(0, typing.start) + mention + spaced, caret: typing.start + mention.length + 1 }
}

/** Whether `member` still fits `query`, by the API's rules. */
export function matches(member: MentionSuggestion, query: string): boolean {
  const name = member.displayName?.toLowerCase() ?? ''
  return member.handle.startsWith(query) || name.startsWith(query) || (member.following && ` ${name}`.includes(` ${query}`))
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Where `member` sits in the API's order for `query`: followed, others by handle, others by name. */
function sortKey(member: MentionSuggestion, query: string): [number, string, string] {
  const { handle } = member
  if (member.following) return [0, handle === query ? '0' : handle.startsWith(query) ? '1' : '2', handle]
  if (handle.startsWith(query)) return [1, handle, '']
  return [2, member.displayName?.toLowerCase() ?? '', handle]
}

/** A complete answer (no more pages) filtered and ordered for a longer `query`, as the API would. */
export function narrow(known: MentionSuggestion[], query: string): MentionSuggestion[] {
  return known
    .filter((m) => matches(m, query))
    .map((m) => ({ m, key: sortKey(m, query) }))
    .sort((a, b) => a.key[0] - b.key[0] || byCode(a.key[1], b.key[1]) || byCode(a.key[2], b.key[2]))
    .map(({ m }) => m)
}
