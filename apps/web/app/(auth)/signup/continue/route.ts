import { NextResponse } from 'next/server'
import { api } from '@/lib/api'
import { submitRegistration } from '@/lib/auth/server'
import { AGE_COOKIE, AGE_COOKIE_VALUE, INVITE_COOKIE, type InviteProblem, normaliseCode, SIGNUP_DRAFT_COOKIE } from '@/lib/invite'

// The first step of /signup posts here: the invite code and the 18+ box are ours,
// the rest (email and handle, or Google) is Kratos's. The invite is checked now,
// before an email is sent, because Kratos's webhook only checks it again once the
// emailed code comes back (infra/compose/docker-compose.dev.yml). Then the step is
// handed on to Kratos, which sends the browser on to the code or to Google.

const secure = process.env.NODE_ENV === 'production'
const text = (form: FormData, name: string) => String(form.get(name) ?? '').slice(0, 100)

export async function POST(request: Request) {
  const flow = new URL(request.url).searchParams.get('flow') ?? ''
  const form = await request.formData()
  const typed = text(form, 'invite_code').slice(0, 40)
  const code = normaliseCode(typed)
  const adult = form.get('adult') === 'yes'
  const google = form.get('provider') === 'google'
  const signupPage = `/signup?flow=${encodeURIComponent(flow)}`
  // Relative, like the one in ../../join/route.ts: the browser stays on its own host.
  const redirect = (location: string) => new NextResponse(null, { status: 303, headers: { location } })

  // Back to the form, as it was typed, saying what was wrong.
  const back = (problem: InviteProblem) => {
    const response = redirect(`${signupPage}&invite=${problem}`)
    const draft = { code: typed, adult, email: text(form, 'traits.email'), handle: text(form, 'traits.handle') }
    response.cookies.set(SIGNUP_DRAFT_COOKIE, JSON.stringify(draft), { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 10 * 60 })
    return response
  }

  // Accounts are 18+ during the beta (a temporary rule). The API's registration
  // webhook checks this again.
  if (!adult) return back('age')
  const res = await api('/v1/invites/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  }).catch(() => null)
  if (!res?.ok) return back('failed')
  if (!((await res.json()) as { usable: boolean }).usable) return back('invalid')

  // Only what Kratos's own form would have sent: Google (perhaps with the handle
  // chosen after it), or the email and handle with "Email me a code".
  const fields: Record<string, string> = { csrf_token: text(form, 'csrf_token'), ...(google ? { provider: 'google' } : { method: 'code' }) }
  for (const name of ['traits.email', 'traits.handle']) if (text(form, name)) fields[name] = text(form, name)
  const next = await submitRegistration(flow, fields)
  const response = redirect(next.location ?? signupPage)
  // Read by Kratos's webhook once the code comes back, or Google does.
  const options = { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 } as const
  response.cookies.set(INVITE_COOKIE, code, options)
  response.cookies.set(AGE_COOKIE, AGE_COOKIE_VALUE, options)
  response.cookies.set(SIGNUP_DRAFT_COOKIE, JSON.stringify({ code: typed, adult: true }), { ...options, maxAge: 10 * 60 })
  // Kratos's own cookies (CSRF, and the one that carries a Google signup across
  // the trip to Google) go last: response.cookies.set rewrites the header.
  for (const cookie of next.cookies) response.headers.append('set-cookie', cookie)
  return response
}
