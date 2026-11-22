import 'server-only'
import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { encodeFlash, FLASH_COOKIE, FLASH_MAX_AGE, type FlashKey } from './flash'

/**
 * From a server action: says `key`'s message as a toast on the page the member
 * sees next, whether the action refreshes this one or redirects to another.
 * Setting a cookie in an action makes Next render the layouts again, which is
 * where it is read (`app/ui/flash-toast.tsx`).
 */
export async function flash(key: FlashKey): Promise<void> {
  ;(await cookies()).set(FLASH_COOKIE, encodeFlash(key, randomUUID()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: FLASH_MAX_AGE,
  })
}
