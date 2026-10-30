import type { AppEnv } from '../env.js'

/**
 * Every feature flag there is. Adding one means adding it here, in review
 * (docs/feature-flags.md); the database holds overrides only, and a key that is
 * not in this list is ignored wherever it turns up.
 *
 * Policy: staging (and development, which follows it) is ON for everything.
 * Production is ON only for what is already live for everyone, and OFF for
 * anything new or risky until the team decides to launch it, which an admin then
 * does at runtime with no deploy.
 */
export type FlagDefinition = {
  description: string
  /** The part of the product that answers for it. */
  owner: string
  defaults: Record<AppEnv, boolean>
}

const onUntilLaunched = { development: true, staging: true, production: false } as const
const onEverywhere = { development: true, staging: true, production: true } as const

export const FLAGS = {
  polls: {
    description: 'Creating polls in posts, and voting in them. Polls already posted stay visible and keep their results.',
    owner: 'posts',
    defaults: onUntilLaunched, // roadmap: social-polls, not live
  },
  replyControls: {
    description: 'Choosing who may reply to a new post, and changing it afterwards. A limit already set keeps being enforced.',
    owner: 'posts',
    defaults: onUntilLaunched, // roadmap: reply-controls, not live
  },
  topicDiscovery: {
    description: 'The trending topics shown beside the feed.',
    owner: 'discovery',
    defaults: onUntilLaunched, // roadmap: topic-discovery, not live
  },
  onboarding: {
    description: 'The welcome flow new members are sent through, and its endpoints.',
    owner: 'onboarding',
    defaults: onUntilLaunched, // roadmap: member-onboarding, not live
  },
  profilePins: {
    description: 'Pinning and unpinning a post on your own profile. Posts already pinned stay pinned.',
    owner: 'profiles',
    defaults: onUntilLaunched, // roadmap: profile-pins, not live
  },
  communityPins: {
    description: 'Pinning and unpinning a welcome post in a community. Posts already pinned stay pinned.',
    owner: 'communities',
    defaults: onUntilLaunched, // roadmap: community-welcome-pins, not live
  },
  reposts: {
    description: 'Reposting and undoing a repost. A kill switch: reposts already made stay in feeds.',
    owner: 'posts',
    defaults: onEverywhere, // roadmap: reposts, implemented and not recorded as unlaunched
  },
  quotePosts: {
    description: 'Writing a new quote post. A kill switch: quote posts already made stay visible.',
    owner: 'posts',
    defaults: onEverywhere, // roadmap: quote-posts, as reposts
  },
  linkPreviews: {
    description: 'Fetching the linked page to build a preview card for a new post. A kill switch for the one place the API reads other websites.',
    owner: 'links',
    defaults: onEverywhere, // roadmap: link-previews, as reposts
  },
} as const satisfies Record<string, FlagDefinition>

export type FlagKey = keyof typeof FLAGS

export const flagKeys = Object.keys(FLAGS) as FlagKey[]

/** True only for keys in the registry. `hasOwn`, so "constructor" and "__proto__" are not keys. */
export const isFlagKey = (key: string): key is FlagKey => Object.hasOwn(FLAGS, key)

/** An override as stored: `enabled` null is "no override", a non-empty `allow` is an allow-list of member ids. */
export type FlagOverride = { enabled: boolean | null; allow: ReadonlySet<string> }

/**
 * Whether a flag is on for a viewer: an allow-list first (on for those members
 * only, off for everyone else, whatever the rest says), then an on/off override,
 * then the default for this environment.
 */
export function resolveFlag(key: FlagKey, appEnv: AppEnv, override: FlagOverride | undefined, viewerId?: string | null): boolean {
  if (override && override.allow.size > 0) return viewerId != null && override.allow.has(viewerId)
  if (override && override.enabled !== null) return override.enabled
  return FLAGS[key].defaults[appEnv]
}
