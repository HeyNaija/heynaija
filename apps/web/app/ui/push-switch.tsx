'use client'

import { useEffect, useState } from 'react'
import { checkPushSubscription, subscribeToPush, unsubscribeFromPush } from '@/app/actions'
import { keyBytes, madeWithKey, pushSupport } from '@/lib/push'

type State = 'checking' | 'unsupported' | 'install' | 'blocked' | 'off' | 'on'

const CONNECTION = 'Check your connection and try again.'

/**
 * Turns push notifications on or off for the browser it is open in. Push belongs
 * to a browser, not an account, so this is a button that acts at once rather than
 * a box in the form below. Needs JavaScript, as push itself does.
 */
export function PushSwitch({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>('checking')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    const show = (next: State) => live && setState(next)
    const support = pushSupport({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone: matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
      hasPush: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    })
    if (support !== 'supported') return void show(support)
    if (Notification.permission === 'denied') return void show('blocked')
    void (async () => {
      const subscription = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription()
      // One made with a key the server no longer has is as good as none: turning push on replaces it.
      const usable = subscription && madeWithKey(subscription.options.applicationServerKey, publicKey) ? subscription : null
      const on = Notification.permission === 'granted' && usable ? (await checkPushSubscription(usable.endpoint)).subscribed : false
      show(on ? 'on' : 'off')
    })().catch(() => show('off'))
    return () => {
      live = false
    }
  }, [publicKey])

  async function turnOn() {
    setPending(true)
    setError('')
    try {
      // First, while the tap still counts: browsers only ask in answer to one.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return setState(permission === 'denied' ? 'blocked' : 'off')
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      // Made with a key the server no longer has, so nothing could reach it.
      if (subscription && !madeWithKey(subscription.options.applicationServerKey, publicKey)) {
        await subscription.unsubscribe()
        subscription = null
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
      const { keys } = subscription.toJSON()
      const result = await subscribeToPush({ endpoint: subscription.endpoint, keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' } })
      if (result.error) return setError(result.error)
      setState('on')
    } catch {
      setError(`Could not turn on push notifications in this browser. ${CONNECTION}`)
    } finally {
      setPending(false)
    }
  }

  async function turnOff() {
    setPending(true)
    setError('')
    try {
      const subscription = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription()
      if (subscription) {
        const result = await unsubscribeFromPush(subscription.endpoint)
        if (result.error) return setError(result.error)
        await subscription.unsubscribe()
      }
      setState('off')
    } catch {
      setError(`Could not turn off push notifications. ${CONNECTION}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div role="group" aria-labelledby="push-label" aria-describedby="push-hint" className="flex flex-col gap-2">
      <p id="push-label" className="field-label">Push notifications</p>
      {state === 'checking' ? <p className="text-sm text-muted">Checking this browser…</p> : null}
      {state === 'off' || state === 'on' ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={state === 'on' ? turnOff : turnOn}
            className={state === 'on' ? 'btn btn-secondary' : 'btn btn-primary'}
          >
            {pending ? (state === 'on' ? 'Turning off…' : 'Turning on…') : state === 'on' ? 'Turn off on this device' : 'Turn on push notifications'}
          </button>
          {/* A live region, not role="status": the form below has the section's status. */}
          <p aria-live="polite" className="text-sm text-muted">
            {state === 'on' ? 'On for this device.' : ''}
          </p>
        </div>
      ) : null}
      {state === 'blocked' ? (
        <p className="notice">
          Notifications from HeyNaija are blocked in this browser. Allow them in the browser’s settings for this site, then reload this page.
        </p>
      ) : null}
      {state === 'install' ? (
        <p className="notice">
          On an iPhone or iPad, add HeyNaija to your Home Screen first: tap Share, then Add to Home Screen. Open HeyNaija from
          there and come back to Settings.
        </p>
      ) : null}
      {state === 'unsupported' ? (
        <p className="notice">This browser cannot show push notifications. You will still see everything in HeyNaija.</p>
      ) : null}
      <p id="push-hint" className="field-hint">
        Get your notifications on this device as they happen, even when HeyNaija is closed. Only the account signed in here
        gets them, and signing out stops them. Anything you get as a push notification is not emailed as well.
      </p>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>
    </div>
  )
}
