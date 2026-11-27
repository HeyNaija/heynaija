import { GIF_PROVIDERS, gifProvider } from './providers.ts'
import type { GifProvider } from './types.ts'

/**
 * Which provider's search the composer offers, with its key: NEXT_PUBLIC_GIF_PROVIDER (GIPHY when
 * empty or unset) and that provider's key. Null, with no search, when the provider is not one this
 * app knows or it has no key. GIFs already posted are drawn by their own provider, whatever this says.
 */
export function composerGif(
  { provider, keys }: { provider: string | undefined; keys: Record<string, string | undefined> },
  providers: Record<string, GifProvider> = GIF_PROVIDERS,
): { provider: GifProvider; apiKey: string } | null {
  const chosen = gifProvider(provider?.trim() || 'giphy', providers)
  const apiKey = chosen && Object.hasOwn(keys, chosen.id) ? keys[chosen.id]?.trim() : undefined
  return chosen && apiKey ? { provider: chosen, apiKey } : null
}

/**
 * Fixed into the bundle when `next build` runs (NEXT_PUBLIC_*): the Docker build takes them as
 * build arguments. Each is written out because Next.js replaces only `process.env.NAME` as written.
 * Only the composer imports this file, so other pages carry no key.
 */
export const COMPOSER_GIF = composerGif({
  provider: process.env.NEXT_PUBLIC_GIF_PROVIDER,
  keys: { giphy: process.env.NEXT_PUBLIC_GIPHY_API_KEY },
})
