'use client'

import { useEffect } from 'react'
import { markNotificationsRead } from '@/app/actions'

/**
 * Marks notifications read once they are on screen. Done from the browser, not
 * while rendering, so prefetching the page does not count as reading it. The
 * page keeps showing which ones were new until the member moves on.
 */
export function MarkRead({ upTo }: { upTo: string }) {
  useEffect(() => {
    void markNotificationsRead(upTo)
  }, [upTo])
  return null
}
