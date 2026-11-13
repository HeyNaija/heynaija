import { DISCOVER_RULES } from '../posts/discover.js'

// The rules weekly highlights are chosen by (ADR 0027). They are served on their
// own for the page that explains them (/about/highlights), so that page always
// states what this code does. Changing one amends the ADR.
export const HIGHLIGHTS_RULES = {
  /** Only for a member who has not opened HeyNaija for this many days. */
  awayDays: 3,
  /** After this many days away we stop writing: someone gone that long has left, and is not chased. */
  stopAfterDays: 56,
  /** Only conversations started in this many days before the send, and after the member was last here. */
  windowDays: 7,
  /** At most this many conversations. */
  maxPosts: 5,
  /** With fewer than this many worth sending, nothing is sent that week. */
  minPosts: 2,
  // The points are Discover's (ADR 0014), so one set of rules says what counts
  // as activity everywhere. There is no ageing here: this is the week, not now.
  /** For each different member, other than the author, who replied anywhere in the conversation or quoted it. */
  conversationPoints: DISCOVER_RULES.conversationPoints,
  /** For each like: the public count, nothing about who. */
  likePoints: DISCOVER_RULES.likePoints,
  /** For each repost. */
  repostPoints: DISCOVER_RULES.repostPoints,
  /** More, for each person the member follows among those who replied, quoted or reposted. */
  followedPoints: DISCOVER_RULES.followedPoints,
  /** When the member follows the author. */
  followsAuthorPoints: DISCOVER_RULES.followsAuthorPoints,
  /** When it is in a community the member joined. */
  joinedCommunityPoints: DISCOVER_RULES.joinedCommunityPoints,
  /** Open reports from this many different members hold a post out until a moderator decides. */
  reportsToHold: DISCOVER_RULES.reportsToHold,
  /** A week's run stays open this many hours, so a server that was away at the hour still sends. */
  openHours: 24,
} as const

export type HighlightsRules = { [K in keyof typeof HIGHLIGHTS_RULES]: number }

/** When the week's run starts: a day of the week (0 is Sunday) and an hour, both in UTC. */
export type HighlightsSchedule = { weekday: number; hourUtc: number }

/**
 * The start of the run that is open at `now`, or null when none is: the latest
 * `weekday` at `hourUtc` that has passed, if it passed less than `openHours`
 * ago. A member the run has dealt with since then is done for the week.
 */
export function openRun(now: Date, { weekday, hourUtc }: HighlightsSchedule, openHours: number = HIGHLIGHTS_RULES.openHours): Date | null {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc))
  start.setUTCDate(start.getUTCDate() - ((now.getUTCDay() - weekday + 7) % 7))
  if (start.getTime() > now.getTime()) start.setUTCDate(start.getUTCDate() - 7)
  return now.getTime() - start.getTime() < openHours * 3_600_000 ? start : null
}
