// How HeyNaija links look when they are pasted into WhatsApp, X and the like.

import type { Metadata } from 'next'
import { connection } from 'next/server'

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

/**
 * The preview for a page with no picture of its own: the site's picture, on the
 * large card that shows it. For `generateMetadata`, never a `metadata` object: one
 * build serves staging and production, so a picture's address prerendered by
 * `next build` is the build machine's (http://127.0.0.1:3000/...), which no preview
 * fetcher can load. This waits for a request, when the address is the site's.
 * The preview takes the page's own title and description; `title` is for one whose
 * preview should read differently from its tab.
 */
export async function sitePicturePreview(title?: string): Promise<Pick<Metadata, 'openGraph' | 'twitter'>> {
  await connection()
  return {
    openGraph: { ...siteOpenGraph, type: 'website', ...(title && { title }), images: [defaultPreviewImage] },
    twitter: { card: 'summary_large_image' },
  }
}

/** Text on one line, cut at a word before `max` characters. For descriptions and share previews. */
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

type PreviewedPost = {
  text: string
  authorHandle: string
  sensitive: 'author' | 'moderator' | 'community' | null
  images: { src: string; alt: string; width: number; height: number; animated: boolean }[]
}

/**
 * What a link to a post shows besides whose it is: its text, and its first
 * picture at 640px (a GIF's first frame), big enough for a preview card and small
 * enough for WhatsApp to fetch. A post marked sensitive shows neither (ADR 0020):
 * preview fetchers are signed out and never get one, and for the adult who opens
 * it, its picture's address is signed for them and runs out within two hours
 * (ADR 0025), so it never goes into the page's tags.
 */
export function postPreview(post: PreviewedPost): { description: string | undefined; image: { url: string; width: number; height: number; alt: string } } {
  if (post.sensitive) return { description: undefined, image: defaultPreviewImage }
  // A post always has text, images or both.
  const photos = post.images.length === 1 ? 'a photo' : `${post.images.length} photos`
  const description = post.text ? excerpt(post.text) : `@${post.authorHandle} shared ${photos}.`
  const first = post.images[0]
  if (!first) return { description, image: defaultPreviewImage }
  const scale = Math.min(1, 640 / Math.max(first.width, first.height))
  return {
    description,
    image: { url: `${first.src}/${first.animated ? 'still' : '640'}.webp`, width: Math.round(first.width * scale), height: Math.round(first.height * scale), alt: first.alt },
  }
}
