import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Spaces are dark for anyone not on the list (docs/adr/0017 section 7): with the
// switch off, or signed out, /spaces/* must look like a route that does not exist.
// The page itself cannot do that: it streams, so its status is sent as 200 with the
// prerendered shell (its title, its loading text) before it can ask who is looking.
// So this runs first, on /spaces only, and rewrites everyone without
// `features.spaces` to a path that is not there, which renders the root not-found
// page with a 404, the same as any other missing URL.
const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'
const SESSION_COOKIE = 'hn_session'

export async function proxy(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value
  let allowed = false
  if (session) {
    try {
      const res = await fetch(`${API_URL}/v1/me`, { headers: { cookie: `${SESSION_COOKIE}=${session}` }, cache: 'no-store' })
      if (res.ok) allowed = ((await res.json()) as { features?: { spaces?: boolean } }).features?.spaces === true
    } catch {
      // The API is unreachable: let the page run and fail the way every page does.
      return NextResponse.next()
    }
  }
  if (allowed) return NextResponse.next()
  return NextResponse.rewrite(new URL('/__not-found', request.url))
}

export const config = { matcher: '/spaces/:path*' }
