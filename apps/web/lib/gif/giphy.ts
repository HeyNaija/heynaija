import type { GifHit, GifProvider } from './types.ts'

const ID = /^[A-Za-z0-9]{1,32}$/

/**
 * GIPHY's documented media host and path: https://media1.giphy.com/media/<id>/<rendition>.<ext>.
 * Built from the id only, and only for a well-formed one, so a stored value can never reshape the URL.
 */
const mediaUrl = (id: string, file: string) => `https://media1.giphy.com/media/${id}/${file}`

export const giphy: GifProvider = {
  id: 'giphy',
  label: 'GIPHY',
  idPattern: ID,
  searchPlaceholder: 'Search GIPHY',
  attribution: 'Powered by GIPHY',
  credit: 'GIF via GIPHY',
  media: (id) => (ID.test(id) ? { animatedUrl: mediaUrl(id, 'giphy.webp'), stillUrl: mediaUrl(id, 'giphy_s.gif') } : null),
  // GIPHY's fetch library, in its own chunk: GIPHY asks that calls and media are not proxied, so the browser
  // talks to it directly, limited to G and PG.
  async search(apiKey) {
    const { GiphyFetch } = await import('@giphy/js-fetch-api')
    const client = new GiphyFetch(apiKey)
    return async ({ term, offset, limit, retry }) => {
      // The library answers a URL that failed in the last 6 seconds from its cache without asking GIPHY,
      // so after a Try again the count goes into the URL to make it a request of its own.
      const options = { limit, offset, rating: 'pg' as const, ...(retry ? { retry: String(retry) } : {}) }
      const result = term ? await client.search(term, options) : await client.trending(options)
      const found: GifHit[] = []
      for (const gif of result.data) {
        const small = gif.images.fixed_width_small ?? gif.images.fixed_width
        const src = (small as { webp?: string; url: string }).webp ?? small.url
        // An id that is not letters and digits could not be posted, so it is not offered.
        if (ID.test(String(gif.id)) && src) found.push({ id: String(gif.id), title: gif.title || 'GIF', src })
      }
      const { offset: at, count, total_count: total } = result.pagination
      return { found, next: at + count < total ? at + count : null }
    }
  },
}
