import { ARBITER_ONLY } from './chess-arena'

/** Naija Today (ADR 0030): Keke's daily news; only Keke starts posts there. */
export const NAIJA_TODAY = 'naija-today'

/**
 * Communities where only one of HeyNaija's automated accounts starts posts, with
 * what their page says instead of a composer: The Arbiter's (ADR 0028) and Keke's.
 */
export const BOT_ONLY: Readonly<Record<string, string>> = {
  ...ARBITER_ONLY,
  [NAIJA_TODAY]: 'Posts here are Keke’s daily news, one each morning once a person has checked it. Reply under a story to talk about it.',
}
