import { Logger } from '@nestjs/common'
import { decodeEntities } from '../links/page-meta.js'
import { Refreshing } from '../refreshing.js'
import { cleanLines } from '../text.js'

/**
 * What Keke answers from (docs/adr/0030): HeyNaija's own public pages, read from
 * the site as a signed-out visitor sees them. The page is the source of truth,
 * so there is no second copy to drift. /about/keke lists the same pages.
 */
export const KNOWLEDGE_PAGES = [
  '/about',
  '/about/discover',
  '/about/highlights',
  '/about/keke',
  '/rules',
  '/privacy',
  '/terms',
  '/charter',
  '/child-safety',
  '/governance',
  '/progress',
] as const

export type KnowledgePath = (typeof KNOWLEDGE_PAGES)[number]

export type KnowledgePage = { path: KnowledgePath; title: string; text: string }

/** A page whose text cannot be taken with confidence. It is left out, never guessed at. */
export class UnreadablePageError extends Error {}

/** Least text a page must have to count as read: anything shorter is an error page or a skeleton. */
const MIN_TEXT = 200
/** How deep streamed parts may sit inside each other before the page is given up on. */
const MAX_NESTING = 12

/**
 * The text of a page's `<main>`, and nothing else on it. The side rail (which
 * holds members' own posts, such as trending conversations) and the navigation
 * are outside `<main>` and never read.
 *
 * Next.js streams a page: what sits inside a Suspense boundary arrives after
 * `</main>` in a hidden `<div hidden id="S:n">`, and a script call
 * `$RC("B:n","S:n")` moves it into the `<template id="B:n">` placeholder left in
 * `<main>` (or `$RS("S:n","P:n")` into a `<template id="P:n">`). This does what
 * those scripts do, but only for the placeholders inside `<main>`, following the
 * pairs the page itself names. Anything it cannot place (a placeholder with no
 * pair, a part that failed on the server and is left to the browser) makes the
 * whole page unreadable.
 */
export function mainText(html: string): { title: string; text: string } {
  const open = [...html.matchAll(/<main\b[^>]*>/gi)]
  const close = [...html.matchAll(/<\/main\s*>/gi)]
  if (open.length !== 1 || close.length !== 1) throw new UnreadablePageError(`expected one <main>, found ${open.length}`)
  const start = open[0]!.index + open[0]![0].length
  const end = close[0]!.index
  if (end < start) throw new UnreadablePageError('</main> before <main>')

  const parts = segments(html)
  const boundaries = new Map<string, string>()
  const placeholders = new Map<string, string>()
  for (const m of html.matchAll(/\$R([CRSX])\("([^"]+)","([^"]+)"/g)) {
    const [, kind, a, b] = m as unknown as [string, string, string, string]
    if (kind === 'C' || kind === 'R') boundaries.set(a, b)
    else if (kind === 'S') placeholders.set(b, a)
    // $RX marks a boundary that failed on the server: the browser renders it. Not recorded, so its placeholder is unreadable.
  }

  const resolved = resolve(html.slice(start, end), { parts, boundaries, placeholders }, 0)
  if (/<!--\$!-->/.test(resolved)) throw new UnreadablePageError('a part of the page failed on the server')
  if (/<template\b[^>]*\bid="[BP]:/i.test(resolved)) throw new UnreadablePageError('a streamed part was left unplaced')

  const text = toText(resolved)
  if (text.length < MIN_TEXT) throw new UnreadablePageError(`only ${text.length} characters of text`)
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(resolved)
  const title = heading ? toText(heading[1]!).replace(/\s+/g, ' ') : text.split('\n')[0]!
  return { title, text }
}

type Streamed = { parts: Map<string, string>; boundaries: Map<string, string>; placeholders: Map<string, string> }

/** The streamed parts of a page: each `<div hidden id="S:n">`'s inner HTML. */
function segments(html: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const m of html.matchAll(/<div hidden(?:="")? id="(S:[0-9a-z]+)">/g)) {
    const from = m.index + m[0].length
    const to = matchingClose(html, from, 'div')
    if (to !== null) found.set(m[1]!, html.slice(from, to))
  }
  return found
}

/** Where the element opened just before `from` closes: the index of its `</tag>`, counting nested ones. */
function matchingClose(html: string, from: number, tag: string): number | null {
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  tags.lastIndex = from
  let depth = 1
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[1] ? -1 : 1
    if (depth === 0) return m.index
  }
  return null
}

/** Where a Suspense boundary that starts at `from` (just after its opening comment) ends: just after its `<!--/$-->`. */
function boundaryEnd(html: string, from: number): number | null {
  const marks = /<!--(\$\??|\$!|\/\$)-->/g
  marks.lastIndex = from
  let depth = 1
  for (let m = marks.exec(html); m; m = marks.exec(html)) {
    depth += m[1] === '/$' ? -1 : 1
    if (depth === 0) return m.index + m[0].length
  }
  return null
}

/** `fragment` with every pending boundary and placeholder in it replaced by its streamed part, recursively. */
function resolve(fragment: string, streamed: Streamed, depth: number): string {
  if (depth > MAX_NESTING) throw new UnreadablePageError('streamed parts nest too deep')
  let out = ''
  let at = 0
  const pending = /<!--\$\?--><template id="(B:[0-9a-z]+)"><\/template>|<template id="(P:[0-9a-z]+)"><\/template>/g
  for (let m = pending.exec(fragment); m; m = pending.exec(fragment)) {
    out += fragment.slice(at, m.index)
    if (m[1]) {
      // A boundary still showing its fallback: the fallback runs to the boundary's end, and the part replaces all of it.
      const part = streamed.parts.get(streamed.boundaries.get(m[1]) ?? '')
      if (part === undefined) throw new UnreadablePageError(`no streamed part for ${m[1]}`)
      const end = boundaryEnd(fragment, m.index + '<!--$?-->'.length)
      if (end === null) throw new UnreadablePageError(`boundary ${m[1]} never ends`)
      out += `<!--$-->${resolve(part, streamed, depth + 1)}<!--/$-->`
      at = end
    } else {
      const part = streamed.parts.get(streamed.placeholders.get(m[2]!) ?? '')
      if (part === undefined) throw new UnreadablePageError(`no streamed part for ${m[2]}`)
      out += resolve(part, streamed, depth + 1)
      at = m.index + m[0].length
    }
    pending.lastIndex = at
  }
  return out + fragment.slice(at)
}

/** Cloudflare hides email addresses on pages it serves; this is its published way of reading them back. */
function cloudflareEmail(hex: string): string {
  const key = Number.parseInt(hex.slice(0, 2), 16)
  let email = ''
  for (let i = 2; i + 1 < hex.length; i += 2) email += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key)
  return email
}

const BLOCK = /<\/?(?:p|div|section|article|header|footer|nav|aside|ul|ol|dl|dt|dd|table|thead|tbody|tr|blockquote|details|summary|figure|figcaption|form|fieldset|br|hr)\b[^>]*>/gi

/** HTML to plain text a model can read: headings marked with #, list items with -, paragraphs on their own lines. */
function toText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|button)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:span|a)\b[^>]*\bdata-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/(?:span|a)>/gi, (_, hex: string) => cloudflareEmail(hex))
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, ' ')
    .replace(BLOCK, '\n')
    .replace(/<[^>]+>/g, '')
  return cleanLines(decodeEntities(text)).trim()
}

export type FetchPage = (url: string) => Promise<string>

/** Our own site, read like a visitor would: no cookie, ten seconds, a few megabytes at most. */
export const fetchOwnPage: FetchPage = async (url) => {
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    // Plain ASCII: a header cannot carry anything else.
    headers: { accept: 'text/html', 'user-agent': 'HeyNaija-Keke/1 (reads the site for its help bot; see /about/keke)' },
  })
  if (!res.ok) throw new UnreadablePageError(`answered ${res.status}`)
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) throw new UnreadablePageError('not HTML')
  const html = await res.text()
  if (html.length > 4_000_000) throw new UnreadablePageError('too large')
  return html
}

/**
 * The pages, read from the site and kept for an hour. A page that cannot be
 * read is left out with a log line, and its last good copy is used if there is
 * one. With none at all, `pages()` throws and Keke says nothing; nothing is kept,
 * so the next question tries the site again.
 */
export class Knowledge {
  private readonly log = new Logger('Keke')
  private readonly lastGood = new Map<KnowledgePath, KnowledgePage>()
  private readonly cache: Refreshing<KnowledgePage[]>

  constructor(
    private readonly siteUrl: string,
    private readonly fetchPage: FetchPage = fetchOwnPage,
    ttlMs = 60 * 60 * 1000,
  ) {
    this.cache = new Refreshing(ttlMs, () => this.load())
  }

  pages(): Promise<KnowledgePage[]> {
    return this.cache.get()
  }

  private async load(): Promise<KnowledgePage[]> {
    const read = await Promise.all(
      KNOWLEDGE_PAGES.map(async (path): Promise<KnowledgePage | null> => {
        try {
          const page = { path, ...mainText(await this.fetchPage(`${this.siteUrl}${path}`)) }
          this.lastGood.set(path, page)
          return page
        } catch (err) {
          const kept = this.lastGood.get(path)
          this.log.warn(`could not read ${path} for Keke (${(err as Error).message}); ${kept ? 'using the copy read before' : 'left out'}`)
          return kept ?? null
        }
      }),
    )
    const pages = read.filter((p): p is KnowledgePage => p !== null)
    if (!pages.length) throw new Error('no page could be read')
    return pages
  }
}
