import type { AppEnv } from '../env.js'

/**
 * Every feature flag there is. Adding one means adding it here, in review
 * (docs/feature-flags.md); the database holds overrides only, and a key that is
 * not in this list is ignored wherever it turns up.
 *
 * Policy: staging (and development, which follows it) is ON for everything.
 * Production is ON for what is already live there (its code is in `main`, which
 * deploys to production on every push), and OFF for a feature whose code is not in
 * `main` yet, until the team launches it, which an admin then does at runtime.
 * Switching a live feature off is an admin action, never a default. Changing a
 * production default shows up in the registry test's LIVE_IN_MAIN table.
 */
export type FlagDefinition = {
  description: string
  /** The part of the product that answers for it. */
  owner: string
  defaults: Record<AppEnv, boolean>
}

/** Use `{ development: true, staging: true, production: false }` for a feature not in `main` yet. */
const onEverywhere = { development: true, staging: true, production: true } as const

export const FLAGS = {
  polls: {
    description: 'Creating polls in posts, and voting in them. Polls already posted stay visible and keep their results.',
    owner: 'posts',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
  },
  replyControls: {
    description: 'Choosing who may reply to a new post, and changing it afterwards. A limit already set keeps being enforced.',
    owner: 'posts',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
  },
  topicDiscovery: {
    description: 'The trending topics shown beside the feed.',
    owner: 'discovery',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
  },
  onboarding: {
    description: 'The welcome flow new members are sent through, and its endpoints.',
    owner: 'onboarding',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
  },
  profilePins: {
    description: 'Pinning a post on your own profile. Unpinning always works, and posts already pinned stay pinned.',
    owner: 'profiles',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
  },
  communityPins: {
    description: 'Pinning a welcome post in a community. Unpinning always works, and posts already pinned stay pinned.',
    owner: 'communities',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
  },
  reposts: {
    description: 'Making a repost. A kill switch: undoing a repost always works, and reposts already made stay in feeds.',
    owner: 'posts',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
  },
  quotePosts: {
    description: 'Writing a new quote post. A kill switch: quote posts already made stay visible.',
    owner: 'posts',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
  },
  linkPreviews: {
    description: 'Fetching the linked page to build a preview card for a new post. A kill switch for the one place the API reads other websites.',
    owner: 'links',
    defaults: onEverywhere, // code in main: see LIVE_IN_MAIN in feature-flags.test.ts
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
export function resolveFlag(
  key: FlagKey,
  appEnv: AppEnv,
  override: FlagOverride | undefined,
  viewerId?: string | null,
  registry: Record<FlagKey, FlagDefinition> = FLAGS,
): boolean {
  if (override && override.allow.size > 0) return viewerId != null && override.allow.has(viewerId)
  if (override && override.enabled !== null) return override.enabled
  return registry[key].defaults[appEnv]
}
