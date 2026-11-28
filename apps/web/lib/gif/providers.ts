import { giphy } from './giphy.ts'
import type { GifProvider } from './types.ts'

/** Every provider this app can draw and search. A post naming any other shows "GIF unavailable". */
export const GIF_PROVIDERS: Record<string, GifProvider> = { giphy }

/** The provider a post names, or null for one this app does not know. */
export const gifProvider = (name: string, providers: Record<string, GifProvider> = GIF_PROVIDERS): GifProvider | null =>
  Object.hasOwn(providers, name) ? providers[name]! : null

/** What to draw for a post's GIF: its provider and its media, or null when either is not known or well formed. */
export function gifMedia(tag: { provider: string; id: string }, providers: Record<string, GifProvider> = GIF_PROVIDERS) {
  const provider = gifProvider(tag.provider, providers)
  const media = provider?.media(tag.id)
  return provider && media ? { provider, ...media } : null
}

/** What to show: the animation while `playing`, its first frame while paused. */
export const gifSource = (media: { animatedUrl: string; stillUrl: string }, playing: boolean) => (playing ? media.animatedUrl : media.stillUrl)
