import { NextResponse } from 'next/server'
import { submitRegistration } from '@/lib/auth/server'

// "Continue with Google" on /signup posts here, with the handle typed above it.
// Kratos gets the handle and nothing else from the form: the email field is
// left behind, so the account takes the address Google confirms. Kratos keeps
// the handle across the trip to Google, and the account is made when Google
// sends the member back, without asking for anything again.

// The identity schema's rule for handles (infra/kratos/identity.schema.json).
const HANDLE = /^[a-z0-9_]{3,20}$/

export async function POST(request: Request) {
  const flow = new URL(request.url).searchParams.get('flow') ?? ''
  const form = await request.formData()
  const handle = String(form.get('traits.handle') ?? '').trim()
  // Relative, so the browser stays on the host it is using (request.url names
  // localhost for 127.0.0.1 in development, and Kratos's cookies are per host).
  const redirect = (location: string) => new NextResponse(null, { status: 303, headers: { location } })

  // The browser checks this before sending; without that, back to the form.
  if (!HANDLE.test(handle)) return redirect(`/signup?flow=${encodeURIComponent(flow)}`)

  const next = await submitRegistration(flow, {
    csrf_token: String(form.get('csrf_token') ?? ''),
    provider: 'google',
    'traits.handle': handle,
  })
  const response = redirect(next.location ?? `/signup?flow=${encodeURIComponent(flow)}`)
  // Kratos's cookies, among them the one that carries the signup across the trip to Google.
  for (const cookie of next.cookies) response.headers.append('set-cookie', cookie)
  return response
}
