'use client'

import { useEffect } from 'react'

/**
 * Kratos keeps a flow as it was made for as long as it lives (up to an hour): its
 * messages, and which sign-in methods it offers to connect or disconnect. So
 * reloading `?flow=` would show the same error or "saved" notice again, or leave
 * out Apple connected in the app since. Dropping the parameter once the page has
 * loaded makes a reload start a fresh flow. The form keeps working: its action
 * URL already names the flow.
 */
export function ForgetFlowParam() {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('flow')) return
    url.searchParams.delete('flow')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }, [])
  return null
}
