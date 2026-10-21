/**
 * The cookie holding this browser's push subscription ID, so that signing out
 * can stop it (app/logout/route.ts). The browser keeps its subscription; the
 * server stops sending to it.
 */
export const PUSH_COOKIE = 'hn_push'

/** Whether push notifications can be turned on in a browser, or what stands in the way. */
export type PushSupport = 'supported' | 'install' | 'unsupported'

/**
 * iPhones and iPads have push only in a web app added to the Home Screen and
 * opened from there (iOS 16.4 and later); in a Safari tab it does not exist.
 * An iPad says it is a Mac, and gives itself away by its touch screen.
 */
export function pushSupport(device: { userAgent: string; maxTouchPoints: number; standalone: boolean; hasPush: boolean }): PushSupport {
  const apple = /iPhone|iPad|iPod/.test(device.userAgent) || (/Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1)
  if (apple && !device.standalone) return 'install'
  return device.hasPush ? 'supported' : 'unsupported'
}

/** A base64url key as the bytes `pushManager.subscribe` takes. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** Whether a subscription was made with this key; one made with an old key cannot be sent to. */
export function madeWithKey(subscriptionKey: ArrayBuffer | null, key: string): boolean {
  if (!subscriptionKey) return false
  const a = new Uint8Array(subscriptionKey)
  const b = keyBytes(key)
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}
