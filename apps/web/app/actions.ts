'use server'

import { refresh } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { api } from '@/lib/api'
import { INVITE_COOKIE } from '@/lib/invite'
import { startFlowUrl } from '@/lib/kratos'

// The API is the authority on who is signed in and what they may do; these
// functions only relay the visitor's own session cookie to it.

export type ComposeState = { error?: string; postedAt?: number }

export async function createPost(_prev: ComposeState, formData: FormData): Promise<ComposeState> {
  const text = String(formData.get('text') ?? '')
  const replyTo = String(formData.get('replyTo') ?? '') || undefined
  const community = String(formData.get('community') ?? '') || undefined
  const res = await api('/v1/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, replyTo, community }),
  })

  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You are posting very fast. Wait a minute and try again.' }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { code?: string }
    if (body.code === 'parent_gone') return { error: 'The post you are replying to has been deleted.' }
    if (body.code === 'not_a_member') return { error: 'Join that community to post in it.' }
    if (body.code === 'community_gone') return { error: 'That community is no longer available.' }
    return { error: text.trim() ? 'That post is too long. The limit is 300 characters.' : 'Write something first.' }
  }
  if (!res.ok) return { error: 'Could not post. Check your connection and try again.' }

  refresh()
  return { postedAt: Date.now() }
}

export async function deletePost(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const res = await api(`/v1/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (res.status === 401) redirect('/login')
  refresh()
}

/** `on` is the state the member wants, so a double submit cannot flip it back. */
export async function setLike(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/like`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

export async function setBookmark(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/bookmark`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

export async function setMembership(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/communities/${encodeURIComponent(slug)}/membership`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

/** PUT or DELETE a simple on/off relationship with another member. */
async function setRelation(formData: FormData, relation: 'block' | 'mute'): Promise<void> {
  const handle = String(formData.get('handle') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/members/${encodeURIComponent(handle)}/${relation}`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

export async function setBlock(formData: FormData): Promise<void> {
  return setRelation(formData, 'block')
}

export async function setMute(formData: FormData): Promise<void> {
  return setRelation(formData, 'mute')
}

export type FormState = { error?: string; done?: boolean }

export async function submitReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const postId = String(formData.get('postId') ?? '') || undefined
  const handle = String(formData.get('handle') ?? '') || undefined
  const res = await api('/v1/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(postId ? { postId } : { handle }),
      reason: String(formData.get('reason') ?? ''),
      details: String(formData.get('details') ?? ''),
    }),
  })
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You have sent a lot of reports. Please try again later.' }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    return { error: typeof body.message === 'string' && body.message.length < 80 ? `Could not send: ${body.message}.` : 'Choose a reason and try again.' }
  }
  if (!res.ok) return { error: 'Could not send the report. Try again in a moment.' }
  return { done: true }
}

export async function submitAppeal(_prev: FormState, formData: FormData): Promise<FormState> {
  const message = String(formData.get('message') ?? '')
  const res = await api('/v1/appeals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (res.status === 400) return { error: 'Tell us a little more (at least 10 characters).' }
  if (!res.ok) return { error: 'Could not send your appeal. Try again in a moment.' }
  return { done: true }
}

export async function resolveReport(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const res = await api(`/v1/moderation/reports/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The button that was pressed names the decision.
    body: JSON.stringify({ resolution: String(formData.get('resolution') ?? ''), note: String(formData.get('note') ?? '') }),
  })
  if (res.status === 401) redirect('/login')
  refresh()
}

export async function restorePost(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  await api(`/v1/moderation/posts/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  refresh()
}

export async function setFollow(formData: FormData): Promise<void> {
  const handle = String(formData.get('handle') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/members/${encodeURIComponent(handle)}/follow`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

export type JoinState = { error?: string; code?: string }

export async function acceptInvite(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const typed = String(formData.get('code') ?? '').slice(0, 40)
  // Letters and digits only: this value goes into a cookie that Kratos reads raw.
  const code = typed.toUpperCase().replace(/[^0-9A-Z]/g, '')

  const res = await api('/v1/invites/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) return { code: typed, error: 'Could not check that code. Try again in a moment.' }
  if (!((await res.json()) as { usable: boolean }).usable) {
    return { code: typed, error: 'That code is not valid. Check it, or ask whoever invited you for a new one.' }
  }

  ;(await cookies()).set(INVITE_COOKIE, code, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60,
  })
  redirect(startFlowUrl('registration'))
}
