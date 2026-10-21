'use client'

import { useEffect } from 'react'
import { checkPushSubscription } from '@/app/actions'

const CHECKED = 'hn-push-checked'

/**
 * Makes sure this browser is not pushing someone else's notifications. Signing
 * out stops them, but a session that simply runs out does not, and then the next
 * member to sign in here would see them. So once per tab, for each member, a
 * browser that has a push subscription asks the API whose it is; if it is not
 * the signed-in member's, the API stops it.
 */
export function PushCheck({ memberId }: { memberId: string }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return
    try {
      if (sessionStorage.getItem(CHECKED) === memberId) return
    } catch {
      // No session storage (a private window, say): check on every page load instead.
    }
    void (async () => {
      const subscription = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription()
      if (subscription) await checkPushSubscription(subscription.endpoint)
      try {
        sessionStorage.setItem(CHECKED, memberId)
      } catch {}
    })().catch(() => undefined)
  }, [memberId])
  return null
}
