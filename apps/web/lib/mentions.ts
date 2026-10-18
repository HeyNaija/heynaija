import type { PostLink, PostMention } from './api'

/**
 * A run of post text. `handle` marks an @mention and the profile it leads to now;
 * `href` marks a web address and where it leads. `label` is what to show for an
 * address: the text without its scheme, `www.` and trailing slash, cut if long.
 */
export type TextPart = { text: string; handle?: string; href?: string; label?: string }

const LABEL_MAX = 32

/** An address as people write it on a poster: "example.com/story", not "https://www.example.com/story/". */
export function linkLabel(written: string): string {
  const short = written.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
  const chars = [...short]
  return chars.length > LABEL_MAX ? `${chars.slice(0, LABEL_MAX - 1).join('')}…` : short
}

// What an address in the text begins with, and what it leads to: only the web.
const WEB_ADDRESS = /^(?:https?:\/\/|www\.)/i

type Span = { start: number; length: number } & ({ handle: string } | { href: string })

/**
 * Splits post text around its mentions and web addresses, in order. One that does
 * not fit the text (overlapping another, out of range, a mention not on an @) is
 * left as text. An address wins over an @handle inside it.
 */
export function textParts(text: string, mentions: PostMention[] = [], links: PostLink[] = []): TextPart[] {
  const spans: Span[] = [
    ...links.map(({ start, length, url }) => ({ start, length, href: url })),
    ...mentions.map(({ start, length, handle }) => ({ start, length, handle })),
  ].sort((a, b) => a.start - b.start || b.length - a.length)

  const parts: TextPart[] = []
  let at = 0
  for (const span of spans) {
    const { start, length } = span
    if (start < at || length < 1 || start + length > text.length) continue
    const written = text.slice(start, start + length)
    if ('handle' in span ? length < 2 || text[start] !== '@' : !WEB_ADDRESS.test(written) || !WEB_ADDRESS.test(span.href)) continue
    if (start > at) parts.push({ text: text.slice(at, start) })
    parts.push('handle' in span ? { text: written, handle: span.handle } : { text: written, href: span.href, label: linkLabel(written) })
    at = start + length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}
