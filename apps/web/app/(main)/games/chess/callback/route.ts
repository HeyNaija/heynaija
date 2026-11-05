import { type NextRequest, NextResponse } from 'next/server'
import { api } from '@/lib/api'
import { RETURN_COOKIE, returnPath } from '@/lib/lichess-return'

/**
 * Where Lichess sends a member back after they say yes (or no) to linking their
 * account (docs/adr/0018). The code and state go to the API with the member's
 * session, which checks the state was theirs and fresh, and swaps the code for a
 * token; the browser never sees the token. proxy.ts has already turned away
 * anyone without Games.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  // A moderator who came to allow tournaments goes back to their community's chess page.
  const back = returnPath(request.cookies.get(RETURN_COOKIE)?.value) ?? '/games/chess'
  const seeOther = (path: string) => {
    const res = new NextResponse(null, { status: 303, headers: { location: path.replace(/^\/games\/chess(?=\?|$)/, back) } })
    res.cookies.delete({ name: RETURN_COOKIE, path: '/games/chess' })
    return res
  }
  const code = params.get('code')
  const state = params.get('state')
  // They said no on Lichess, or arrived here some other way.
  if (params.get('error') || !code || !state) return seeOther(`/games/chess?notice=${params.get('error') === 'access_denied' ? 'link_declined' : 'link_expired'}`)

  const res = await api('/v1/games/chess/link/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.slice(0, 500), state: state.slice(0, 200) }),
    cache: 'no-store',
  }).catch(() => null)
  if (res?.status === 401) return seeOther('/login')
  if (res?.ok) return seeOther('/games/chess?notice=linked')
  const body = (await res?.json().catch(() => null)) as { code?: string } | null
  return seeOther(`/games/chess?notice=${body?.code ?? (res?.status === 429 ? 'too_many' : 'link_failed')}`)
}

// seeOther answers with a relative Location, so the redirect stays on whatever
// origin the browser used (the server's own idea of its URL is the internal one behind nginx).
