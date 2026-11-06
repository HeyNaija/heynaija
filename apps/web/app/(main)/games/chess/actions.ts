'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { api } from '@/lib/api'

// Chess on Lichess (docs/adr/0018). Plain form actions, so the page works before
// JavaScript loads; a problem comes back as `?notice=<code>`, which the page words.

const CHESS = '/games/chess'

/** The API's error code, or a general one when it sent none (or could not be reached). */
async function codeOf(res: Response | null): Promise<string> {
  if (!res) return 'lichess_unavailable'
  if (res.status === 429) return 'too_many'
  const body = (await res.json().catch(() => null)) as { message?: { code?: string }; code?: string } | null
  return body?.code ?? body?.message?.code ?? 'failed'
}

const call = (path: string, init: RequestInit = {}) => api(`/v1/games/chess${path}`, { cache: 'no-store', ...init }).catch(() => null)

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** Sends the member to Lichess to say yes; they come back to /games/chess/callback. */
export async function connectLichess() {
  const res = await call('/link', { method: 'POST' })
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) redirect(`${CHESS}?notice=${await codeOf(res)}`)
  const { url } = (await res.json()) as { url: string }
  redirect(url)
}

export async function disconnectLichess() {
  const res = await call('/link', { method: 'DELETE' })
  if (res?.status === 401) redirect('/login')
  redirect(res?.ok ? `${CHESS}?notice=unlinked` : `${CHESS}?notice=${await codeOf(res)}`)
}

export async function refreshRatings() {
  const res = await call('/ratings/refresh', { method: 'POST' })
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) redirect(`${CHESS}?notice=${await codeOf(res)}`)
  refresh()
}

export type ChallengeFormState = { error?: string; sentTo?: string }

const CHALLENGE_ERRORS: Record<string, string> = {
  not_linked: 'Connect your Lichess account first.',
  opponent_not_linked: 'You can only challenge members who have connected a Lichess account.',
  not_found: 'There is no member with that handle.',
  self: 'You cannot challenge yourself.',
  duplicate: 'You have already challenged them. Wait for their answer, or cancel it below.',
  invalid: 'Choose one of the time controls offered.',
  too_many: 'You have sent a lot of challenges. Try again later.',
}

/** The challenge form: used with useActionState, so its answer shows beside the form. */
export async function sendChallenge(_: ChallengeFormState, form: FormData): Promise<ChallengeFormState> {
  const handle = String(form.get('handle') ?? '').trim().replace(/^@/, '')
  if (!handle) return { error: 'Who would you like to challenge? Type their handle.' }
  const res = await call(
    '/challenges',
    json({
      handle,
      rated: form.get('rated') === 'rated',
      timeControl: String(form.get('timeControl') ?? ''),
      color: String(form.get('color') ?? 'random'),
      // A public thread in Chess Arena when the game starts: ticked unless the member unticks it.
      openThread: form.get('openThread') === 'on',
    }),
  )
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) {
    const code = await codeOf(res)
    return { error: CHALLENGE_ERRORS[code] ?? 'The challenge could not be sent. Try again in a moment.' }
  }
  refresh()
  return { sentTo: handle }
}

/** Accept, decline or cancel: the challenge id and what to do come from the form. */
export async function answerChallenge(form: FormData) {
  const id = String(form.get('id') ?? '')
  const action = String(form.get('action') ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['accept', 'decline', 'cancel'].includes(action)) redirect(CHESS)
  const res = await call(`/challenges/${id}/${action}`, { method: 'POST' })
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) redirect(`${CHESS}?notice=${await codeOf(res)}#challenge-${id}`)
  if (action === 'accept') {
    // Straight to the game, to play.
    const accepted = (await res.json().catch(() => null)) as { gameId?: string | null } | null
    redirect(accepted?.gameId ? `${CHESS}/games/${accepted.gameId}` : `${CHESS}?notice=accepted#challenge-${id}`)
  }
  redirect(`${CHESS}#challenge-${id}`)
}
