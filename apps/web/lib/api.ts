import 'server-only'
import { cookies } from 'next/headers'

// Server-to-server address of the NestJS API. Browsers never use this; they go
// through the /api rewrite in next.config.ts.
const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

/** The Kratos session cookie (named in infra/kratos/kratos.yml). */
export const SESSION_COOKIE = 'hn_session'

export type Me = { id: string; handle: string }

export type Post = {
  id: string
  authorId: string
  authorHandle: string
  text: string
  createdAt: string
}

export type Feed = { posts: Post[]; cursor: string | null }

/** Calls the API as the signed-in member by forwarding only the session cookie. */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}),
    },
  })
}

export type Viewer =
  | { state: 'anonymous' }
  | { state: 'member'; me: Me }
  // Signed in to Kratos, but the API refuses them (no invite, or suspended).
  | { state: 'blocked' }

export async function getViewer(): Promise<Viewer> {
  if (!(await cookies()).has(SESSION_COOKIE)) return { state: 'anonymous' }
  const res = await api('/v1/me')
  if (res.status === 401) return { state: 'anonymous' }
  if (res.status === 403) return { state: 'blocked' }
  if (!res.ok) throw new Error(`API /v1/me responded ${res.status}`)
  return { state: 'member', me: await res.json() }
}

export async function getFeed(cursor?: string): Promise<Feed> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const res = await api(`/v1/feed${query}`)
  // A mangled cursor in the URL should fall back to the top of the feed, not crash.
  if (res.status === 400 && cursor) return getFeed()
  if (!res.ok) throw new Error(`API /v1/feed responded ${res.status}`)
  return res.json()
}
