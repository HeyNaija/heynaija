/** What a Giphy id looks like. Keep in step with apps/api/src/posts/posts.service.ts (tests/giphy.test.mjs checks). */
export const GIPHY_ID = /^[A-Za-z0-9]{1,32}$/

/**
 * Giphy's documented media host and path: https://media1.giphy.com/media/<id>/<rendition>.<ext>.
 * Built from the id only, and only for a well-formed one, so a stored value can never reshape the URL.
 */
const mediaUrl = (id: string, file: string) => (GIPHY_ID.test(id) ? `https://media1.giphy.com/media/${id}/${file}` : null)

/** The animated GIF as WebP. */
export const giphyMediaUrl = (id: string) => mediaUrl(id, 'giphy.webp')

/** Its first frame, for readers who ask for less motion. */
export const giphyStillUrl = (id: string) => mediaUrl(id, 'giphy_s.gif')

/** A key from the environment: empty or blank is unset. */
export const giphyKeyFrom = (raw: string | undefined) => raw?.trim() || null
