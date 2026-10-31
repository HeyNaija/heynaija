import type { MentionSuggestion } from './api'

// An @ standing alone, as the API reads mentions (apps/api/src/posts/mentions.ts).
const TYPING = /(?<![\p{L}\p{M}\p{N}_@/])@([A-Za-z0-9_]{1,20})$/u

// A web address runs from http(s):// or www. to the next space (apps/api/src/links/link-text.ts),
// and an @handle inside one is part of the address, not a mention.
const IN_LINK = /(?<![\p{L}\p{M}\p{N}_@/.:=-])(?:https?:\/\/|www\.)[^\s<>"]*$/iu

/** An @mention being typed: where its @ is, and the handle so far in lower case. */
export type Typing = { start: number; query: string }

/** The @mention just before the caret, or null; a bare @ is not one yet. */
export function mentionBeforeCaret(text: string, caret: number): Typing | null {
  const match = TYPING.exec(text.slice(0, caret))
  if (!match || IN_LINK.test(text.slice(0, match.index))) return null
  return { start: match.index, query: match[1]!.toLowerCase() }
}

/** The text with the typed mention (and the rest of its word) replaced by `@handle`, and the new caret, after any space. */
export function insertMention(text: string, typing: Typing, caret: number, handle: string): { text: string; caret: number } {
  const rest = text.slice(caret).replace(/^[A-Za-z0-9_]*/, '')
  // A space keeps the handle from running into what follows; a space, punctuation or a line break already does.
  const mention = /^$|^[\p{L}\p{M}\p{N}_@]/u.test(rest) ? `@${handle} ` : `@${handle}`
  const after = typing.start + mention.length + (rest.startsWith(' ') ? 1 : 0)
  return { text: text.slice(0, typing.start) + mention + rest, caret: after }
}

/** Whether `member` still fits `query`, by the API's rules. */
function matches(member: MentionSuggestion, query: string): boolean {
  const name = member.displayName?.toLowerCase() ?? ''
  return member.handle.startsWith(query) || name.startsWith(query) || (member.following && ` ${name}`.includes(` ${query}`))
}

/**
 * An earlier answer cut down to `query` while its own answer loads:
 * the members that still fit, the exact handle first as the API puts it.
 */
export function trimTo(list: MentionSuggestion[], query: string): MentionSuggestion[] {
  const fitting = list.filter((m) => matches(m, query))
  const exact = fitting.findIndex((m) => m.handle === query)
  return exact > 0 ? [fitting[exact]!, ...fitting.slice(0, exact), ...fitting.slice(exact + 1)] : fitting
}
