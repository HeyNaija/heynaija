import { NextResponse } from 'next/server'
import { startAuthUrl } from '@/lib/auth/server'
import { SIGNUP_DRAFT_COOKIE } from '@/lib/invite'

// Invite links look like /join?code=HN-XXXX-XXXX-XXXX, and "Join" buttons all
// over the site point here. Signing up is one page, /signup; this starts it, with
// the code from the link filled in. The code is checked when the form is sent.
export function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code')?.slice(0, 40)
  // A relative Location: request.url can name another host (localhost for 127.0.0.1
  // in development), and Kratos's cookies must stay on the one the browser uses.
  const response = new NextResponse(null, { status: 303, headers: { location: startAuthUrl('registration') } })
  if (code) {
    response.cookies.set(SIGNUP_DRAFT_COOKIE, JSON.stringify({ code }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60,
    })
  }
  return response
}
