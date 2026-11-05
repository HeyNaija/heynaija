'use server'

import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { api } from '@/lib/api'
import { RETURN_COOKIE } from '@/lib/lichess-return'

// A community's Lichess team and its tournaments (docs/adr/0018, phase 6). Plain
// form actions, so the page works before JavaScript loads; a problem comes back
// as `?error=<message>`.

const SLUG = /^[a-z0-9-]{1,60}$/
const pageOf = (slug: string) => `/games/chess/teams/${slug}`

const call = (path: string, init: RequestInit = {}) => api(`/v1/games/chess${path}`, { cache: 'no-store', ...init }).catch(() => null)

async function messageOf(res: Response | null): Promise<string> {
  if (!res) return 'Games did not answer. Try again in a moment.'
  if (res.status === 429) return 'That was a lot in a short time. Try again later.'
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  return typeof body?.message === 'string' ? body.message : 'That did not work. Check the details and try again.'
}

const slugOf = (form: FormData): string => {
  const slug = String(form.get('slug') ?? '')
  if (!SLUG.test(slug)) redirect('/games/chess')
  return slug
}

async function settle(slug: string, res: Response | null, done = '') {
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) redirect(`${pageOf(slug)}?error=${encodeURIComponent(await messageOf(res))}`)
  refresh()
  redirect(`${pageOf(slug)}${done}`)
}

export async function linkTeam(form: FormData) {
  const slug = slugOf(form)
  const team = String(form.get('team') ?? '').slice(0, 200)
  await settle(slug, await call(`/teams/${slug}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team }) }), '?notice=team_linked')
}

export async function unlinkTeam(form: FormData) {
  const slug = slugOf(form)
  await settle(slug, await call(`/teams/${slug}`, { method: 'DELETE' }), '?notice=team_unlinked')
}

/** Sends the moderator to Lichess to allow tournaments (and connect, if they have not); they come back here. */
export async function allowTournaments(form: FormData) {
  const slug = slugOf(form)
  const res = await call('/link?scope=tournaments', { method: 'POST' })
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) redirect(`${pageOf(slug)}?error=${encodeURIComponent(await messageOf(res))}`)
  const { url } = (await res.json()) as { url: string }
  ;(await cookies()).set(RETURN_COOKIE, pageOf(slug), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/games/chess', maxAge: 600 })
  redirect(url)
}

export type TournamentFormState = { error?: string }

/** A Lagos date and time from a datetime-local field, as an instant. */
const lagos = (value: FormDataEntryValue | null): string => {
  const v = String(value ?? '')
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+01:00` : ''
}

export async function createTournament(_: TournamentFormState, form: FormData): Promise<TournamentFormState> {
  const slug = slugOf(form)
  const kind = form.get('kind') === 'swiss' ? 'swiss' : 'arena'
  const startsAt = lagos(form.get('startsAt'))
  if (!startsAt) return { error: 'Give the date and time it starts.' }
  const res = await call(`/teams/${slug}/tournaments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: String(form.get('name') ?? ''),
      kind,
      timeControl: String(form.get('timeControl') ?? ''),
      rated: form.get('rated') === 'yes',
      startsAt,
      ...(kind === 'arena' ? { minutes: Number(form.get('minutes')) } : { rounds: Number(form.get('rounds')) }),
    }),
  })
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) return { error: await messageOf(res) }
  const { id } = (await res.json()) as { id: string }
  redirect(`/games/competitions/${id}`)
}
