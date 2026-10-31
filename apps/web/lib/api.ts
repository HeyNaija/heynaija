import 'server-only'
import { headers } from 'next/headers'
import { cache } from 'react'
import { getApiAuthHeaders, hasSessionCredentials } from './auth/server'
import type { GistView } from './gists'
import type { NotificationPreferences } from './notification-preferences'
import type { ReplyAudience } from './reply-audience'
import type { ReplyContext } from './reply-context'
import type { ReplyOrder } from './thread-state'

// Server-to-server address of the NestJS API. Browsers never use this; they go
// through the /api rewrite in next.config.ts.
const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

/** `avatar` fields are a path without the size suffix (see app/ui/avatar.tsx), or null. */
export type Me = {
  id: string
  handle: string
  displayName: string | null
  bio: string
  avatar: string | null
  /** Shown as a badge on the Notifications link. */
  unreadNotifications: number
  moderates: boolean
  /** False until they finish or skip the welcome flow, which the home page sends them to. */
  onboarded: boolean
  /** Switches the API turns on for this member (docs/adr/0017). All false when a feature is off or they are not on its list. */
  features: { gists: boolean }
}

/** `src` is a path without the size suffix: append `/640.webp` or `/1600.webp`. */
export type PostImage = {
  src: string
  alt: string
  width: number
  height: number
  /** A GIF: `/640.webp` and `/1600.webp` move, and `/still.webp` is its first frame. */
  animated: boolean
}

/** The post a quote post quotes, or a placeholder when the reader cannot see it. */
export type QuotedPost =
  | {
      unavailable?: false
      id: string
      authorId: string
      authorHandle: string
      authorName: string | null
      authorAvatar: string | null
      authorFounder: boolean
      text: string
      images: PostImage[]
      createdAt: string
      replyParentId: string | null
    }
  | { unavailable: true }

/**
 * An @handle in a post's text that leads to a member: where it is (in UTF-16
 * code units, as `String.prototype.slice` counts) and the handle they have now,
 * which differs from the text if they have renamed since.
 */
export type PostMention = { start: number; length: number; handle: string }

/**
 * A #hashtag in the text: where it is (UTF-16 code units) and the topic it is,
 * the key every spelling shares (lower case).
 */
export type PostHashtag = { start: number; length: number; tag: string }

/** A web address in the text: where it is (UTF-16 code units) and where it leads. Always http or https. */
export type PostLink = { start: number; length: number; url: string }
export type { ReplyAudience }

export type Poll = {
  multiple: boolean
  expiresAt: string | null
  closed: boolean
  totalVotes: number
  viewerVoted: boolean
  options: { id: string; text: string; position: number; voteCount: number; viewerVoted: boolean }[]
}

/** What the first web address in a post leads to, read by the server. */
export type LinkPreview = {
  url: string
  title: string
  description: string | null
  siteName: string | null
  /** A copy kept on our servers: append `/640.webp`. */
  image: { src: string; width: number; height: number } | null
}

export type Post = {
  unavailable?: false
  id: string
  authorId: string
  authorHandle: string
  /** The author's chosen name; show the handle alone when null. */
  authorName: string | null
  authorAvatar: string | null
  /** The author has the Founder badge: one of the people who founded HeyNaija. */
  authorFounder: boolean
  text: string
  images: PostImage[]
  /** Mentions of members the viewer can see, in order. Other @text stays plain. */
  mentions: PostMention[]
  /** Hashtags in the text, in order. */
  hashtags: PostHashtag[]
  /** Web addresses in the text, in order. */
  links: PostLink[]
  /** The card for the first address, once the server has read the page. */
  linkPreview: LinkPreview | null
  createdAt: string
  replyParentId: string | null
  replyAudience: ReplyAudience
  viewerCanReply: boolean
  poll: Poll | null
  /** What a reply answers, in lists: a preview, or a placeholder. Null on other posts and in threads. */
  replyTo?: ReplyContext | null
  likeCount: number
  replyCount: number
  repostCount: number
  /** Thread pages also expose structural continuation through deleted intermediate rows. */
  hasReplies?: boolean
  viewerLiked: boolean
  viewerReposted: boolean
  viewerBookmarked: boolean
  /** Its author keeps it at the top of their profile. */
  pinnedOnProfile: boolean
  /** Its community's moderators keep it at the top of the community. */
  pinnedInCommunity: boolean
  /** The viewer moderates its community and may pin it there (top-level posts only). */
  viewerCanPinInCommunity: boolean
  deleted: boolean
  community: { slug: string; name: string } | null
  /** A quote post's quoted post; null for other posts. */
  quote: QuotedPost | null
  /**
   * Why the post is in the Following feed or Discover, or 'repost' on a profile;
   * null elsewhere. 'network', 'active' and 'recent' are Discover's.
   */
  reason: 'own' | 'following' | 'community' | 'repost' | 'network' | 'active' | 'recent' | null
  /** Who reposted it, when `reason` is 'repost'. */
  repostedBy: { id: string; handle: string; displayName: string | null } | null
  /** In Discover, when `reason` is 'network': who the viewer follows that took part, and how many others did. */
  via?: { id: string; handle: string; displayName: string | null; action: 'replied' | 'quoted' | 'reposted'; others: number }
}

/**
 * A page of posts. The first page of a profile's posts and of a community also
 * has the post pinned above the list (null when none, or none the viewer may see).
 */
export type Feed = { posts: Post[]; cursor: string | null; pinned?: Post | null }

/** The lists on a member's profile: top-level posts, replies, and posts with images. */
export const PROFILE_FILTERS = ['posts', 'replies', 'media'] as const
export type ProfileFilter = (typeof PROFILE_FILTERS)[number]

export type UnavailableReply = {
  unavailable: true
  id: string
  replyParentId: string | null
  createdAt: string
  hasReplies: true
}
export type ThreadReply = Post | UnavailableReply
export type ReplyPage = { replies: ThreadReply[]; cursor: string | null }
export type Thread = {
  ancestors: Post[]
  post: Post
  replies: ThreadReply[]
  replyCursor: string | null
  ancestorsTruncated: boolean
  earlierAncestorId?: string | null
}

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
  /**
   * Show the green "NIN identity verified" tick. Decided by the API from a
   * reviewed, current verification the member chose to show; never inferred here.
   */
  identityBadge: boolean
  /** Show the Founder badge: one of the people who founded HeyNaija, granted by hand. */
  founderBadge: boolean
}

/**
 * Calls the API as the signed-in member by forwarding only the session cookie,
 * and the visitor's address, which nginx sets in X-Real-IP and the API counts
 * signed-out callers' rate limits by. (Requests the browser makes to /api go
 * through the rewrite in next.config.ts, which passes the header on itself.)
 */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const authHeaders = await getApiAuthHeaders()
  const address = (await headers()).get('x-real-ip')
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      ...authHeaders,
      ...(address ? { 'x-real-ip': address } : {}),
    },
  })
}

export type Viewer =
  | { state: 'anonymous' }
  | { state: 'member'; me: Me }
  // Signed in to Kratos, but the API refuses them: suspended, waiting for their
  // account's deletion (`deletion`), or never invited.
  | { state: 'blocked'; suspended: boolean; deletion: { scheduledFor: string } | null }

// The shell, the side rail and the page all ask who is looking; `cache` makes that
// one API call per request instead of three.
export const getViewer = cache(async (): Promise<Viewer> => {
  if (!(await hasSessionCredentials())) return { state: 'anonymous' }
  const res = await api('/v1/me')
  if (res.status === 401) return { state: 'anonymous' }
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    if (body.message !== 'account_inactive') return { state: 'blocked', suspended: false, deletion: null }
    // Inactive: suspended, or waiting for deletion, which is what they need to know first.
    // Not finding out is no reason to tell them they are suspended.
    const deletion = await getAccountDeletion()
    if (!deletion) throw new Error('API /v1/me/deletion did not answer')
    return deletion.state === 'scheduled'
      ? { state: 'blocked', suspended: false, deletion: { scheduledFor: deletion.scheduledFor } }
      : { state: 'blocked', suspended: true, deletion: null }
  }
  if (!res.ok) throw new Error(`API /v1/me responded ${res.status}`)
  return { state: 'member', me: await res.json() }
})

async function getPage(path: string, cursor?: string): Promise<Feed> {
  const res = await api(cursor ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : path)
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

/** The rules Discover ranks by, as the API applies them (ADR 0014). */
export type DiscoverRules = {
  windowHours: number
  startingPoints: number
  conversationPoints: number
  likePoints: number
  repostPoints: number
  followedPoints: number
  followsAuthorPoints: number
  joinedCommunityPoints: number
  ageOffsetHours: number
  gravity: number
  authorDecay: number
  maxPosts: number
  reportsToHold: number
  ownPostsMinutes: number
  visitorRefreshSeconds: number
}

/** A page of Discover, ranked as of `asOf`. */
export type DiscoverFeed = Feed & { asOf: string; rules: DiscoverRules }

/**
 * A page of Discover. A first page asks to be ranked as of `at`, the moment the
 * reader opened it, so loading it again does not reorder it. Visitors who are not
 * signed in get the ranking every visitor gets. Null when it cannot be had.
 */
export async function getDiscoverFeed(cursor?: string, at?: string): Promise<DiscoverFeed | null> {
  try {
    return (await getPage(at && !cursor ? `/v1/feed/discover?at=${encodeURIComponent(at)}` : '/v1/feed/discover', cursor)) as DiscoverFeed
  } catch {
    return null
  }
}

export async function getDiscoverRules(): Promise<DiscoverRules> {
  const res = await api('/v1/feed/discover/rules')
  if (!res.ok) throw new Error(`API /v1/feed/discover/rules responded ${res.status}`)
  return res.json()
}

export type IdeaKind = 'idea' | 'problem'
export type IdeaStatus = 'under_review' | 'planned' | 'in_progress' | 'shipped' | 'not_now' | 'duplicate'
export type IdeaGroup = 'open' | 'shipped' | 'closed'

/** An idea or problem on the board (/ideas). It is also a post, with this ID. */
export type IdeaSummary = {
  id: string
  kind: IdeaKind
  title: string
  status: IdeaStatus
  votes: number
  viewerVoted: boolean
  replyCount: number
  createdAt: string
  author: { handle: string; displayName: string | null }
}

export type IdeaDetail = IdeaSummary & {
  statusReason: string | null
  duplicateOf: { id: string; title: string } | null
  timeline: { status: IdeaStatus; reason: string | null; at: string }[]
  viewerCanModerate: boolean
  /** Where a problem happened: only for its reporter and the board's moderators. */
  problem: { page: string | null; browser: string | null; appVersion: string | null } | null
}

export async function getIdeas(query: { group: IdeaGroup; kind?: IdeaKind; sort: 'top' | 'new'; cursor?: number }): Promise<{ ideas: IdeaSummary[]; cursor: number | null }> {
  const params = new URLSearchParams({ group: query.group, sort: query.sort })
  if (query.kind) params.set('kind', query.kind)
  if (query.cursor) params.set('cursor', String(query.cursor))
  const res = await api(`/v1/ideas?${params}`)
  if (!res.ok) throw new Error(`API /v1/ideas responded ${res.status}`)
  return res.json()
}

/** Null when the post is not an idea the visitor may see. */
export const getIdea = (id: string) => getOrNull<IdeaDetail>(`/v1/ideas/${encodeURIComponent(id)}`)

export const getMemberPosts = (handle: string, filter: ProfileFilter, cursor?: string) =>
  getPage(`/v1/members/${encodeURIComponent(handle)}/posts?filter=${filter}`, cursor)

async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await api(path)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`API ${path} responded ${res.status}`)
  return res.json()
}

/** A Gist the viewer may see; null for every refusal, which the API makes the same 404. */
export const getGist = (id: string) => getOrNull<GistView>(`/v1/gists/${encodeURIComponent(id)}`)

/**
 * A member's profile; or, for a handle its owner gave up recently, the handle they
 * use now (the API answers 404 with `movedTo`).
 */
export async function findProfile(handle: string): Promise<Profile | { movedTo: string } | null> {
  const path = `/v1/members/${encodeURIComponent(handle)}`
  const res = await api(path)
  if (res.status === 404) {
    const body: { movedTo?: unknown } | null = await res.json().catch(() => null)
    return typeof body?.movedTo === 'string' ? { movedTo: body.movedTo } : null
  }
  if (!res.ok) throw new Error(`API ${path} responded ${res.status}`)
  return res.json()
}

export const getProfile = async (handle: string): Promise<Profile | null> => {
  const found = await findProfile(handle)
  return found && 'movedTo' in found ? null : found
}

/** The post, its context, and its first page of replies in `order` (the API's default is newest first). */
export const getThread = (id: string, order: ReplyOrder = 'newest') =>
  getOrNull<Thread>(`/v1/posts/${encodeURIComponent(id)}${order === 'oldest' ? '?order=oldest' : ''}`)

/** Hydrate one confirmed post without fetching its ancestors or replies. */
export const getPost = (id: string) => getOrNull<Post>(`/v1/posts/${encodeURIComponent(id)}/post`)

export type PollVoterPage = {
  voters: {
    member: { id: string; handle: string; displayName: string | null; avatar: string | null }
    optionIds: string[]
    createdAt: string
  }[]
  cursor: string | null
}

export const getPollVoters = (id: string, cursor?: string) => getOrNull<PollVoterPage>(
  `/v1/posts/${encodeURIComponent(id)}/poll/votes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
)

/** A branch is always an explicit, bounded page; it never fetches descendants. */
export async function getReplies(id: string, cursor?: string, order: ReplyOrder = 'newest'): Promise<ReplyPage | null> {
  const query = new URLSearchParams({ order })
  if (cursor) query.set('cursor', cursor)
  return getOrNull<ReplyPage>(`/v1/posts/${encodeURIComponent(id)}/replies?${query}`)
}

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

/** Posts and replies with a hashtag, written without its #. Null when that is not a hashtag. */
export async function getHashtagPosts(tag: string, cursor?: string): Promise<Feed | null> {
  const path = `/v1/hashtags/${encodeURIComponent(tag)}/posts`
  const res = await api(cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path)
  if (res.status === 404) return null
  // A mangled cursor in the URL should fall back to the first page, as in getPage.
  if (res.status === 400 && cursor) return getHashtagPosts(tag)
  if (!res.ok) throw new Error(`API ${path} responded ${res.status}`)
  return res.json()
}

/** A hashtag many members are using this week. */
export type TrendingTopic = {
  /** The key every spelling shares (lower case). */
  tag: string
  /** How most of its uses spell it, without the #: link to its page with this. */
  label: string
  /** Different members who used it in the window. */
  members: number
  /** Posts and replies it was used in, in the window. */
  posts: number
}

/** The rules topics trend by, as the API applies them. */
export type TopicRules = { windowDays: number; minMembers: number; refreshSeconds: number }

export type TrendingTopics = { topics: TrendingTopic[]; rules: TopicRules }

export async function getTrendingTopics(): Promise<TrendingTopics> {
  const res = await api('/v1/topics/trending')
  if (!res.ok) throw new Error(`API /v1/topics/trending responded ${res.status}`)
  return res.json()
}

export async function getTrending(): Promise<Post[]> {
  const res = await api('/v1/trending')
  if (!res.ok) throw new Error(`API /v1/trending responded ${res.status}`)
  return res.json()
}

/** Someone the welcome flow suggests following, and why. */
export type Suggestion = {
  handle: string
  displayName: string | null
  avatar: string | null
  bio: string
  reason:
    | { kind: 'moderator' | 'community'; community: { slug: string; name: string } }
    | { kind: 'recent'; community: null }
}

/** People for a newcomer to follow, drawn from the communities they chose. */
export async function getOnboardingSuggestions(communities: string[]): Promise<Suggestion[]> {
  const path = `/v1/me/onboarding/suggestions?communities=${encodeURIComponent(communities.join(','))}`
  const res = await api(path)
  if (!res.ok) throw new Error(`API /v1/me/onboarding/suggestions responded ${res.status}`)
  return res.json()
}

export type SearchResults = {
  members: { handle: string; displayName: string | null; avatar: string | null; founder: boolean }[]
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
  /** Null when the upload scanner filed it. */
  reporterHandle: string | null
  reportCount: number
  post: { id: string; text: string; images: PostImage[]; authorHandle: string; communityName: string | null } | null
  member: { handle: string; active: boolean; displayName: string | null; bio: string; avatar: string | null } | null
}

export type LogEntry = {
  id: string
  action: string
  note: string
  createdAt: string
  actorHandle: string
  postId: string | null
  memberHandle: string | null
  communityName: string | null
}

export type ModeratorRoster = { slug: string; name: string; moderators: { handle: string; displayName: string | null }[] }[]

/**
 * Null when the viewer is not a moderator. `roster` (who moderates which
 * community) is only there for site moderators, who are the ones who can assign.
 */
export async function getModeration(): Promise<{ queue: QueueItem[]; log: LogEntry[]; roster: ModeratorRoster | null } | null> {
  const [queue, log, roster] = await Promise.all([
    api('/v1/moderation/reports'),
    api('/v1/moderation/log'),
    api('/v1/moderation/moderators'),
  ])
  if (!queue.ok || !log.ok) return null
  return { queue: await queue.json(), log: await log.json(), roster: roster.ok ? await roster.json() : null }
}

export type NotificationKind =
  | 'reply'
  | 'like'
  | 'repost'
  | 'quote'
  | 'mention'
  | 'follow'
  | 'post_removed'
  | 'post_restored'
  | 'report_resolved'
  | 'account_reinstated'
  | 'avatar_removed'
  | 'profile_cleared'
  | 'moderator_granted'
  | 'moderator_revoked'
  | 'idea_status'

export type Notification = {
  id: string
  kind: NotificationKind
  createdAt: string
  read: boolean
  /** Null for moderation decisions. */
  actor: { handle: string; displayName: string | null; avatar: string | null; founder: boolean } | null
  post: { id: string; excerpt: string } | null
  subjectHandle: string | null
  community: { slug: string; name: string } | null
  /** report_resolved: 'actioned' or 'dismissed'. post_removed: the report reason. idea_status: the new status. */
  detail: string | null
  /** idea_status: an idea or a problem, and whether the reader sent it (or only voted for it). */
  idea?: { kind: IdeaKind; yours: boolean } | null
}

/** Null when the visitor is not a signed-in member. */
export async function getNotifications(cursor?: string): Promise<{ notifications: Notification[]; cursor: string | null } | null> {
  const path = '/v1/notifications'
  const res = await api(cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path)
  if (res.status === 401 || res.status === 403) return null
  // A mangled cursor in the URL falls back to the first page.
  if (res.status === 400 && cursor) return getNotifications()
  if (!res.ok) throw new Error(`API ${path} responded ${res.status}`)
  return res.json()
}

/** Which kinds of activity notify the signed-in member. Null when they could not be loaded. */
export async function getNotificationPreferences(): Promise<NotificationPreferences | null> {
  const res = await api('/v1/notifications/preferences').catch(() => null)
  if (!res?.ok) return null
  return res.json()
}

/** The key browsers subscribe to push notifications with, or null when this server does not push. */
export async function getPushKey(): Promise<string | null> {
  const res = await api('/v1/push/key').catch(() => null)
  if (!res?.ok) return null
  return ((await res.json()) as { publicKey: string | null }).publicKey
}

/** Whether the signed-in member's account is waiting to be deleted; if not, how long it would wait. */
export type AccountDeletion = { state: 'none'; graceDays: number } | { state: 'scheduled'; scheduledFor: string }

/**
 * Null if it could not be found out. Suspended members and members waiting for
 * deletion may ask. Once per request, like getViewer: the deletion page asks twice.
 */
export const getAccountDeletion = cache(async (): Promise<AccountDeletion | null> => {
  const res = await api('/v1/me/deletion', { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return null
  return (await res.json()) as AccountDeletion
})

export type Appeal = { status: 'open' | 'actioned' | 'dismissed'; createdAt: string; resolvedAt: string | null }

/** A suspended member's most recent appeal, if any. */
export async function getLatestAppeal(): Promise<Appeal | null> {
  const res = await api('/v1/appeals/latest')
  if (!res.ok) return null
  return ((await res.json()) as { appeal: Appeal | null }).appeal
}

/** The signed-in member's own identity and voting-membership status (Settings). */
export type GovernanceStatus = {
  /** The member's own age band and how it is known. Never shown to anyone else. */
  age: {
    band: 'unknown' | 'under_18' | '18_plus'
    assurance: 'none' | 'declared' | 'reviewed' | 'verified'
    reviewDue: boolean
  }
  verification: {
    status: 'none' | 'pending' | 'verified' | 'rejected' | 'expired' | 'revoked'
    open: boolean
    verifiedAt: string | null
    expiresAt: string | null
  }
  badge: { shown: boolean }
  membership: {
    status: 'none' | 'pending' | 'active' | 'suspended' | 'resigned'
    registrationOpen: boolean
    eligible: boolean
    unmet: string[]
  }
}

export async function getGovernanceStatus(): Promise<GovernanceStatus | null> {
  const res = await api('/v1/me/governance')
  if (!res.ok) return null
  return res.json()
}
