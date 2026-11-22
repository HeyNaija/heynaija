import type { ToastInput, ToastKind } from './toasts.ts'
import { isUuid } from './uuid.ts'

/**
 * A message for the next page a member sees, set by a server action and shown
 * once as a toast. The cookie holds the name of a message in this list and a
 * random id, never words of its own: nothing personal travels in it, and a
 * planted cookie cannot make the site say something it did not write.
 */
export const FLASH_COOKIE = 'hn_flash'
/** Seconds. The next page reads it straight away; this only bounds a cookie nobody read. */
export const FLASH_MAX_AGE = 30

export const FLASH_MESSAGES = {
  post_deleted: { kind: 'success', message: 'Post deleted' },
  blocked: { kind: 'success', message: 'Blocked. You will no longer see each other’s posts.' },
  pinned_to_profile: { kind: 'success', message: 'Pinned to your profile' },
  unpinned_from_profile: { kind: 'success', message: 'Unpinned from your profile' },
  pinned_in_community: { kind: 'success', message: 'Pinned in the community' },
  unpinned_in_community: { kind: 'success', message: 'Unpinned in the community' },
  action_failed: { kind: 'error', message: 'That did not work. Try again in a moment.' },
} as const satisfies Record<string, { kind: ToastKind; message: string }>

export type FlashKey = keyof typeof FLASH_MESSAGES

export function encodeFlash(key: FlashKey, id: string): string {
  return `${key}.${id}`
}

export function decodeFlash(value: string | undefined): ToastInput | null {
  if (!value) return null
  const dot = value.indexOf('.')
  const key = value.slice(0, dot)
  const id = value.slice(dot + 1)
  if (dot === -1 || !Object.hasOwn(FLASH_MESSAGES, key) || !isUuid(id)) return null
  return { id, ...FLASH_MESSAGES[key as FlashKey] }
}
