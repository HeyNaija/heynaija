import type { PostMention } from './api'

/** A run of post text; `handle` marks an @mention and the profile it leads to now. */
export type TextPart = { text: string; handle?: string }

/**
 * Splits post text around its mentions, in order. A mention that does not fit
 * the text (overlapping another, out of range, not on an @) is left as text.
 */
export function textParts(text: string, mentions: PostMention[] = []): TextPart[] {
  const parts: TextPart[] = []
  let at = 0
  for (const { start, length, handle } of mentions) {
    if (start < at || length < 2 || start + length > text.length || text[start] !== '@') continue
    if (start > at) parts.push({ text: text.slice(at, start) })
    parts.push({ text: text.slice(start, start + length), handle })
    at = start + length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}
