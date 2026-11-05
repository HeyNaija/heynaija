'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { api } from '@/lib/api'

// Competitions (docs/adr/0018, phases 5 and 6). Plain form actions, so the pages work
// before JavaScript loads.

const BASE = '/games/competitions'
const ID = /^[0-9a-f-]{36}$/i

const call = (path: string, init: RequestInit = {}) => api(`/v1/games/competitions${path}`, { cache: 'no-store', ...init }).catch(() => null)

async function messageOf(res: Response | null): Promise<string> {
  if (!res) return 'Games did not answer. Try again in a moment.'
  if (res.status === 429) return 'That was a lot in a short time. Try again in a minute.'
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  return typeof body?.message === 'string' ? body.message : 'That did not work. Check the details and try again.'
}

/** A Lagos date and time from a datetime-local field ("2026-11-08T18:00"), as an instant. */
const lagos = (value: FormDataEntryValue | null): string => {
  const v = String(value ?? '')
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+01:00` : ''
}

export type CompetitionFormState = { error?: string }

function body(form: FormData) {
  return {
    name: String(form.get('name') ?? ''),
    game: 'keno',
    format: 'keno_points',
    eligibility: String(form.get('eligibility') ?? 'open'),
    community: String(form.get('community') ?? '') || null,
    invite: String(form.get('invite') ?? '')
      .split(/[\s,]+/)
      .filter(Boolean),
    entryOpensAt: lagos(form.get('entryOpensAt')),
    entryClosesAt: lagos(form.get('entryClosesAt')),
    startsAt: lagos(form.get('startsAt')),
    endsAt: lagos(form.get('endsAt')),
    publish: form.get('publish') === 'yes',
  }
}

/** Makes a competition (or saves changes to one, with `id`), then shows it. */
export async function saveCompetition(_: CompetitionFormState, form: FormData): Promise<CompetitionFormState> {
  const id = String(form.get('id') ?? '')
  const data = body(form)
  if (!data.entryOpensAt || !data.entryClosesAt || !data.startsAt || !data.endsAt) return { error: 'Give every date and time.' }
  const res = await call(ID.test(id) ? `/${id}` : '', {
    method: ID.test(id) ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) return { error: await messageOf(res) }
  const saved = ID.test(id) ? id : ((await res.json()) as { id: string }).id
  redirect(`${BASE}/${saved}`)
}

/** Enter, withdraw, publish or cancel: the competition and what to do come from the form. */
export async function competitionAction(form: FormData) {
  const id = String(form.get('id') ?? '')
  const action = String(form.get('action') ?? '')
  if (!ID.test(id)) redirect(BASE)
  // A Lichess tournament is cancelled through chess, so it ends on Lichess too (phase 6).
  if (action === 'cancel_tournament') {
    const res = await api(`/v1/games/chess/tournaments/${id}/cancel`, { method: 'POST', cache: 'no-store' }).catch(() => null)
    if (res?.status === 401) redirect('/login')
    if (!res?.ok) redirect(`${BASE}/${id}?error=${encodeURIComponent(await messageOf(res))}`)
    const { onLichess } = (await res.json()) as { onLichess: boolean }
    refresh()
    redirect(`${BASE}/${id}${onLichess ? '' : '?notice=lichess_kept'}`)
  }
  const res =
    action === 'enter'
      ? await call(`/${id}/entry`, { method: 'POST' })
      : action === 'withdraw'
        ? await call(`/${id}/entry`, { method: 'DELETE' })
        : action === 'publish' || action === 'cancel'
          ? await call(`/${id}/${action}`, { method: 'POST' })
          : null
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) redirect(`${BASE}/${id}?error=${encodeURIComponent(await messageOf(res))}`)
  refresh()
  redirect(`${BASE}/${id}`)
}
