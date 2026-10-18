import { cleanLine } from '../text.js'

export type PageMeta = {
  title: string | null
  description: string | null
  siteName: string | null
  /** An absolute http(s) address, not yet fetched. */
  image: string | null
}

export const TITLE_MAX = 160
export const DESCRIPTION_MAX = 300

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Turns &amp; &#39; &#x1F600; and the few other entities pages use back into text. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi, (whole, dec, hex, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole
    const code = dec ? Number(dec) : Number.parseInt(hex, 16)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
  })
}

/** A short single line, cut at a word where it can be. Null when nothing is left. */
function tidy(text: string | undefined, max: number): string | null {
  const line = cleanLine(decodeEntities(text ?? ''))
  if (!line) return null
  if (line.length <= max) return line
  const cut = line.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** `<meta …>` attributes by lower-case name. */
function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const m of tag.matchAll(ATTRIBUTE)) {
    const name = m[1]!.toLowerCase()
    if (!found.has(name)) found.set(name, m[2] ?? m[3] ?? m[4] ?? '')
  }
  return found
}

/** The part of a page before its body, without scripts, styles and comments, where tags can hide. */
function head(html: string): string {
  const body = html.search(/<body[\s>]/i)
  const end = html.search(/<\/head\s*>/i)
  const limit = [body, end].filter((i) => i >= 0)
  return (limit.length ? html.slice(0, Math.min(...limit)) : html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
}

const host = (url: URL) => url.hostname.replace(/^www\./, '')

/**
 * What a page says about itself, from its Open Graph and Twitter tags and, failing
 * those, its <title> and description. `page` is where it was fetched from, to
 * resolve a relative image address and to name the site when the page does not.
 * Everything is text from a stranger: it is trimmed to a line and shown as text only.
 */
export function readPageMeta(html: string, page: URL): PageMeta {
  const top = head(html)
  const meta = new Map<string, string>()
  for (const m of top.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = attributes(m[1]!)
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase()
    const content = attrs.get('content')
    if (key && content && !meta.has(key)) meta.set(key, content)
  }
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v?.trim())

  const documentTitle = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(top)?.[1]
  let image: string | null = null
  const rawImage = pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')?.trim()
  if (rawImage) {
    try {
      const url = new URL(decodeEntities(rawImage), page)
      if (url.protocol === 'https:' || url.protocol === 'http:') image = url.href
    } catch {
      // Not an address; the card goes without a picture.
    }
  }

  return {
    title: tidy(pick('og:title', 'twitter:title') ?? documentTitle, TITLE_MAX),
    description: tidy(pick('og:description', 'twitter:description', 'description'), DESCRIPTION_MAX),
    siteName: tidy(pick('og:site_name', 'application-name'), 60) ?? host(page),
    image,
  }
}

/** The character set a page declares in its first bytes, for decoding it. */
export function declaredCharset(contentType: string | undefined, bytes: Buffer): string {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? '')?.[1]
  const fromTag = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString('latin1'))?.[1]
  return (fromHeader ?? fromTag ?? 'utf-8').toLowerCase()
}

/** Decodes a page's bytes in the character set it declares, falling back to UTF-8. */
export function decodePage(bytes: Buffer, contentType?: string): string {
  try {
    return new TextDecoder(declaredCharset(contentType, bytes)).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}
