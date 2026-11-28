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

const listedNames = (raw: string) => [...new Set(raw.split(',').map((name) => name.trim()).filter(Boolean))]

/**
 * GIF_PROVIDERS from the environment: a comma-separated list of names, or `none` alone. Empty,
 * unset, or a list with no names in it (`,`, spaces) is GIPHY; only `none` turns GIFs off, and
 * `none` beside a provider stops the API.
 */
export const gifProvidersSetting = z.preprocess(
  (value) => (typeof value === 'string' && !listedNames(value).length ? undefined : value),
  z
    .string()
    .default('giphy')
    .transform((raw, ctx) => {
      const names = listedNames(raw)
      if (names.length === 1 && names[0] === 'none') return []
      if (names.includes('none')) {
        ctx.addIssue({ code: 'custom', message: 'none turns GIFs off, so it cannot be listed with providers; give none alone, or only providers' })
        return z.NEVER
      }
      for (const name of names) {
        if (!isGifProviderName(name)) ctx.addIssue({ code: 'custom', message: `${name} is ${UNKNOWN_GIF_PROVIDER}` })
      }
      return names as GifProviderName[]
    }),
)
