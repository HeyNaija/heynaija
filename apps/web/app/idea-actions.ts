'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { api } from '@/lib/api'
import { ideaIdFrom } from '@/lib/ideas'

// The ideas board's actions. As everywhere, the API decides who may do what;
// these only relay the visitor's own session.

export type IdeaFormState = { error?: string }

/** Sends an idea or a problem, then opens it. A problem carries where it happened, kept private. */
export async function sendIdea(_prev: IdeaFormState, formData: FormData): Promise<IdeaFormState> {
  const field = (name: string) => String(formData.get(name) ?? '').trim()
  const kind = field('kind') === 'problem' ? 'problem' : 'idea'
  const res = await api('/v1/ideas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind,
      title: field('title'),
      details: field('details'),
      ...(kind === 'problem'
        ? {
            page: field('page').slice(0, 500) || undefined,
            browser: field('browser').slice(0, 500) || undefined,
            appVersion: process.env.RELEASE ?? 'development',
          }
        : {}),
    }),
  }).catch(() => null)
  if (!res) return { error: 'Could not send it. Check your connection and try again.' }
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You are posting very fast. Wait a minute and try again.' }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    if (/title/.test(body.message ?? '')) return { error: 'Give it a title of at most 80 characters.' }
    if (/300/.test(body.message ?? '')) return { error: 'The title and details together are longer than 300 characters.' }
    return { error: 'Could not send that. Check the title and details and try again.' }
  }
  if (!res.ok) return { error: 'Could not send it. Try again in a moment.' }
  const { id } = (await res.json()) as { id: string }
  redirect(`/p/${id}`)
}

/** A vote, or taking it back, when JavaScript runs: the button already shows it, so nothing is re-rendered. */
export async function toggleIdeaVote(id: string, on: boolean): Promise<{ ok: boolean }> {
  if (typeof id !== 'string' || id.length > 64) return { ok: false }
  const res = await api(`/v1/ideas/${encodeURIComponent(id)}/vote`, { method: on ? 'PUT' : 'DELETE' })
  if (res.status === 401) redirect('/login')
  return { ok: res.ok }
}

/** The no-JavaScript vote form. `on` is the state the member wants. */
export async function setIdeaVote(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  await toggleIdeaVote(id, formData.get('on') === '1')
  refresh()
}

/** A moderator sets an idea's status, with a public reason and, for a duplicate, its original. */
export async function setIdeaStatus(_prev: IdeaFormState, formData: FormData): Promise<IdeaFormState> {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const reason = String(formData.get('reason') ?? '')
  // Pasted as the original's link or its ID.
  const duplicateOf = status === 'duplicate' ? (ideaIdFrom(String(formData.get('duplicateOf') ?? '')) ?? undefined) : undefined
  const res = await api(`/v1/ideas/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status, reason, duplicateOf }),
  }).catch(() => null)
  if (!res) return { error: 'Could not save it. Check your connection and try again.' }
  if (res.status === 401) redirect('/login')
  if (res.status === 403) return { error: 'Only Building HeyNaija’s moderators can set a status.' }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
    if (body.code === 'bad_duplicate') return { error: `That original will not do: ${body.message}.` }
    if (/why/.test(body.message ?? '')) return { error: 'Not now and Duplicate need a reason, which everyone will see.' }
    if (/duplicate/.test(body.message ?? '')) return { error: 'A duplicate needs a link to the idea it repeats.' }
    return { error: 'Could not save that status.' }
  }
  if (!res.ok) return { error: 'Could not save it. Try again in a moment.' }
  refresh()
  return {}
}
