import { type NextRequest, NextResponse } from 'next/server'
import { clearsFlash, FLASH_COOKIE, shownFlashId } from '@/lib/flash'

/**
 * The browser says it has shown flash `id`, so it is forgotten and no later page
 * shows it again. JavaScript cannot clear the cookie itself: it is httpOnly. Only
 * the flash that was shown is cleared, so a newer one set meanwhile is kept.
 * Nothing here is worth forging: the most another site could do is make a member
 * miss one "Post deleted".
 */
export async function POST(request: NextRequest) {
  const id = await shownFlashId(request.body, request.headers.get('content-length'))
  const response = new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  if (clearsFlash(request.cookies.get(FLASH_COOKIE)?.value, id)) response.cookies.delete(FLASH_COOKIE)
  return response
}
