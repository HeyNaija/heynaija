import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, featureGate } from './lib/gists-gate'

// Gists and 1:1 calls are dark for anyone not on the list (docs/adr/0017 section 7): with the
// switch off, or signed out, /gists/* and /calls/* must look like a route that does not exist.
// The page itself cannot do that: it streams, so its status is sent as 200 with the
// prerendered shell (its title, its loading text) before it can ask who is looking.
// So this runs first, on /gists and /calls only, and rewrites everyone without
// the matching `features.gists` / `features.calls` to a path that is not there, which renders the root not-found
// page with a 404, the same as any other missing URL. It fails closed: a bad cookie,
// an unreachable or slow API, or an answer that is not a clear yes all look like a missing URL.
const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

export async function proxy(request: NextRequest) {
  // /calls/* needs features.calls, /gists/* needs features.gists (docs/adr/0017 section 7).
  const feature = request.nextUrl.pathname.startsWith('/calls') ? 'calls' : 'gists'
  const verdict = await featureGate(feature, request.cookies.get(SESSION_COOKIE)?.value, (cookie) =>
    fetch(`${API_URL}/v1/me`, { headers: { cookie }, cache: 'no-store', signal: AbortSignal.timeout(2000) }),
  )
  if (verdict === 'allow') return NextResponse.next()
  return NextResponse.rewrite(new URL('/__not-found', request.url))
}

export const config = { matcher: ['/gists/:path*', '/calls/:path*'] }
