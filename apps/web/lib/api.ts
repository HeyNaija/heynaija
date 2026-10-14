import 'server-only'
import { cookies } from 'next/headers'
import { cache } from 'react'

// Server-to-server address of the NestJS API. Browsers never use this; they go
// through the /api rewrite in next.config.ts.
const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

/** The Kratos session cookie (named in infra/kratos/kratos.yml). */
export const SESSION_COOKIE = 'hn_session'

/** `avatar` fields are a path without the size suffix (see app/ui/avatar.tsx), or null. */
export type Me = {
  id: string
  handle: string
  displayName: string | null
  bio: string
  avatar: string | null
  moderates: boolean
}

/** `src` is a path without the size suffix: append `/640.webp` or `/1600.webp`. */
export type PostImage = { src: string; alt: string; width: number; height: number }

export type Post = {
  id: string
  authorId: string
  authorHandle: string
  /** The author's chosen name; show the handle alone when null. */
  authorName: string | null
  authorAvatar: string | null
  text: string
  images: PostImage[]
  createdAt: string
  replyParentId: string | null
  likeCount: number
  replyCount: number
  viewerLiked: boolean
  viewerBookmarked: boolean
  deleted: boolean
  community: { slug: string; name: string } | null
  /** Why the post is in the Following feed; null elsewhere. */
  reason: 'own' | 'following' | 'community' | null
}

export type Feed = { posts: Post[]; cursor: string | null }

export type Thread = { ancestors: Post[]; post: Post; replies: Post[] }

export type Community = {
  id: string
  slug: string
  name: string
  description: string
  memberCount: number
  viewerIsMember: boolean
}

export type CommunityDetail = Community & { rules: string; moderators: string[] }

export type Profile = {
  id: string
  handle: string
  displayName: string | null
  bio: string
  avatar: string | null
  joinedAt: string
  postCount: number
  followerCount: number
  followingCount: number
  isSelf: boolean
  viewerFollows: boolean
  viewerBlocks: boolean
  viewerMutes: boolean
}

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
  // Signed in to Kratos, but the API refuses them: suspended, or never invited.
  | { state: 'blocked'; suspended: boolean }

// The shell, the side rail and the page all ask who is looking; `cache` makes that
// one API call per request instead of three.
export const getViewer = cache(async (): Promise<Viewer> => {
  if (!(await cookies()).has(SESSION_COOKIE)) return { state: 'anonymous' }
  const res = await api('/v1/me')
  if (res.status === 401) return { state: 'anonymous' }
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    return { state: 'blocked', suspended: body.message === 'account_inactive' }
  }
  if (!res.ok) throw new Error(`API /v1/me responded ${res.status}`)
  return { state: 'member', me: await res.json() }
})

async function getPage(path: string, cursor?: string): Promise<Feed> {
  const res = await api(cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path)
  // A mangled cursor in the URL should fall back to the first page, not crash.
  if (res.status === 400 && cursor) return getPage(path)
  if (!res.ok) throw new Error(`API ${path} responded ${res.status}`)
  return res.json()
}

export const getFeed = (cursor?: string) => getPage('/v1/feed', cursor)

/** Null when the visitor is not a signed-in member. */
export async function getFollowingFeed(cursor?: string): Promise<Feed | null> {
  try {
    return await getPage('/v1/feed/following', cursor)
  } catch {
    return null
  }
}

export const getMemberPosts = (handle: string, cursor?: string) =>
  getPage(`/v1/members/${encodeURIComponent(handle)}/posts`, cursor)

async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await api(path)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`API ${path} responded ${res.status}`)
  return res.json()
}

export const getProfile = (handle: string) =>
  getOrNull<Profile>(`/v1/members/${encodeURIComponent(handle)}`)

export const getThread = (id: string) => getOrNull<Thread>(`/v1/posts/${encodeURIComponent(id)}`)

export const getCommunities = cache(async (): Promise<Community[]> => {
  const res = await api('/v1/communities')
  if (!res.ok) throw new Error(`API /v1/communities responded ${res.status}`)
  return res.json()
})

export const getCommunity = (slug: string) =>
  getOrNull<CommunityDetail>(`/v1/communities/${encodeURIComponent(slug)}`)

export const getCommunityPosts = (slug: string, cursor?: string) =>
  getPage(`/v1/communities/${encodeURIComponent(slug)}/posts`, cursor)

export const getBookmarks = (cursor?: string) => getPage('/v1/bookmarks', cursor)

export async function getTrending(): Promise<Post[]> {
  const res = await api('/v1/trending')
  if (!res.ok) throw new Error(`API /v1/trending responded ${res.status}`)
  return res.json()
}

export type SearchResults = {
  members: { handle: string; displayName: string | null; avatar: string | null }[]
  communities: Community[]
  posts: Post[]
}

/** Null when the query is too short or too long to search for. */
export async function search(q: string): Promise<SearchResults | null> {
  const res = await api(`/v1/search?q=${encodeURIComponent(q)}`)
  if (res.status === 400) return null
  if (!res.ok) throw new Error(`API /v1/search responded ${res.status}`)
  return res.json()
}

export type QueueItem = {
  id: string
  reason: string
  details: string
  createdAt: string
  reporterHandle: string
  reportCount: number
  post: { id: string; text: string; images: PostImage[]; authorHandle: string; communityName: string | null } | null
  member: { handle: string; active: boolean } | null
}

export type LogEntry = {
  id: string
  action: string
  note: string
  createdAt: string
  actorHandle: string
  postId: string | null
  memberHandle: string | null
}

/** Null when the viewer is not a moderator. */
export async function getModeration(): Promise<{ queue: QueueItem[]; log: LogEntry[] } | null> {
  const [queue, log] = await Promise.all([api('/v1/moderation/reports'), api('/v1/moderation/log')])
  if (!queue.ok || !log.ok) return null
  return { queue: await queue.json(), log: await log.json() }
}
