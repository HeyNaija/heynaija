import type { ProfileFilter } from '@/lib/api'

/** Which list of posts a page shows, so more of the same list can be loaded onto it. */
export type FeedSource =
  | { kind: 'latest' }
  | { kind: 'following' }
  | { kind: 'community'; slug: string }
  | { kind: 'member'; handle: string; filter: ProfileFilter }
  | { kind: 'bookmarks' }

/** The plain link to the next page: what "Older posts" does without JavaScript. */
export function olderHref(source: FeedSource, cursor: string) {
  const c = `cursor=${encodeURIComponent(cursor)}`
  switch (source.kind) {
    case 'latest':
      return `/?${c}`
    case 'following':
      return `/?feed=following&${c}`
    case 'community':
      return `/c/${encodeURIComponent(source.slug)}?${c}`
    case 'member':
      return `/u/${encodeURIComponent(source.handle)}?${source.filter === 'posts' ? '' : `tab=${source.filter}&`}${c}`
    case 'bookmarks':
      return `/bookmarks?${c}`
  }
}
