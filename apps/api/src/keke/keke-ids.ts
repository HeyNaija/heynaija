/**
 * Keke, HeyNaija's help bot (docs/adr/0030), as plain values so posts and
 * members can use them without depending on the rest of Keke.
 */

/** Keke: an automated account. Nobody signs in to it. */
export const KEKE_ID = 'ce4e0000-0000-4000-8000-000000000001'
export const KEKE_HANDLE = 'keke'
/** Used only if a person already had `keke` before Keke existed. */
export const KEKE_FALLBACK_HANDLE = 'keke_hn'

/** Handles nobody may take by signing up or renaming. */
export const KEKE_HANDLES: readonly string[] = [KEKE_HANDLE, KEKE_FALLBACK_HANDLE]

/** At most BIO_MAX (160) characters, like anyone's. */
export const KEKE_BIO =
  'Automated account. Mention @keke with a question about HeyNaija and it answers from HeyNaija’s own pages. It can be wrong. Nobody signs in to it.'
