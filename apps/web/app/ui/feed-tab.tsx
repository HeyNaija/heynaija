'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { FEED_COOKIE, FEED_COOKIE_MAX_AGE, type HomeFeed } from '@/lib/home-feed'

/** A home feed tab. Choosing one is remembered, so Home opens on it next time. */
export function FeedTab({ feed, active, children }: { feed: HomeFeed; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={`/?feed=${feed}`}
      aria-current={active ? 'page' : undefined}
      className="feed-tab"
      onClick={() => {
        const secure = window.location.protocol === 'https:' ? '; secure' : ''
        document.cookie = `${FEED_COOKIE}=${feed}; path=/; max-age=${FEED_COOKIE_MAX_AGE}; samesite=lax${secure}`
      }}
    >
      {children}
    </Link>
  )
}
