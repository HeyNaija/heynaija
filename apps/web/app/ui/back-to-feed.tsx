'use client'

import Link from 'next/link'

/** The Navigation API's view of this tab's history (not in every TypeScript DOM library yet). */
type TabHistory = { currentEntry: { index: number } | null; entries: () => { url: string | null }[] }

/**
 * How many steps back the home feed is, when the reader came to this conversation from it
 * (perhaps through other posts): the nearest earlier entry in this tab that is not a post's
 * page, if that is the feed. Null otherwise, or without the Navigation API.
 */
function stepsToFeed(): number | null {
  const tab = (window as Window & { navigation?: TabHistory }).navigation
  const current = tab?.currentEntry
  if (!tab || !current) return null
  const entries = tab.entries()
  for (let index = current.index - 1; index >= 0; index--) {
    const url = entries[index]?.url
    if (!url) return null
    const { origin, pathname } = new URL(url)
    if (origin !== window.location.origin) return null
    if (pathname.startsWith('/p/')) continue
    return pathname === '/' ? current.index - index : null
  }
  return null
}

/**
 * Returns to the feed where the reader left it: going back in the tab's history keeps the
 * posts it had loaded and its scroll position, as the browser's Back does. Opened any other
 * way (a shared link, a profile, without JavaScript), it is a plain link to the feed.
 */
export function BackToFeed({ className }: { className?: string }) {
  return (
    <Link
      prefetch={false}
      href="/"
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const steps = stepsToFeed()
        if (!steps) return
        event.preventDefault()
        window.history.go(-steps)
      }}
    >
      Back to the feed
    </Link>
  )
}
