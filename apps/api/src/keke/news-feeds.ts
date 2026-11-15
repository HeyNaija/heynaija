import { decodeEntities } from '../links/page-meta.js'
import type { PageFetcher } from '../links/safe-fetch.js'
import { cleanLine } from '../text.js'
import type { NewsSource } from './news-sources.js'

/** One headline from an outlet's feed: all Keke ever takes from an outlet. */
export type NewsItem = { outlet: string; title: string; url: string; description: string; publishedAt: Date }

/** Longest description kept from an item; the model needs a line, not the article. */
const DESCRIPTION_MAX = 300
const FEED_MAX_BYTES = 3_000_000

/** The text inside the first `<tag>…</tag>` of `xml`, CDATA unwrapped, or null. */
function field(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  if (!m) return null
  return m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

/** Markup, entities and spacing out of a feed's text. */
const plain = (text: string | null) => cleanLine(decodeEntities((text ?? '').replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' '))

const shorten = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`)

/** An http(s) address without its tracking tags (utm_…), or null. */
function address(raw: string | null): string | null {
  try {
    const url = new URL(decodeEntities((raw ?? '').trim()))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  } catch {
    return null
  }
}

/** What feeds add to every description: "The post … appeared first on …". */
const boilerplate = (text: string) => text.replace(/\s*The post .{1,300}? appeared first on .{1,120}?\.?\s*$/i, '').trim()

/** Paid-for items some outlets mix into their news feed. */
const sponsored = (url: string) => /\/(promoted|sponsored)(\/|$)/i.test(new URL(url).pathname)

/**
 * The items of an RSS 2.0 or Atom feed published since `since`: headline,
 * link, a short plain description and when. Items without a headline, a link
 * or a date it can read are left out.
 */
export function parseFeed(xml: string, outlet: string, since: Date, hoursAhead = 0): NewsItem[] {
  const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
  const items: NewsItem[] = []
  for (const [, kind, body] of entries) {
    const title = plain(field(body!, 'title'))
    const url =
      kind!.toLowerCase() === 'item'
        ? address(field(body!, 'link') ?? field(body!, 'guid'))
        : address(/<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/i.exec(body!)?.[1] ?? /<link\b[^>]*href="([^"]+)"/i.exec(body!)?.[1] ?? null)
    const stated = new Date(plain(field(body!, 'pubDate') ?? field(body!, 'published') ?? field(body!, 'updated') ?? field(body!, 'dc:date')))
    const when = new Date(stated.getTime() - hoursAhead * 3_600_000)
    // Never content:encoded, which some outlets fill with the whole article: only the short description.
    const description = boilerplate(plain(field(body!, 'description') ?? field(body!, 'summary')))
    if (!title || !url || sponsored(url) || Number.isNaN(when.getTime()) || when < since || when.getTime() > Date.now() + 3_600_000) continue
    items.push({ outlet, title: shorten(title, 200), url, description: shorten(description, DESCRIPTION_MAX), publishedAt: when })
  }
  return items
}

/**
 * Every outlet's items from the last `hours`, read with the fetcher that only
 * goes to public addresses. An outlet whose feed fails is listed in `failed`
 * and the rest go on.
 */
export async function readFeeds(fetcher: PageFetcher, sources: readonly NewsSource[], hours = 24): Promise<{ items: NewsItem[]; failed: string[] }> {
  const since = new Date(Date.now() - hours * 3_600_000)
  const read = await Promise.all(
    sources.map(async (source) => {
      try {
        const page = await fetcher.get(source.feed, {
          accept: ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml', 'application/rdf+xml'],
          maxBytes: FEED_MAX_BYTES,
          timeoutMs: 15_000,
        })
        return { source, items: parseFeed(page.body.toString('utf8'), source.id, since, source.hoursAhead) }
      } catch {
        return { source, items: null }
      }
    }),
  )
  return {
    items: read.flatMap((r) => r.items ?? []),
    failed: read.filter((r) => r.items === null).map((r) => r.source.id),
  }
}
