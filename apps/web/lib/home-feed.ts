/** The feeds on the home page, in tab order. Following is for members only. */
export const HOME_FEEDS = ['discover', 'latest', 'following'] as const
export type HomeFeed = (typeof HOME_FEEDS)[number]

/** Remembers the home feed tab a reader last chose. It stays in their browser, for a year. */
export const FEED_COOKIE = 'hn_feed'
export const FEED_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

const isFeed = (feed: string | undefined, member: boolean): feed is HomeFeed =>
  HOME_FEEDS.includes(feed as HomeFeed) && (feed !== 'following' || member)

/**
 * The feed the home page shows: the one in its address, else the tab the reader
 * last chose, else Discover. Following needs a member; anyone else gets Discover.
 */
export function homeFeed(asked: string | undefined, remembered: string | undefined, member: boolean): HomeFeed {
  if (isFeed(asked, member)) return asked
  if (isFeed(remembered, member)) return remembered
  return 'discover'
}
