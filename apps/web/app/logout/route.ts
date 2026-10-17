import { type NextRequest, NextResponse } from 'next/server'
import { api } from '@/lib/api'

// Only Kratos's own logout URL (with its one-time token) is followed, so this
// cannot be used as an open redirect, and a forged link without the token signs
// nobody out.
const KRATOS_LOGOUT = '/kratos/self-service/logout?'

/**
 * Sign out: tells the API to stop reusing its cached answer for this session
 * (see apps/api/src/auth/kratos.service.ts), then sends the browser on to Kratos,
 * which ends the session and clears the cookie.
 */
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get('to') ?? ''
  if (!to.startsWith(KRATOS_LOGOUT)) return seeOther('/')

  // Best effort: if this fails the cached entry still expires within seconds.
  await api('/v1/logout', { method: 'POST', cache: 'no-store' }).catch(() => undefined)
  return seeOther(to)
}

// A relative Location, so the redirect stays on whatever origin the browser used
// (the server's own idea of its URL is the internal one behind nginx).
const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { location: path } })
