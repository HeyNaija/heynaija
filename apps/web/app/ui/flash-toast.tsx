'use client'

import { useEffect } from 'react'
import type { ToastInput } from '@/lib/toasts'
import { useToast } from './toasts'

/**
 * Shows the flash the server found in this request's cookie, then tells the
 * server to forget it. A toast is known by the flash's id, so a page rendered
 * again before the cookie is gone does not say it twice.
 */
export function FlashToast({ id, kind, message }: ToastInput) {
  const { show } = useToast()
  useEffect(() => {
    show({ id, kind, message })
    // Best effort: unread, the cookie expires within the minute anyway.
    void fetch('/flash', { method: 'POST', body: id, keepalive: true }).catch(() => undefined)
  }, [id, kind, message, show])
  return null
}
