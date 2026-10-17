'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { markNotificationsRead } from '@/app/actions'

/**
 * Marks notifications read once they are on screen. Done from the browser, not
 * while rendering, so prefetching the page does not count as reading it. The
 * page keeps showing which ones were new until the member moves on.
 */
export function MarkRead({ upTo }: { upTo: string }) {
  const router = useRouter()
  useEffect(() => {
    // Refresh the shared navigation too, so its badge doesn't reappear with an old count.
    void markNotificationsRead(upTo).then(() => router.refresh())
  }, [upTo, router])
  return null
}
