'use client'

import { useEffect } from 'react'

/**
 * Kratos keeps a flow's messages for as long as the flow lives, so reloading
 * `?flow=` would show the same error or "saved" notice again. Dropping the
 * parameter once it has been shown makes a reload start a fresh flow. The form
 * keeps working: its action URL already names the flow.
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
