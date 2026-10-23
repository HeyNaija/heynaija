import { type NextRequest, NextResponse } from 'next/server'
import { api } from '@/lib/api'
import { isLogoutUrl } from '@/lib/auth/server'
import { PUSH_COOKIE } from '@/lib/push'

/**
 * Sign out: stops push notifications to this browser, if it gets them, and tells
 * the API to stop reusing its cached answer for this session (see
 * apps/api/src/auth/kratos.service.ts), then sends the browser on to Kratos,
 * which ends the session and clears the cookie.
 */
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get('to') ?? ''
  // Only the provider's own logout URL is followed (lib/auth/providers/kratos/urls.ts).
  if (!isLogoutUrl(to)) return seeOther('/')

  // While the session still works, so the API knows whose subscription it is.
  // Best effort: the next member to sign in here has it stopped too (app/ui/push-check.tsx).
  const push = request.cookies.get(PUSH_COOKIE)?.value
  if (push) {
    await api(`/v1/push/subscriptions/${encodeURIComponent(push)}`, { method: 'DELETE', cache: 'no-store' }).catch(() => undefined)
  }
  // Best effort: if this fails the cached entry still expires within seconds.
  await api('/v1/logout', { method: 'POST', cache: 'no-store' }).catch(() => undefined)
  const response = seeOther(to)
  if (push) response.cookies.delete(PUSH_COOKIE)
  return response
}

// A relative Location, so the redirect stays on whatever origin the browser used
// (the server's own idea of its URL is the internal one behind nginx).
const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { location: path } })
