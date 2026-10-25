// Push in the browser this runs in: whether it is on, and turning it on and off.
// Shared by Settings (push-switch.tsx), the welcome flow and the home page's card
// in the installed app, so all three agree. Browser-only: call from effects and
// event handlers.
import { checkPushSubscription, subscribeToPush, unsubscribeFromPush } from '@/app/actions'
import { keyBytes, madeWithKey, pushSupport } from '@/lib/push'

/** Where push stands in this browser, for the member signed in. */
export type PushState = 'unsupported' | 'install' | 'blocked' | 'off' | 'on'

const CONNECTION = 'Check your connection and try again.'

/** Whether HeyNaija is open as an installed app (from the Home Screen or the app list) rather than in a tab. */
export function isInstalledApp(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export async function readPushState(publicKey: string): Promise<PushState> {
  const support = pushSupport({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: isInstalledApp(),
    hasPush: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  })
  if (support !== 'supported') return support
  if (Notification.permission === 'denied') return 'blocked'
  try {
    const subscription = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription()
    // One made with a key the server no longer has is as good as none: turning push on replaces it.
    const usable = subscription && madeWithKey(subscription.options.applicationServerKey, publicKey) ? subscription : null
    const on = Notification.permission === 'granted' && usable ? (await checkPushSubscription(usable.endpoint)).subscribed : false
    return on ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/**
 * Asks the browser for permission, subscribes, and tells the API. Call it straight
 * from a tap: browsers only ask in answer to one.
 */
export async function turnOnPush(publicKey: string): Promise<{ state: PushState; error?: string }> {
  try {
    // First, while the tap still counts.
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { state: permission === 'denied' ? 'blocked' : 'off' }
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
    return result.error ? { state: 'off', error: result.error } : { state: 'on' }
  } catch (error) {
    // The device itself said no after the browser said yes (Safari's push service can, for one).
    if ((error as Error)?.name === 'NotAllowedError') {
      return { state: 'off', error: 'This device did not let HeyNaija send notifications. Check that they are allowed for HeyNaija in the device’s settings, then try again.' }
    }
    return { state: 'off', error: `Could not turn on push notifications in this browser. ${CONNECTION}` }
  }
}

export async function turnOffPush(): Promise<{ state: PushState; error?: string }> {
  try {
    const subscription = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription()
    if (subscription) {
      const result = await unsubscribeFromPush(subscription.endpoint)
      if (result.error) return { state: 'on', error: result.error }
      await subscription.unsubscribe()
    }
    return { state: 'off' }
  } catch {
    return { state: 'on', error: `Could not turn off push notifications. ${CONNECTION}` }
  }
}
