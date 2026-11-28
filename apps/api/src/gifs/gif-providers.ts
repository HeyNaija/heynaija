import { GIF_ID_PATTERN, GIF_PROVIDER_PATTERN } from '@heynaija/db'
import { z } from 'zod'
import { ALT_MAX } from '../media/media.service.js'
import { GIF_PROVIDERS, type GifProvider, type GifProviderName, isGifProviderName, UNKNOWN_GIF_PROVIDER } from './registry.js'

export { GIF_PROVIDERS, type GifProvider, type GifProviderName } from './registry.js'

const providerShape = new RegExp(GIF_PROVIDER_PATTERN)
const idShape = new RegExp(GIF_ID_PATTERN)

/** The `gif` of a new post, checked against `providers`: the provider must be one of them and the id must fit its rule. */
export const gifInputFor = (providers: Record<string, GifProvider>) =>
  z
    .strictObject(
      {
        provider: z.string(),
        id: z.string(),
        description: z.string().trim().max(ALT_MAX).default(''),
      },
      {
        error: (issue) =>
          issue.code === 'unrecognized_keys' ? `a GIF takes provider, id and description, not ${issue.keys.join(', ')}` : undefined,
      },
    )
    .superRefine((gif, ctx) => {
      const provider = providerShape.test(gif.provider) && Object.hasOwn(providers, gif.provider) ? providers[gif.provider] : undefined
      if (!provider) return ctx.addIssue({ code: 'custom', path: ['provider'], message: UNKNOWN_GIF_PROVIDER })
      if (!idShape.test(gif.id) || !provider.id.test(gif.id)) ctx.addIssue({ code: 'custom', path: ['id'], message: provider.idRule })
    })

export const gifInput = gifInputFor(GIF_PROVIDERS)
export type GifInput = z.infer<typeof gifInput>

/** Which providers take new GIFs (GIF_PROVIDERS). Turning one off leaves its GIFs already posted as they are. */
export class GifProviders {
  constructor(private readonly forNewPosts: readonly GifProviderName[]) {}

  acceptsNew(name: string): boolean {
    return isGifProviderName(name) && this.forNewPosts.includes(name)
  }

  label(name: string): string {
    return isGifProviderName(name) ? GIF_PROVIDERS[name].label : name
  }
}
