import type { Metadata } from 'next'
import { connection } from 'next/server'
import { defaultPreviewImage, siteOpenGraph } from './previews'

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
