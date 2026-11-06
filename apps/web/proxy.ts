import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { gamesGate } from './lib/games-gate'
import { SESSION_COOKIE, gistReturnPath, gistsGate } from './lib/gists-gate'

// Gists are dark for anyone not on the list (docs/adr/0017 section 4a): with the
// switch off, or for a member without `features.gists`, /gists/* must look like a
// route that does not exist. The page itself cannot do that: it streams, so its
// status is sent as 200 with the prerendered shell (its title, its loading text)
// before it can ask who is looking. So this runs first, on /gists only, and rewrites
// them to a path that is not there, which renders the root not-found page with a
// 404, the same as any other missing URL. It fails closed: a bad answer, an
// unreachable or slow API, or an answer that is not a clear yes all look like a missing URL.
//
// Someone signed out while Gists are on is asked to sign in instead, at the same
// address, so a member who opens a shared link can come back to it; after signing
// in they get the Gist or the missing page like anyone else.
const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

const ask = (path: string, headers: HeadersInit = {}) =>
  fetch(`${API_URL}${path}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(2000) })

// Games (docs/adr/0018) is dark the same way, for /games/*, except that a visitor
// with no session always gets the missing page: Games is for members on its list.

export async function proxy(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value
  if (request.nextUrl.pathname === '/games' || request.nextUrl.pathname.startsWith('/games/')) {
    const verdict = await gamesGate(session, (cookie) => ask('/v1/me', { cookie }))
    return verdict === 'allow' ? NextResponse.next() : NextResponse.rewrite(new URL('/__not-found', request.url))
  }
  const verdict = await gistsGate(
    session,
    (cookie) => ask('/v1/me', { cookie }),
    async () => {
      // Only the status matters; the body is let go so the connection can be reused.
      const res = await ask('/v1/gists/live')
      await res.body?.cancel()
      return res
    },
  )
  if (verdict === 'allow') return NextResponse.next()
  const to = gistReturnPath(request.nextUrl.pathname)
  if (verdict === 'sign-in' && to) {
    const prompt = new URL('/gist-sign-in', request.url)
    prompt.search = new URLSearchParams({ to }).toString()
    return NextResponse.rewrite(prompt)
  }
  return NextResponse.rewrite(new URL('/__not-found', request.url))
}

// Not the prompt's own path: a rewrite target that matches runs this again.
export const config = { matcher: ['/gists/:path*', '/games/:path*'] }
