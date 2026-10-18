/** A web address written in a post: where it sits in the text, and where it leads. */
export type FoundLink = {
  /** Offset into the text in UTF-16 code units, as for mentions. */
  start: number
  length: number
  /** Always http or https, with a host that looks like a site, and no #fragment dropped. */
  url: string
}

export const LINK_MAX_LENGTH = 2048

// http(s):// or www. standing alone: not inside a word, an email address or the
// middle of another address. Runs to the next space or angle bracket; the
// punctuation that belongs to the sentence is trimmed off afterwards.
const CANDIDATE = /(?<![\p{L}\p{M}\p{N}_@/.:=-])(?:https?:\/\/|www\.)[^\s<>"]+/giu

// What can end a sentence or close a quote without being part of the address.
const TRAILING = /[.,;:!?'"*_~)\]}…]/u
const count = (text: string, char: string) => text.split(char).length - 1

/** Drops trailing punctuation, keeping a closing bracket that matches one inside ("…/Nigeria_(country)"). */
function trimTrailing(raw: string): string {
  let text = raw
  for (;;) {
    const last = text.at(-1)
    if (!last || !TRAILING.test(last)) return text
    if (last === ')' && count(text, '(') >= count(text, ')')) return text
    text = text.slice(0, -1)
  }
}

// The last label of a real host name: letters (country and generic domains) or a
// punycode label for a non-Latin one. Rules out "192.168.0.1", "file.1" and "v1.2.3".
const TOP_LEVEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i

/** The address `raw` stands for, or null if it is not one we would link. */
function parse(raw: string): string | null {
  let url: URL
  try {
    url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  // "https://bank.com@evil.example" reads as one site and leads to another.
  if (url.username || url.password) return null
  const labels = url.hostname.split('.')
  if (labels.length < 2 || !TOP_LEVEL.test(labels.at(-1)!)) return null
  return url.href.length <= LINK_MAX_LENGTH ? url.href : null
}

/** Every web address in `text`, in order, with where it is. */
export function findLinks(text: string): FoundLink[] {
  const found: FoundLink[] = []
  for (const match of text.matchAll(CANDIDATE)) {
    const raw = trimTrailing(match[0])
    const url = parse(raw)
    if (url) found.push({ start: match.index, length: raw.length, url })
  }
  return found
}

/**
 * The address a post's preview card is for: the first one in the text, without
 * its #fragment (the page is the same, and one preview is shared by all of them).
 */
export function previewUrlOf(text: string): string | null {
  const first = findLinks(text)[0]
  if (!first) return null
  const url = new URL(first.url)
  url.hash = ''
  return url.href
}
