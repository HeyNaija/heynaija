/**
 * The outlets Keke's daily news reads (docs/adr/0030), published on /about/keke.
 * Their order is the order outlets are named in, and the first outlet carrying a
 * story gives its link. Changing the list is a change in review, like the rule.
 */
export type NewsSource = {
  id: string
  name: string
  site: string
  feed: string
  /** Hours the feed's times run ahead: Nigerian time written as if it were UTC. */
  hoursAhead?: number
}

// Checked on 15 November 2026: each feed answered a server with RSS, every item had a
// description, and none of these outlets' terms forbids reading its feed. Left out: The
// Cable, The Guardian and The Nation (their feeds are behind a challenge a server cannot
// pass), ThisDay and The Sun (their terms forbid crawling), Arise (stale), and business-only
// outlets. Awaiting the owner's confirmation (docs/adr/0030).
export const NEWS_SOURCES: readonly NewsSource[] = [
  // Punch writes Nigerian time with a +0000 offset.
  { id: 'punch', name: 'Punch', site: 'https://punchng.com', feed: 'https://rss.punchng.com/v1/category/latest_news', hoursAhead: 1 },
  { id: 'premium-times', name: 'Premium Times', site: 'https://www.premiumtimesng.com', feed: 'https://www.premiumtimesng.com/feed' },
  { id: 'channels', name: 'Channels', site: 'https://www.channelstv.com', feed: 'https://www.channelstv.com/feed/' },
  { id: 'vanguard', name: 'Vanguard', site: 'https://www.vanguardngr.com', feed: 'https://www.vanguardngr.com/feed/' },
  { id: 'daily-trust', name: 'Daily Trust', site: 'https://dailytrust.com', feed: 'https://dailytrust.com/feed/' },
  { id: 'leadership', name: 'Leadership', site: 'https://leadership.ng', feed: 'https://leadership.ng/feed/' },
  { id: 'tribune', name: 'Nigerian Tribune', site: 'https://tribuneonlineng.com', feed: 'https://tribuneonlineng.com/feed/' },
  { id: 'daily-post', name: 'Daily Post', site: 'https://dailypost.ng', feed: 'https://dailypost.ng/feed/' },
  { id: 'gazette', name: 'Peoples Gazette', site: 'https://gazettengr.com', feed: 'https://gazettengr.com/feed/' },
  { id: 'tvc', name: 'TVC News', site: 'https://www.tvcnews.tv', feed: 'https://www.tvcnews.tv/feed/' },
]
