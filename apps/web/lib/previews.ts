// How HeyNaija links look when they are pasted into WhatsApp, X and the like.

/**
 * The origin members reach the site on: previews need absolute links. The same
 * variable and default as the API (apps/api/src/env.ts). Read when the server
 * starts, so only metadata built per request (posts, profiles) should rely on it;
 * metadata prerendered by `next build` would keep the build machine's value.
 */
export const siteOrigin = new URL(process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:3000')

/** Open Graph fields every page shares. A page that sets `openGraph` replaces the layout's, so spread this in. */
export const siteOpenGraph = { siteName: 'HeyNaija', locale: 'en_NG' } as const

/** For links to things with no picture of their own. */
export const defaultPreviewImage = {
  url: '/brand/community-conversation.jpg',
  width: 640,
  height: 427,
  alt: 'Three friends in conversation',
}

/** Text on one line, cut at a word before `max` characters. For descriptions and share sheets. */
export function excerpt(text: string, max = 200) {
  const line = text.replace(/\s+/g, ' ').trim()
  // By code point, so an emoji is never cut in half.
  const chars = [...line]
  if (chars.length <= max) return line
  let cut = chars.slice(0, max - 1).join('')
  const space = cut.lastIndexOf(' ')
  if (space > cut.length * 0.6) cut = cut.slice(0, space)
  return `${cut.trimEnd()}…`
}
