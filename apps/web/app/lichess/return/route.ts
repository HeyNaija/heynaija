import { type NextRequest, NextResponse } from 'next/server'

/** The apps' own address for Lichess's answer (heynaija-mobile, games/chess/Lichess.kt). */
const APP_RETURN = 'ng.heynaija.app://lichess/return'

/**
 * Where Lichess sends a member back after they say yes (or no) to linking their
 * account from one of the apps (docs/adr/0028). Nothing is finished here: the
 * phone's browser has no HeyNaija session. The code and state go on to the app,
 * which finishes the link with its own session. The code is no use to anything
 * else that catches it: the PKCE verifier never leaves the API, and the attempt is
 * bound to the member who started it. Outside /games, so the Games gate in proxy.ts
 * (which needs a session) does not turn the browser away.
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const back = new URLSearchParams()
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  if (code && state) {
    back.set('code', code.slice(0, 500))
    back.set('state', state.slice(0, 200))
  } else {
    // They said no on Lichess (access_denied), or arrived here some other way.
    back.set('error', error === 'access_denied' ? 'access_denied' : 'invalid_request')
  }
  return new NextResponse(null, { status: 303, headers: { location: `${APP_RETURN}?${back}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}
