import { gifMedia } from './gif/providers.ts'
import type { GifTag } from './gif/types.ts'

type Quoted = { images: unknown[]; gif: GifTag | null; hasVideo: boolean; coverMedia: boolean }

export type QuoteMedia = { kind: 'images' } | { kind: 'gif'; src: string; alt: string } | { kind: 'note'; text: string } | null

/**
 * What a quoted post's card shows besides its words: its pictures, its GIF's first frame (it never
 * moves in a quote), or a line saying what is there when it is covered, held for data saving, a
 * video, or a GIF from a provider this app cannot show.
 */
export function quoteMedia(quote: Quoted, saver: boolean): QuoteMedia {
  const images = quote.images.length
  if (!images && !quote.gif && !quote.hasVideo) return null
  if (quote.coverMedia) return { kind: 'note', text: 'Sensitive content. Open the post to see it.' }
  if (quote.hasVideo) return { kind: 'note', text: 'Video. Open the post to watch it.' }
  if (images) return saver ? { kind: 'note', text: `${images === 1 ? '1 image' : `${images} images`} not loaded. Open the post to load.` } : { kind: 'images' }
  if (saver) return { kind: 'note', text: 'GIF not loaded. Open the post to load.' }
  const media = gifMedia(quote.gif!)
  return media ? { kind: 'gif', src: media.stillUrl, alt: quote.gif!.alt.trim() } : { kind: 'note', text: 'GIF unavailable.' }
}
