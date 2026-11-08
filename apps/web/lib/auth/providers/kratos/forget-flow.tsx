'use client'

import { useEffect } from 'react'

/**
 * Kratos keeps a flow as it was made for as long as it lives (up to an hour): its
 * messages, and which sign-in methods it offers to connect or disconnect. So:
 *
 * - Once a message has been [shown], `?flow=` leaves the address, so a reload does
 *   not show the same error or "saved" notice again. The form keeps working: its
 *   action URL already names the flow.
 * - Reloading the page, or coming back to it with Back or Forward, starts a fresh
 *   flow, so it shows what is true now: Apple connected in the iOS app since, say.
 *
 * Otherwise the flow stays in the address: the page's other forms (notifications,
 * sensitive content) save and then re-render it, and without `?flow=` that would
 * send the browser to Kratos for a new flow and lose their "Saved." notice.
 */
export function ForgetFlowParam({ shown }: { shown: boolean }) {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('flow')) return
    url.searchParams.delete('flow')
    const fresh = url.pathname + url.search + url.hash
    // How this document was loaded, if it was loaded here and not navigated to from another page.
    const load = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (load?.name === window.location.href && (load.type === 'reload' || load.type === 'back_forward')) window.location.replace(fresh)
    else if (shown) window.history.replaceState(null, '', fresh)
  }, [shown])
  return null
}
