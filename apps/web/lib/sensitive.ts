import type { Me } from './api'

/** Whether `me` may mark posts sensitive (ADR 0020): the adultLabels flag is on for them, and they count as an adult. */
export const canMarkSensitive = (me: Pick<Me, 'features' | 'sensitive'>): boolean =>
  me.features?.adultLabels === true && me.sensitive?.adult === true

/** Whether the composer offers the mark: not when their Settings already mark everything they post, which then happens without asking. */
export const composerOffersMark = (me: Pick<Me, 'features' | 'sensitive'>): boolean => canMarkSensitive(me) && !me.sensitive?.markPosts
