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
  const res = await api('/v1/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (res.status === 401) redirect('/login')
  if (res.status === 400) {
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
