import { z } from 'zod'

/**
 * A GIF provider as the API sees it: a name for messages, and what its ids look like. The API
 * never contacts a provider; the member's browser picks the GIF and readers' browsers load it,
 * by the provider's name and this id (docs/adr/0031-gif-providers.md).
 */
export type GifProvider = {
  label: string
  /** Narrower than GIF_ID_PATTERN in packages/db: the id goes into the provider's media URL. */
  id: RegExp
  idRule: string
}

/** Every provider a new post may name. Posts already made keep whatever name they were made with. */
export const GIF_PROVIDERS = {
  giphy: { label: 'GIPHY', id: /^[A-Za-z0-9]{1,32}$/, idRule: 'a GIPHY id is letters and digits only, up to 32' },
} as const satisfies Record<string, GifProvider>

export type GifProviderName = keyof typeof GIF_PROVIDERS

export const UNKNOWN_GIF_PROVIDER = 'not a GIF provider HeyNaija knows'

export const isGifProviderName = (name: string): name is GifProviderName => Object.hasOwn(GIF_PROVIDERS, name)

/** GIF_PROVIDERS from the environment: a comma-separated list of names, or `none`. Empty or unset is GIPHY. */
export const gifProvidersSetting = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .default('giphy')
    .transform((raw, ctx) => {
      const names = [...new Set(raw.split(',').map((name) => name.trim()).filter(Boolean))]
      if (names.length === 1 && names[0] === 'none') return []
      for (const name of names) {
        if (!isGifProviderName(name)) ctx.addIssue({ code: 'custom', message: `${name} is ${UNKNOWN_GIF_PROVIDER}` })
      }
      return names as GifProviderName[]
    }),
)
