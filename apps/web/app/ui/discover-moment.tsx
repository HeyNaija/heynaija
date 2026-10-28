'use client'

import { useEffect } from 'react'

/**
 * Puts the moment Discover was ranked as of in the page's address
 * (`?feed=discover&at=…`), so that when the page is loaded again (after a
 * bookmark, a follow, a new post) it is ranked as of the same moment and nothing
 * on it moves. Opening Home or the tab again starts afresh.
 */
export function DiscoverMoment({ at }: { at: string }) {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('cursor') || url.searchParams.get('at') === at) return
    url.searchParams.set('feed', 'discover')
    url.searchParams.set('at', at)
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }, [at])
  return null
}
