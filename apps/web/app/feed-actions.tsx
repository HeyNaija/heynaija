'use server'

import type { ReactNode } from 'react'
import { PostItem } from '@/app/ui/post-item'
import type { FeedSource } from '@/app/ui/feed-source'
import {
  type Feed,
  getBookmarks,
  getCommunityPosts,
  getDiscoverFeed,
  getFeed,
  getFollowingFeed,
  getHashtagPosts,
  getMemberPosts,
  getViewer,
  PROFILE_FILTERS,
} from '@/lib/api'

/**
 * The most batches one call may ask for. A refresh reloads everything the reader
 * has appended, and past the automatic batches they can keep asking for more.
 */
const MAX_BATCHES = 20

/** Each item is a keyed <li>, so a rebuilt list keeps the cards that are already on screen. */
export type OlderPosts = { items: ReactNode[]; count: number; cursor: string | null } | { error: true }

function fetchPage(source: FeedSource, cursor: string): Promise<Feed | null> {
  switch (source.kind) {
    case 'latest':
      return getFeed(cursor)
    case 'following':
      return getFollowingFeed(cursor)
    case 'discover':
      return getDiscoverFeed(cursor)
    case 'community':
      return getCommunityPosts(source.slug, cursor)
    case 'hashtag':
      return getHashtagPosts(source.tag, cursor)
    case 'member':
      return getMemberPosts(source.handle, source.filter, cursor)
    case 'bookmarks':
      return getBookmarks(cursor)
  }
}

const isSource = (s: unknown): s is FeedSource => {
  if (!s || typeof s !== 'object') return false
  const { kind, slug, tag, handle, filter } = s as Record<string, unknown>
  if (kind === 'community') return typeof slug === 'string' && slug.length <= 100
  if (kind === 'hashtag') return typeof tag === 'string' && tag.length <= 200
  if (kind === 'member') {
    return typeof handle === 'string' && handle.length <= 100 && PROFILE_FILTERS.includes(filter as never)
  }
  return kind === 'latest' || kind === 'following' || kind === 'discover' || kind === 'bookmarks'
}

/**
 * The posts after `cursor` in a feed, rendered exactly as the page renders them.
 * Several batches at once when a refresh has to rebuild what the reader appended.
 * The API still decides what this visitor may see; this only relays their session.
 */
export async function loadOlderPosts(source: FeedSource, cursor: string, batches = 1): Promise<OlderPosts> {
  if (!isSource(source) || typeof cursor !== 'string' || cursor.length > 200) return { error: true }
  const viewer = await getViewer()
  const viewerId = viewer.state === 'member' ? viewer.me.id : null

  const posts = []
  let next: string | null = cursor
  try {
    for (let i = 0; i < Math.min(Math.max(1, batches), MAX_BATCHES) && next; i++) {
      const page = await fetchPage(source, next)
      if (!page) return { error: true }
      posts.push(...page.posts)
      next = page.cursor
    }
  } catch {
    return { error: true }
  }

  const now = Date.now()
  return {
    count: posts.length,
    cursor: next,
    items: posts.map((post) => (
      <li key={post.id}>
        <PostItem
          post={post}
          viewerId={viewerId}
          now={now}
          hideCommunity={source.kind === 'community'}
          explain={source.kind === 'latest' || source.kind === 'following' || source.kind === 'discover'}
        />
      </li>
    )),
  }
}
