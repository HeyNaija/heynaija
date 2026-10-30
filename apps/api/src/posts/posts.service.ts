import {
  bookmarks,
  communities,
  type Db,
  follows,
  likes,
  media,
  members,
  pollOptions,
  pollVotes,
  postMentions,
  postPolls,
  postHashtags,
  posts,
  REPLY_AUDIENCES,
  reposts,
} from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { findLinks, type FoundLink, previewUrlOf } from '../links/link-text.js'
import { type LinkPreview, type LinkPreviewRow, linkPreviewOf, toLinkPreview } from '../links/links.service.js'
import { ALT_MAX, avatarPath, POST_IMAGES_MAX, postImagePath } from '../media/media.service.js'
import { isFounder } from '../members/badges.js'
import { decodeCursor, decodeExactCursor, encodeCursor, encodeExactCursor, InvalidCursorError } from '../cursor.js'
import { excerpt, notify } from '../notifications/notifications.service.js'
import { graphemes } from '../text.js'
import { Refreshing } from '../refreshing.js'
import { DB } from '../tokens.js'
import {
  DISCOVER_RULES,
  type DiscoverPosition,
  type DiscoverRules,
  decodeDiscoverCursor,
  discoverMoment,
  encodeDiscoverCursor,
} from './discover.js'
import { hashtagsOf, type PostHashtag, recordHashtags } from './hashtags.js'
import { MENTIONS_NOTIFIED_MAX, mentionsOf, type PostMention, recordMentions } from './mentions.js'
import { decodeReplyCursor, encodeReplyCursor, type ReplyOrder } from './reply-cursor.js'

export const POST_MAX_GRAPHEMES = 300
export const POLL_OPTION_MAX_GRAPHEMES = 80
export const POLL_OPTIONS_MAX = 10
export const POLL_EXPIRIES = ['1_day', '3_days', '7_days', '30_days', 'never'] as const
export type ReplyAudience = (typeof REPLY_AUDIENCES)[number]

// Counted in graphemes so an emoji or an accented letter is one character, as
// the person typing sees it. May be empty: a post can be just images.
export const postTextOrEmpty = z
  .string()
  .trim()
  .refine((t) => t.length <= POST_MAX_GRAPHEMES * 16 && graphemes(t) <= POST_MAX_GRAPHEMES, {
    message: `post is longer than ${POST_MAX_GRAPHEMES} characters`,
  })

export const postText = postTextOrEmpty.pipe(z.string().min(1, 'post is empty'))

/** Images to attach to a new post: the member's own ready uploads, in order. */
export const postImagesInput = z
  .array(z.object({ id: z.uuid(), alt: z.string().trim().max(ALT_MAX).default('') }))
  .max(POST_IMAGES_MAX, `a post can have at most ${POST_IMAGES_MAX} images`)
  .refine((images) => new Set(images.map((i) => i.id)).size === images.length, 'the same image twice')
  .default([])

export type PostImageInput = z.infer<typeof postImagesInput>[number]

const pollOption = z.string().trim().min(1, 'poll options cannot be empty').refine(
  (option) => option.length <= POLL_OPTION_MAX_GRAPHEMES * 16 && graphemes(option) <= POLL_OPTION_MAX_GRAPHEMES,
  `poll options can have at most ${POLL_OPTION_MAX_GRAPHEMES} characters`,
)

export const pollInput = z
  .object({
    multiple: z.boolean().default(false),
    options: z.array(pollOption).min(2, 'a poll needs at least two options').max(POLL_OPTIONS_MAX),
    expiresIn: z.enum(POLL_EXPIRIES).default('7_days'),
  })
  .refine((poll) => new Set(poll.options.map((option) => option.toLocaleLowerCase())).size === poll.options.length, {
    message: 'poll options must be different',
    path: ['options'],
  })

export type PollInput = z.infer<typeof pollInput>

/** A new post or reply as the API receives it: text, images, or both. */
export const newPost = (slug: z.ZodType<string>) =>
  z
    .object({
      text: postTextOrEmpty.default(''),
      replyTo: z.uuid().optional(),
      /** A quote post: the post it quotes. */
      quote: z.uuid().optional(),
      community: slug.optional(),
      images: postImagesInput,
      poll: pollInput.optional(),
      replyAudience: z.enum(REPLY_AUDIENCES).default('everyone'),
    })
    .refine((p) => p.text.length > 0 || p.images.length > 0, { message: 'post is empty', path: ['text'] })
    .refine((p) => !p.poll || p.text.length > 0, { message: 'a poll needs a question', path: ['text'] })
    .refine((p) => !p.poll || !p.replyTo, { message: 'a poll cannot be added to a reply', path: ['poll'] })

export type PostLink = FoundLink

export type PostImage = {
  /** Path without the size suffix (see `postImagePath`). */
  src: string
  alt: string
  width: number
  height: number
  /** A GIF: the sizes are animated, and `still.webp` beside them is its first frame. */
  animated: boolean
}

export type PollView = {
  multiple: boolean
  expiresAt: Date | null
  closed: boolean
  totalVotes: number
  viewerVoted: boolean
  options: { id: string; text: string; position: number; voteCount: number; viewerVoted: boolean }[]
}

export type PollVoterPage = {
  voters: {
    member: { id: string; handle: string; displayName: string | null; avatar: string | null }
    optionIds: string[]
    createdAt: Date
  }[]
  cursor: string | null
}

type ImageRow = { id: string; alt: string; width: number; height: number; animated: boolean }

/** The post a quote post quotes, as the reader sees it inside the quote. */
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
      createdAt: Date
      replyParentId: string | null
    }
  // Deleted, taken down, by an inactive member, or by someone the reader blocked,
  // was blocked by or muted. One placeholder for all, so it gives nothing away.
  | { unavailable: true }

/** The post a reply answers: a preview, or one placeholder for every reason the viewer cannot read it. */
export type ReplyContext =
  | { unavailable?: false; id: string; authorHandle: string; authorName: string | null; authorAvatar: string | null; excerpt: string }
  | { unavailable: true }

/** How much of the parent a reply's preview quotes. */
const REPLY_CONTEXT_EXCERPT = 80

export type PostView = {
  unavailable?: false
  /** Thread-only structural expansion hint; direct counts exclude deleted children. */
  hasReplies?: boolean
  id: string
  authorId: string
  authorHandle: string
  /** The author's chosen name, if they have set one. */
  authorName: string | null
  /** Path of the author's profile photo without the size suffix, or null. */
  authorAvatar: string | null
  /** The author has the Founder badge: one of the people who founded HeyNaija. */
  authorFounder: boolean
  /** Empty when `deleted`. */
  text: string
  /** Up to four, in order. Empty when `deleted`. */
  images: PostImage[]
  /**
   * The @handles in `text` that lead to a member the viewer can see, in order,
   * each with the handle that member has now. Empty when `deleted`.
   */
  mentions: PostMention[]
  /** The #hashtags in `text`, in order, each with the topic it opens. Empty when `deleted`. */
  hashtags: PostHashtag[]
  /** The web addresses in `text`, in order, for the reader's app to link. Empty when `deleted`. */
  links: PostLink[]
  /**
   * What the first address leads to, once it has been read: shown as a card under
   * the post. Null when there is none yet, and when `deleted`.
   */
  linkPreview: LinkPreview | null
  createdAt: Date
  replyParentId: string | null
  /** The root post's effective conversation boundary. */
  replyAudience: ReplyAudience
  /** False for signed-out readers and members outside that boundary. */
  viewerCanReply: boolean
  poll: PollView | null
  /**
   * What a reply answers, for the lists that show replies beside other posts. Null
   * for a post that answers nothing, and for thread reads, which show the parent
   * themselves.
   */
  replyTo: ReplyContext | null
  likeCount: number
  replyCount: number
  repostCount: number
  /** Always false for anonymous viewers. */
  viewerLiked: boolean
  /** Always false for anonymous viewers. */
  viewerReposted: boolean
  /** Always false for anonymous viewers. Bookmarks are private to their owner. */
  viewerBookmarked: boolean
  /** Its author keeps it at the top of their profile. */
  pinnedOnProfile: boolean
  /** Its community's moderators keep it at the top of the community. */
  pinnedInCommunity: boolean
  /**
   * The viewer may pin it to, or unpin it from, the top of its community: it is a
   * top-level post in one, and they moderate that community or the whole site.
   */
  viewerCanPinInCommunity: boolean
  /**
   * Deleted by its author or taken down by a moderator. Only ever true for
   * ancestors shown in a thread, as a placeholder.
   */
  deleted: boolean
  /** The community it was posted in, if any (and if that community is still active). */
  community: { slug: string; name: string } | null
  /** A quote post's quoted post. Null for other posts, and when `deleted`. */
  quote: QuotedPost | null
  /**
   * Why it is in the viewer's Following feed or Discover. On a profile, 'repost'
   * marks the member's reposts. Null everywhere else.
   */
  reason: FeedReason | null
  /** Who reposted it, when `reason` is 'repost'. */
  repostedBy: { id: string; handle: string; displayName: string | null } | null
  /**
   * In Discover, when `reason` is 'network': the person the viewer follows who
   * last replied to, quoted or reposted it, and how many others they follow did.
   */
  via?: DiscoverVia
}

/**
 * 'own', 'network', 'following', 'community', 'active' and 'recent' are
 * Discover's, in the order they are chosen; 'own', 'following', 'community' and
 * 'repost' are Following's.
 */
export type FeedReason = 'own' | 'following' | 'community' | 'repost' | 'network' | 'active' | 'recent'

export type DiscoverVia = {
  id: string
  handle: string
  displayName: string | null
  action: 'replied' | 'quoted' | 'reposted'
  others: number
}

/** The lists on a member's profile: top-level posts, replies, and posts with images. */
export const PROFILE_FILTERS = ['posts', 'replies', 'media'] as const
export type ProfileFilter = (typeof PROFILE_FILTERS)[number]

export type PostPage = { posts: PostView[]; cursor: string | null }

/** The transaction a post is written in. */
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

/** A page of Discover: ranked as of `asOf`, by `rules`. */
export type DiscoverPage = PostPage & { asOf: string; rules: DiscoverRules }

/** One post in Discover's ranking, with what its reason line needs. */
type DiscoverRow = {
  id: string
  score: string
  follows_author: boolean
  in_joined: boolean
  took_part: boolean
  followed: number
  via_id: string | null
  via_handle: string | null
  via_name: string | null
  via_action: DiscoverVia['action'] | null
}

/** Whether `row` comes after `position` in Discover's order: score, highest first, then ID. */
const ranksAfter = (row: DiscoverRow, position: DiscoverPosition) => {
  const [score, last] = [Number(row.score), Number(position.score)]
  return score < last || (score === last && row.id < position.id)
}

export type UnavailableReply = {
  unavailable: true
  id: string
  replyParentId: string | null
  createdAt: Date
  hasReplies: true
}
export type ThreadReply = PostView | UnavailableReply
export type ReplyPage = { replies: ThreadReply[]; cursor: string | null }
export type Thread = {
  ancestors: PostView[]
  post: PostView
  replies: ThreadReply[]
  replyCursor: string | null
  ancestorsTruncated: boolean
  earlierAncestorId: string | null
}

export class ParentNotFoundError extends Error {}
export class ReplyNotAllowedError extends Error {}
export class PollNotFoundError extends Error {}
export class PollClosedError extends Error {}
export class PollAlreadyVotedError extends Error {}
export class PollOptionsError extends Error {}
export class CommunityNotFoundError extends Error {}
export { InvalidCursorError }
export class NotACommunityMemberError extends Error {}
export class ImagesNotReadyError extends Error {}
export class QuotedPostNotFoundError extends Error {}
export class NotACommunityModeratorError extends Error {}

const MAX_THREAD_DEPTH = 50
const REPLY_PAGE_SIZE = 20
const TRENDING_WINDOW_DAYS = 7
// The ranking is the same for every viewer, so it is computed at most once per
// TTL and each viewer's blocks and mutes are applied to it afterwards. Enough
// candidates are kept that a viewer who blocks or mutes a few of the authors
// still sees a full list.
export const TRENDING_TTL_MS = 60_000
const TRENDING_CANDIDATES = 50
// How many members a Following list has before its repost checks look members up
// in a hash rather than one by one in the index (PostsService.entries). Measured
// on 1.5M reposts: by index is quicker at 200, by hash at 1,000 and far quicker
// at 5,000.
const HASHED_MEMBERS_FROM = 500

const pollExpiresAt = (expiresIn: PollInput['expiresIn']): Date | null => {
  if (expiresIn === 'never') return null
  const days = Number(expiresIn.split('_')[0])
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

const topLevel = isNull(posts.replyParentId)

// Neither deleted by the author nor taken down by a moderator.
const live = and(isNull(posts.deletedAt), isNull(posts.removedAt))

/**
 * Shared eligibility for ordinary posts, reply nodes, branch parents, quoted posts
 * and reposters. `unmuted` is a member shown even if the viewer muted them: the
 * one whose profile they opened.
 */
export const visibleAuthor = (viewerId: string | null, authorId: SQL, active: SQL, unmuted?: string) =>
  and(
    active,
    viewerId ? sql`not ${blockedEitherWay(viewerId, authorId)}` : undefined,
    viewerId
      ? sql`(not exists(select 1 from mutes mu where mu.muter_id = ${viewerId} and mu.muted_id = ${authorId})${unmuted ? sql` or ${authorId} = ${unmuted}` : sql``})`
      : undefined,
  )

/** True when `memberId` moderates the community: as one of its moderators, or site-wide. */
const moderatesCommunity = (memberId: string, communityId: SQL) =>
  sql<boolean>`(exists(select 1 from members sm where sm.id = ${memberId} and sm.role = 'moderator')
    or exists(select 1 from community_memberships cm where cm.community_id = ${communityId} and cm.member_id = ${memberId} and cm.role = 'moderator'))`

/** True when either member has blocked the other. */
export const blockedEitherWay = (a: SQL | string, b: SQL | string) =>
  sql<boolean>`exists(select 1 from blocks bl where (bl.blocker_id = ${a} and bl.blocked_id = ${b}) or (bl.blocker_id = ${b} and bl.blocked_id = ${a}))`

// Written out so the outer post is unambiguous inside subqueries.
const outerId = sql`"posts"."id"`

// Has at least one image a reader can see.
const withImages = sql`exists(select 1 from media m where m.post_id = ${outerId} and m.status = 'ready')`

const profileFilter: Record<ProfileFilter, SQL> = {
  posts: topLevel,
  replies: isNotNull(posts.replyParentId),
  media: withImages,
}

/** A post's ready images in order, as JSON, for any query with `posts` in scope. */
export const imagesOf = (postId: SQL) =>
  sql<ImageRow[]>`coalesce((select json_agg(json_build_object('id', m.id, 'alt', m.alt, 'width', m.width, 'height', m.height, 'animated', m.animated) order by m.position) from media m where m.post_id = ${postId} and m.status = 'ready'), '[]'::json)`

export const toPostImages = (rows: ImageRow[]): PostImage[] =>
  rows.map(({ id, alt, width, height, animated }) => ({ src: postImagePath(id), alt, width, height, animated }))

type QuoteRow =
  | (Omit<Extract<QuotedPost, { id: string }>, 'images' | 'createdAt' | 'authorAvatar'> & {
      images: ImageRow[]
      createdAt: string
      authorAvatarId: string | null
    })
  | { unavailable: true }

/**
 * A quote post's quoted post as JSON, for any query with the quoting post in
 * scope: the post itself if `viewerId` may see it, a placeholder if not.
 */
const quoteOf = (viewerId: string | null, quotePostId: SQL) => sql<QuoteRow | null>`case when ${quotePostId} is null then null else coalesce((
  select json_build_object('id', q.id, 'authorId', q.author_id, 'authorHandle', qa.handle, 'authorName', qa.display_name,
    'authorAvatarId', qa.avatar_media_id, 'authorFounder', ${isFounder(sql`q.author_id`)}, 'text', q.text, 'images', ${imagesOf(sql`q.id`)},
    'createdAt', q.created_at, 'replyParentId', q.reply_parent_id)
  from posts q join members qa on qa.id = q.author_id
  where q.id = ${quotePostId} and q.deleted_at is null and q.removed_at is null
    and ${visibleAuthor(viewerId, sql`q.author_id`, sql`qa.active`)}
), json_build_object('unavailable', true)) end`

const toQuote = (row: QuoteRow | null): QuotedPost | null => {
  if (!row) return null
  if ('unavailable' in row) return { unavailable: true }
  const { images, createdAt, authorAvatarId, ...quote } = row
  return { ...quote, images: toPostImages(images), createdAt: new Date(createdAt), authorAvatar: avatarPath(authorAvatarId) }
}

type PollRow = Omit<PollView, 'expiresAt'> & { expiresAt: string | null }

/**
 * One bounded JSON object per post; voters themselves are fetched on their
 * paginated public page. The counts are kept by triggers (migration 0028), so a
 * popular poll costs a feed no more than any other.
 */
const pollOf = (viewerId: string | null, postId: SQL) => sql<PollRow | null>`(
  select json_build_object(
    'multiple', pp.multiple,
    'expiresAt', pp.expires_at,
    'closed', pp.expires_at is not null and pp.expires_at <= now(),
    'totalVotes', pp.voter_count,
    'viewerVoted', ${viewerId ? sql`exists(select 1 from poll_votes pv where pv.post_id = pp.post_id and pv.member_id = ${viewerId})` : sql`false`},
    'options', coalesce((
      select json_agg(json_build_object(
        'id', po.id,
        'text', po.text,
        'position', po.position,
        'voteCount', po.vote_count,
        'viewerVoted', ${viewerId ? sql`exists(select 1 from poll_votes pv where pv.post_id = pp.post_id and pv.option_id = po.id and pv.member_id = ${viewerId})` : sql`false`}
      ) order by po.position)
      from poll_options po where po.post_id = pp.post_id
    ), '[]'::json)
  ) from post_polls pp where pp.post_id = ${postId}
)`

const toPoll = (row: PollRow | null): PollView | null => row
  ? { ...row, expiresAt: row.expiresAt ? new Date(row.expiresAt) : null }
  : null

/** A reply inherits the root post's setting; a deleted root no longer restricts its surviving conversation. */
const replyAudienceOf = (postId: SQL, rootId: SQL) => sql<ReplyAudience>`coalesce((
  select case when r.deleted_at is not null or r.removed_at is not null or not ra.active then 'everyone' else r.reply_audience end
  from posts r join members ra on ra.id = r.author_id
  where r.id = coalesce(${rootId}, ${postId})
), 'everyone')`

/**
 * Whether the conversation's root lets the viewer reply: the one rule, used for
 * the reply buttons and, under a lock, when a reply is written. Like
 * `replyAudienceOf`, a root that is deleted, taken down, by an inactive member or
 * gone altogether restricts no one, though a block with its author still does.
 */
const canReplyTo = (viewerId: string | null, postId: SQL, rootId: SQL) => viewerId
  ? sql<boolean>`not exists(
      select 1 from posts r join members ra on ra.id = r.author_id
      where r.id = coalesce(${rootId}, ${postId})
        and (
          ${blockedEitherWay(viewerId, sql`r.author_id`)}
          or (
            r.deleted_at is null and r.removed_at is null and ra.active
            and r.author_id <> ${viewerId}
            and r.reply_audience <> 'everyone'
            and not exists(select 1 from post_mentions pm where pm.post_id = r.id and pm.member_id = ${viewerId})
            and not (r.reply_audience = 'following' and exists(
              select 1 from follows f where f.follower_id = r.author_id and f.followee_id = ${viewerId}
            ))
          )
        )
    )`
  : sql<boolean>`false`

/**
 * A poll is open to whoever could read its post (`post`): live, by an active
 * member, with no block either way and not muted by the viewer. For queries
 * joining post_polls to posts and the author in members.
 */
const pollReadableBy = (viewerId: string | null) =>
  and(live, visibleAuthor(viewerId, sql`${posts.authorId}`, sql`${members.active}`))
type ReplyContextRow =
  | { id: string; authorHandle: string; authorName: string | null; authorAvatarId: string | null; text: string }
  | { unavailable: true }

/**
 * The post a reply answers, as JSON, for any query with the reply in scope: its
 * author and the start of its text if `viewerId` may read it, otherwise a bare
 * placeholder. Eligibility is the one quoted posts use. Only the start of the text
 * leaves the database.
 */
const replyContextOf = (viewerId: string | null, parentId: SQL) => sql<ReplyContextRow | null>`case when ${parentId} is null then null else coalesce((
  select json_build_object('id', rp.id, 'authorHandle', ra.handle, 'authorName', ra.display_name,
    'authorAvatarId', ra.avatar_media_id, 'text', left(rp.text, 400))
  from posts rp join members ra on ra.id = rp.author_id
  where rp.id = ${parentId} and rp.deleted_at is null and rp.removed_at is null
    and ${visibleAuthor(viewerId, sql`rp.author_id`, sql`ra.active`)}
), json_build_object('unavailable', true)) end`

const toReplyContext = (row: ReplyContextRow | null): ReplyContext | null => {
  if (!row) return null
  if ('unavailable' in row) return { unavailable: true }
  const { authorAvatarId, text, ...parent } = row
  return { ...parent, authorAvatar: avatarPath(authorAvatarId), excerpt: excerpt(text, REPLY_CONTEXT_EXCERPT) }
}

@Injectable()
export class PostsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The one place posts are read for display. Posts by inactive members never
   * appear; deleted posts appear only when `includeDeleted`, with their text
   * withheld.
   */
  private async select(
    viewerId: string | null,
    where: SQL | undefined,
    opts: {
      includeDeleted?: boolean
      /** Show this author's posts even if the viewer muted them (on the author's profile). */
      unmuted?: string
      reason?: SQL<FeedReason>
      /** Thread reads show the parent themselves; everything else says what a reply answers. */
      withReplyContext?: boolean
      order?: SQL[]
      limit?: number
    } = {},
  ): Promise<PostView[]> {
    const rows = await this.db
      .select({
        id: posts.id,
        authorId: posts.authorId,
        authorHandle: members.handle,
        authorName: members.displayName,
        authorAvatarId: members.avatarMediaId,
        authorFounder: isFounder(sql`${posts.authorId}`),
        text: sql<string>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${posts.text} else '' end`,
        images: sql<
          ImageRow[]
        >`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${imagesOf(outerId)} else '[]'::json end`,
        mentions: sql<PostMention[]>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${mentionsOf(viewerId, outerId)} else '[]'::json end`,
        hashtags: sql<PostHashtag[]>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${hashtagsOf(outerId)} else '[]'::json end`,
        linkPreview: sql<LinkPreviewRow | null>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${linkPreviewOf(sql`"posts"."link_url"`)} end`,
        createdAt: posts.createdAt,
        replyParentId: posts.replyParentId,
        replyAudience: replyAudienceOf(outerId, sql`"posts"."root_id"`),
        viewerCanReply: canReplyTo(viewerId, outerId, sql`"posts"."root_id"`),
        poll: sql<PollRow | null>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${pollOf(viewerId, outerId)} end`,
        replyContext: opts.withReplyContext === false ? sql<null>`null` : replyContextOf(viewerId, sql`${posts.replyParentId}`),
        // Kept on the row by triggers (see the posts schema): only active
        // members' likes and live replies count, as a reader would see them.
        likeCount: posts.likeCount,
        replyCount: posts.replyCount,
        repostCount: posts.repostCount,
        viewerLiked: viewerId
          ? sql<boolean>`exists(select 1 from likes l where l.post_id = ${outerId} and l.member_id = ${viewerId})`
          : sql<boolean>`false`,
        viewerReposted: viewerId
          ? sql<boolean>`exists(select 1 from reposts r where r.post_id = ${outerId} and r.member_id = ${viewerId})`
          : sql<boolean>`false`,
        viewerBookmarked: viewerId
          ? sql<boolean>`exists(select 1 from bookmarks b where b.post_id = ${outerId} and b.member_id = ${viewerId})`
          : sql<boolean>`false`,
        deleted: sql<boolean>`${posts.deletedAt} is not null or ${posts.removedAt} is not null`,
        pinnedOnProfile: sql<boolean>`coalesce(${members.pinnedPostId} = ${posts.id}, false)`,
        pinnedInCommunity: sql<boolean>`coalesce(${communities.pinnedPostId} = ${posts.id}, false)`,
        viewerCanPinInCommunity: viewerId
          ? sql<boolean>`(${communities.id} is not null and ${posts.replyParentId} is null and ${moderatesCommunity(viewerId, sql`${communities.id}`)})`
          : sql<boolean>`false`,
        communitySlug: communities.slug,
        communityName: communities.name,
        quote: sql<QuoteRow | null>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${quoteOf(viewerId, sql`${posts.quotePostId}`)} end`,
        reason: opts.reason ?? sql<null>`null`,
      })
      .from(posts)
      .innerJoin(members, eq(members.id, posts.authorId))
      .leftJoin(communities, and(eq(communities.id, posts.communityId), eq(communities.active, true)))
      .where(
        and(
          visibleAuthor(viewerId, sql`${posts.authorId}`, sql`${members.active}`, opts.unmuted),
          opts.includeDeleted ? undefined : live,
          where,
        ),
      )
      .orderBy(...(opts.order ?? []))
      .limit(opts.limit ?? 1000)

    return rows.map(({ communitySlug, communityName, authorAvatarId, images, quote, linkPreview, poll, replyContext, ...row }) => ({
      ...row,
      replyTo: toReplyContext(replyContext),
      images: toPostImages(images),
      links: findLinks(row.text),
      linkPreview: toLinkPreview(linkPreview),
      authorAvatar: avatarPath(authorAvatarId),
      community: communitySlug && communityName ? { slug: communitySlug, name: communityName } : null,
      quote: toQuote(quote),
      poll: toPoll(poll),
      repostedBy: null,
    }))
  }

  /** Newest first, cursor-paginated. */
  private async page(
    viewerId: string | null,
    where: SQL | undefined,
    limit: number,
    cursor?: string,
    extra: { reason?: SQL<FeedReason>; unmuted?: string } = {},
  ): Promise<PostPage> {
    let before: SQL | undefined
    if (cursor) {
      const [createdAt, id] = decodeCursor(cursor)
      before = or(lt(posts.createdAt, createdAt), and(eq(posts.createdAt, createdAt), lt(posts.id, id)))
    }
    const rows = await this.select(viewerId, and(where, before), {
      ...extra,
      order: [desc(posts.createdAt), desc(posts.id)],
      limit: limit + 1,
    })

    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      posts: page,
      cursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    }
  }

  /** Everyone's top-level posts. */
  feed(viewerId: string | null, limit: number, cursor?: string): Promise<PostPage> {
    return this.page(viewerId, topLevel, limit, cursor)
  }

  /**
   * Top-level posts from the people `viewerId` follows and the communities they
   * have joined, plus their own, and what they and the people they follow
   * reposted. Each post says which of those brought it in.
   */
  followingFeed(viewerId: string, limit: number, cursor?: string): Promise<PostPage> {
    return this.entries(
      viewerId,
      {
        members: sql`(select ${viewerId}::uuid union all select f.followee_id from follows f where f.follower_id = ${viewerId})`,
        communities: sql`select cm.community_id from community_memberships cm
          join communities c on c.id = cm.community_id and c.active where cm.member_id = ${viewerId}`,
        reasons: true,
      },
      limit,
      cursor,
    )
  }

  /**
   * A newest-first list with reposts in it. Each post appears once, at the latest
   * moment it entered the list: when it was posted, if it is a top-level post by
   * one of `members` or in one of `communities`, or when one of `members` reposted
   * it. A repost by someone the viewer cannot see (inactive, blocked either way,
   * muted) does not count, so the post falls back to the next way in, if any.
   * `members` and `communities` are subqueries of IDs. With `reasons`, each post
   * says why it is there, as the Following feed does.
   */
  private async entries(
    viewerId: string | null,
    { members: candidates, communities: joined, reasons, unmuted }: {
      members: SQL
      communities?: SQL
      reasons?: boolean
      unmuted?: string
    },
    limit: number,
    cursor?: string,
  ): Promise<PostPage> {
    // Read first and passed in as arrays, so the planner sees how many members and
    // communities this list has and how busy they are. It can then walk the newest
    // posts for someone who follows many active accounts, and read each account's
    // own posts and reposts for someone who follows a few. As subqueries they were
    // estimated alike for every viewer, and every repost on the site was read.
    const sources = await this.db.execute<{ members: string[]; communities: string[] }>(sql`
      select array(select m.id from members m where m.id in ${candidates}
          and ${visibleAuthor(viewerId, sql`m.id`, sql`m.active`, unmuted)}) as members,
        ${joined ? sql`array(${joined})` : sql`'{}'::uuid[]`} as communities`)
    const { members: memberIds, communities: communityIds } = sources.rows[0]!
    if (!memberIds.length && !communityIds.length) return { posts: [], cursor: null }
    const ids = (list: string[]) => sql`${sql.param(list)}::uuid[]`
    // With one member, `=` keeps their posts and reposts in index order, so a page
    // is read newest first and the read stops when it is full.
    const byMember = (member: SQL) =>
      memberIds.length === 1 ? sql`${member} = ${memberIds[0]}` : sql`${member} = any(${ids(memberIds)})`

    const after = cursor ? decodeExactCursor(cursor) : null
    const before = (at: SQL, id: SQL) =>
      after ? sql`and (${at}, ${id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)` : sql``
    const postVisible = sql`p.deleted_at is null and p.removed_at is null and ${visibleAuthor(viewerId, sql`p.author_id`, sql`a.active`, unmuted)}`
    // A repost of `post` by one of `members`, made after `since` (if given). A few
    // members are each looked up in the index. For a long list it is cheaper to
    // read the post's reposts and find the members in a hash: `is true` stops the
    // list becoming an index condition, which re-sorts it for every post checked.
    const memberRepost = (post: SQL, since?: SQL) => {
      const reposter = byMember(sql`rx.member_id`)
      return sql`exists(select 1 from reposts rx where rx.post_id = ${post}
        and ${memberIds.length >= HASHED_MEMBERS_FROM ? sql`(${reposter}) is true` : reposter}
        ${since ? sql`and (rx.created_at, rx.member_id) > ${since}` : sql``})`
    }
    // Each branch is cut to one page before they are merged, so neither reads more than it must.
    const { rows } = await this.db.execute<{
      post_id: string
      reposter_id: string | null
      reposter_handle: string | null
      reposter_name: string | null
      cursor_at: string
    }>(sql`
      with entries as (
        (select p.id as post_id, p.created_at as at, null::uuid as reposter_id
        from posts p join members a on a.id = p.author_id
        where p.reply_parent_id is null
          and (${byMember(sql`p.author_id`)}${communityIds.length ? sql` or p.community_id = any(${ids(communityIds)})` : sql``})
          and ${postVisible} and not ${memberRepost(sql`p.id`)}
          ${before(sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc
        limit ${limit + 1})
        union all
        (select r.post_id, r.created_at, r.member_id
        from reposts r join posts p on p.id = r.post_id join members a on a.id = p.author_id
        where ${byMember(sql`r.member_id`)} and ${postVisible}
          and not ${memberRepost(sql`r.post_id`, sql`(r.created_at, r.member_id)`)}
          ${before(sql`r.created_at`, sql`r.post_id`)}
        order by r.created_at desc, r.post_id desc
        limit ${limit + 1})
      )
      select e.post_id, e.reposter_id, rm.handle as reposter_handle, rm.display_name as reposter_name,
        to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
      from entries e left join members rm on rm.id = e.reposter_id
      order by e.at desc, e.post_id desc
      limit ${limit + 1}`)

    const page = rows.slice(0, limit)
    const found = page.length
      ? await this.select(viewerId, inArray(posts.id, page.map((e) => e.post_id)), { unmuted, limit: page.length })
      : []
    const byId = new Map(found.map((post) => [post.id, post]))
    // Only posts by members the viewer can see are shown, so for them being in
    // `members` means being the viewer or someone they follow.
    const listed = new Set(memberIds)
    const reasonFor = (authorId: string): FeedReason | null =>
      !reasons ? null : authorId === viewerId ? 'own' : listed.has(authorId) ? 'following' : 'community'
    const last = page.at(-1)
    return {
      // A post that went out of sight between the two reads is simply left out.
      posts: page.flatMap((e): PostView[] => {
        const post = byId.get(e.post_id)
        if (!post) return []
        if (e.reposter_id) {
          const repostedBy = { id: e.reposter_id, handle: e.reposter_handle!, displayName: e.reposter_name }
          return [{ ...post, reason: 'repost', repostedBy }]
        }
        return [{ ...post, reason: reasonFor(post.authorId), repostedBy: null }]
      }),
      cursor: rows.length > limit && last ? encodeExactCursor(last.cursor_at, last.post_id) : null,
    }
  }

  /**
   * The visitors' Discover: the same for everyone who is not signed in, so it is
   * ranked once a minute, as of that moment, and shared.
   */
  private readonly visitorDiscover = new Refreshing(DISCOVER_RULES.visitorRefreshSeconds * 1000, async () => {
    const asOf = new Date().toISOString()
    return { asOf, rows: await this.rankDiscover(null, asOf, DISCOVER_RULES.maxPosts, null) }
  })

  /**
   * Discover (ADR 0014): recent top-level posts ranked by published rules
   * (`DISCOVER_RULES`), from public activity and the viewer's own follows and
   * communities. Every page of one visit is ranked as of the same moment, so
   * what happens meanwhile does not move the list. Each post says why it is
   * there: someone the viewer follows replied, quoted or reposted ('network'),
   * the viewer follows its author ('following'), it is in a community they
   * joined ('community'), people took part in it ('active'), or none of those
   * ('recent': every post starts with a point, so a new one can be seen).
   *
   * Above the first page, a member's own posts from the last hour, newest first
   * ('own'), as of now rather than the ranking's moment, so a post just written
   * shows at once. A visitor (`viewerId` null) gets the ranking every visitor
   * gets, worked out once a minute.
   *
   * Likes count only as each post's total, the number anyone can see: who liked
   * a post is not public, so Discover never names or counts the people the
   * viewer follows who liked it.
   */
  async discover(viewerId: string | null, limit: number, { cursor, at }: { cursor?: string; at?: string } = {}): Promise<DiscoverPage> {
    const after = cursor ? decodeDiscoverCursor(cursor) : null
    let asOf: string
    let rows: DiscoverRow[]
    const shared = viewerId ? null : await this.visitorDiscover.get()
    if (shared && (!after || after.asOf === shared.asOf)) {
      asOf = shared.asOf
      rows = (after ? shared.rows.filter((row) => ranksAfter(row, after)) : shared.rows).slice(0, limit + 1)
    } else {
      // A visitor's later page from a ranking since replaced is ranked again as of its moment.
      asOf = after?.asOf ?? (shared ? shared.asOf : discoverMoment(at))
      rows = await this.rankDiscover(viewerId, asOf, limit + 1, after)
    }

    const page = rows.slice(0, limit)
    const [found, own] = await Promise.all([
      page.length ? this.select(viewerId, inArray(posts.id, page.map((row) => row.id)), { limit: page.length }) : [],
      viewerId && !after
        ? this.select(
            viewerId,
            and(
              topLevel,
              eq(posts.authorId, viewerId),
              sql`${posts.createdAt} > now() - make_interval(mins => ${DISCOVER_RULES.ownPostsMinutes}::int)`,
            ),
            { order: [desc(posts.createdAt), desc(posts.id)], limit: 20 },
          )
        : [],
    ])
    const byId = new Map(found.map((post) => [post.id, post]))
    const last = page.at(-1)
    return {
      posts: [
        ...own.map((post): PostView => ({ ...post, reason: 'own' })),
        // A post that went out of sight between the two reads is simply left out.
        ...page.flatMap((row): PostView[] => {
          const post = byId.get(row.id)
          if (!post) return []
          if (row.via_id) {
            const via: DiscoverVia = {
              id: row.via_id,
              handle: row.via_handle!,
              displayName: row.via_name,
              action: row.via_action!,
              others: Math.max(0, row.followed - 1),
            }
            return [{ ...post, reason: 'network', via }]
          }
          const reason = row.follows_author ? 'following' : row.in_joined ? 'community' : row.took_part ? 'active' : 'recent'
          return [{ ...post, reason }]
        }),
      ],
      cursor: rows.length > limit && last ? encodeDiscoverCursor({ asOf, score: last.score, id: last.id }) : null,
      asOf,
      rules: DISCOVER_RULES,
    }
  }

  /**
   * Discover's ranking as of `asOf`, after `after` if given: at most `limit`
   * rows, each with what its reason line needs. With no viewer, only the
   * points that are the same for everyone count.
   */
  private async rankDiscover(viewerId: string | null, asOf: string, limit: number, after: DiscoverPosition | null): Promise<DiscoverRow[]> {
    const rules = DISCOVER_RULES
    const until = sql`${asOf}::timestamptz`
    const since = sql`(${asOf}::timestamptz - make_interval(hours => ${rules.windowHours}::int))`
    const { rows } = await this.db.execute<DiscoverRow>(sql`
      -- The people the viewer follows and can see.
      with followed as materialized (
        ${viewerId
          ? sql`select f.followee_id as id from follows f join members m on m.id = f.followee_id
            where f.follower_id = ${viewerId} and ${visibleAuthor(viewerId, sql`f.followee_id`, sql`m.active`)}`
          : sql`select null::uuid as id where false`}
      ),
      -- Reported by enough members, or by the image scanner, and not yet decided.
      held as materialized (
        select r.post_id from reports r
        where r.status = 'open' and r.post_id is not null
        group by r.post_id
        having count(distinct r.reporter_id) >= ${rules.reportsToHold}::int or bool_or(r.reporter_id is null)
      ),
      candidates as materialized (
        select p.id, p.author_id, p.created_at,
          p.author_id in (select id from followed) as follows_author,
          ${viewerId
            ? sql`exists(select 1 from community_memberships cm join communities c on c.id = cm.community_id and c.active
              where cm.member_id = ${viewerId} and cm.community_id = p.community_id)`
            : sql`false`} as in_joined
        from posts p join members a on a.id = p.author_id
        where p.reply_parent_id is null and p.created_at > ${since} and p.created_at <= ${until}
          and p.deleted_at is null and p.removed_at is null
          ${viewerId ? sql`and p.author_id <> ${viewerId}` : sql``}
          and ${visibleAuthor(viewerId, sql`p.author_id`, sql`a.active`)}
          and not exists(select 1 from held h where h.post_id = p.id)
      ),
      -- Who replied (anywhere in the conversation), quoted or reposted, up to the
      -- moment. A reply or quote comes after its post, so all of them are in the
      -- window too, and are read from it rather than by root_id, which has no index.
      acts as materialized (
        select r.root_id as post_id, r.author_id as member_id, r.created_at as at, 'replied' as action
        from posts r join members m on m.id = r.author_id and m.active
        where r.created_at > ${since} and r.created_at <= ${until} and r.root_id in (select id from candidates)
          and r.deleted_at is null and r.removed_at is null
        union all
        select q.quote_post_id, q.author_id, q.created_at, 'quoted'
        from posts q join members m on m.id = q.author_id and m.active
        where q.created_at > ${since} and q.created_at <= ${until} and q.quote_post_id in (select id from candidates)
          and q.deleted_at is null and q.removed_at is null
        union all
        select rp.post_id, rp.member_id, rp.created_at, 'reposted'
        from reposts rp join members m on m.id = rp.member_id and m.active
        where rp.post_id in (select id from candidates) and rp.created_at <= ${until}
      ),
      tallies as (
        select a.post_id,
          count(distinct a.member_id) filter (where a.action <> 'reposted' and a.member_id <> c.author_id) as conversation,
          count(*) filter (where a.action = 'reposted') as reposts,
          count(distinct a.member_id) filter (where a.member_id <> c.author_id and f.id is not null) as followed
        from acts a join candidates c on c.id = a.post_id left join followed f on f.id = a.member_id
        group by a.post_id
      ),
      liked as (
        select l.post_id, count(*) as likes
        from likes l join members m on m.id = l.member_id and m.active
        where l.post_id in (select id from candidates) and l.created_at <= ${until}
        group by l.post_id
      ),
      scored as (
        select c.id, c.author_id, c.follows_author, c.in_joined, coalesce(t.followed, 0) as followed,
          coalesce(t.conversation, 0) + coalesce(l.likes, 0) + coalesce(t.reposts, 0) > 0 as took_part,
          ${rules.startingPoints}::int
            + ${rules.conversationPoints}::int * coalesce(t.conversation, 0)
            + ${rules.likePoints}::int * coalesce(l.likes, 0)
            + ${rules.repostPoints}::int * coalesce(t.reposts, 0)
            + ${rules.followedPoints}::int * coalesce(t.followed, 0)
            + case when c.follows_author then ${rules.followsAuthorPoints}::int else 0 end
            + case when c.in_joined then ${rules.joinedCommunityPoints}::int else 0 end as points,
          extract(epoch from (${until} - c.created_at))::float8 / 3600 as hours
        from candidates c left join tallies t on t.post_id = c.id left join liked l on l.post_id = c.id
      ),
      ranked as (
        select s.*, s.points / power(s.hours + ${rules.ageOffsetHours}::float8, ${rules.gravity}::float8) as score
        from scored s
      ),
      spread as (
        select r.*, r.score * power(${rules.authorDecay}::float8,
          (row_number() over (partition by r.author_id order by r.score desc, r.id desc) - 1)::float8) as adjusted
        from ranked r
      ),
      listed as (
        select s.*, row_number() over (order by s.adjusted desc, s.id desc) as position from spread s
      ),
      -- The person the viewer follows who acted last, to name.
      named as (
        select distinct on (a.post_id) a.post_id, a.member_id, a.action
        from acts a join candidates c on c.id = a.post_id join followed f on f.id = a.member_id
        where a.member_id <> c.author_id
        order by a.post_id, a.at desc, a.member_id
      )
      select l.id, l.adjusted::text as score, l.follows_author, l.in_joined, l.took_part, l.followed::int as followed,
        n.member_id as via_id, vm.handle as via_handle, vm.display_name as via_name, n.action as via_action
      from listed l left join named n on n.post_id = l.id left join members vm on vm.id = n.member_id
      where l.position <= ${rules.maxPosts}::int
        ${after ? sql`and (l.adjusted, l.id) < (${after.score}::float8, ${after.id}::uuid)` : sql``}
      order by l.adjusted desc, l.id desc
      limit ${limit}`)
    return rows
  }

  /** Top-level posts in one community. */
  inCommunity(viewerId: string | null, communityId: string, limit: number, cursor?: string): Promise<PostPage> {
    return this.page(viewerId, and(topLevel, eq(posts.communityId, communityId)), limit, cursor)
  }

  /**
   * One list from a member's profile: their top-level posts and reposts, their
   * replies, or everything they posted with images (replies included).
   */
  byAuthor(
    viewerId: string | null,
    authorId: string,
    limit: number,
    cursor?: string,
    filter: ProfileFilter = 'posts',
  ): Promise<PostPage> {
    if (filter === 'posts') {
      return this.entries(viewerId, { members: sql`(select ${authorId}::uuid)`, unmuted: authorId }, limit, cursor)
    }
    return this.page(viewerId, and(eq(posts.authorId, authorId), profileFilter[filter]), limit, cursor, {
      unmuted: authorId,
    })
  }

  /**
   * Posts and replies with `#tag` in them, newest first. `tag` is a key from
   * `parseHashtag`, so every spelling of the hashtag is found.
   */
  withHashtag(viewerId: string | null, tag: string, limit: number, cursor?: string): Promise<PostPage> {
    const tagged = this.db
      .select({ id: postHashtags.postId })
      .from(postHashtags)
      .where(eq(postHashtags.tag, tag))
    return this.page(viewerId, inArray(posts.id, tagged), limit, cursor)
  }

  /** The post a member keeps at the top of their profile, if the viewer may see it. */
  async pinnedOnProfile(viewerId: string | null, authorId: string): Promise<PostView | null> {
    const pinned = sql`(select m.pinned_post_id from members m where m.id = ${authorId})`
    const [post] = await this.select(viewerId, and(sql`${posts.id} = ${pinned}`, eq(posts.authorId, authorId), topLevel), {
      unmuted: authorId,
      limit: 1,
    })
    return post ?? null
  }

  /** The post a community's moderators keep at the top of it, if the viewer may see it. */
  async pinnedInCommunity(viewerId: string | null, communityId: string): Promise<PostView | null> {
    const pinned = sql`(select c.pinned_post_id from communities c where c.id = ${communityId})`
    const [post] = await this.select(viewerId, and(sql`${posts.id} = ${pinned}`, eq(posts.communityId, communityId), topLevel), {
      limit: 1,
    })
    return post ?? null
  }

  /**
   * Keeps one of the member's own live top-level posts at the top of their
   * profile, in place of any they pinned before. False if it is not one.
   */
  async pinToProfile(memberId: string, postId: string): Promise<boolean> {
    const rows = await this.db
      .update(members)
      .set({ pinnedPostId: postId })
      .where(
        and(
          eq(members.id, memberId),
          sql`exists(select 1 from posts p where p.id = ${postId} and p.author_id = ${memberId}
            and p.reply_parent_id is null and p.deleted_at is null and p.removed_at is null)`,
        ),
      )
      .returning({ id: members.id })
    return rows.length > 0
  }

  /** Idempotent: nothing changes unless `postId` is the one pinned. */
  async unpinFromProfile(memberId: string, postId: string): Promise<void> {
    await this.db
      .update(members)
      .set({ pinnedPostId: null })
      .where(and(eq(members.id, memberId), eq(members.pinnedPostId, postId)))
  }

  /**
   * Keeps a live top-level post at the top of its community, in place of any
   * pinned before. Only the community's moderators and site-wide moderators may.
   * False if it is not such a post in an active community.
   */
  async pinInCommunity(memberId: string, postId: string): Promise<boolean> {
    const [post] = await this.db
      .select({ communityId: communities.id, allowed: moderatesCommunity(memberId, sql`${communities.id}`) })
      .from(posts)
      .innerJoin(members, eq(members.id, posts.authorId))
      .innerJoin(communities, and(eq(communities.id, posts.communityId), eq(communities.active, true)))
      .where(and(eq(posts.id, postId), live, topLevel, eq(members.active, true)))
    if (!post) return false
    if (!post.allowed) throw new NotACommunityModeratorError('only its moderators can pin posts in a community')
    await this.db.update(communities).set({ pinnedPostId: postId }).where(eq(communities.id, post.communityId))
    return true
  }

  /**
   * Idempotent: nothing changes unless `postId` is pinned in a community, and then
   * only its moderators and site-wide moderators may unpin it, even if it has
   * since been deleted or taken down.
   */
  async unpinInCommunity(memberId: string, postId: string): Promise<void> {
    const [community] = await this.db
      .select({ id: communities.id, allowed: moderatesCommunity(memberId, sql`${communities.id}`) })
      .from(communities)
      .where(eq(communities.pinnedPostId, postId))
    if (!community) return
    if (!community.allowed) throw new NotACommunityModeratorError('only its moderators can unpin posts in a community')
    await this.db
      .update(communities)
      .set({ pinnedPostId: null })
      .where(and(eq(communities.id, community.id), eq(communities.pinnedPostId, postId)))
  }

  /** The posts a member has saved. Only ever shown to that member. */
  bookmarked(viewerId: string, limit: number, cursor?: string): Promise<PostPage> {
    const saved = this.db
      .select({ id: bookmarks.postId })
      .from(bookmarks)
      .where(eq(bookmarks.memberId, viewerId))
    return this.page(viewerId, inArray(posts.id, saved), limit, cursor)
  }

  private readonly trendingRanking = new Refreshing(TRENDING_TTL_MS, () => this.rankTrending())

  /**
   * The conversations people are engaging with this week: top-level posts ranked
   * by replies (weighted double) and likes. Posts with neither are left out.
   *
   * The ranking may be up to a minute old; whether each post is still live, its
   * author still active and not blocked or muted by the viewer, and its counts,
   * are read fresh on every call. So per call this reads at most
   * `TRENDING_CANDIDATES` posts, however many were posted this week.
   */
  async trending(viewerId: string | null, limit: number): Promise<PostView[]> {
    const ids = await this.trendingRanking.get()
    if (ids.length === 0) return []
    return this.select(viewerId, inArray(posts.id, ids), {
      order: [sql`array_position(array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[], "posts"."id")`],
      limit,
    })
  }

  /**
   * Scores this week's live top-level posts by active authors from the counters
   * on each post: likes, plus twice the replies.
   */
  private async rankTrending(): Promise<string[]> {
    const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 86_400_000).toISOString()
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select p.id from posts p
      join members m on m.id = p.author_id and m.active
      where p.reply_parent_id is null and p.deleted_at is null and p.removed_at is null and p.created_at > ${since}
        and p.like_count + p.reply_count > 0
      order by p.reply_count * 2 + p.like_count desc, p.created_at desc, p.id desc
      limit ${TRENDING_CANDIDATES}`)
    return rows.map((r) => r.id)
  }

  /** Full-text search over post text, newest first. Replies are included. */
  search(viewerId: string | null, query: string, limit: number): Promise<PostView[]> {
    return this.select(
      viewerId,
      sql`to_tsvector('simple', ${posts.text}) @@ websearch_to_tsquery('simple', ${query})`,
      { order: [desc(posts.createdAt), desc(posts.id)], limit },
    )
  }

  /** A post with the conversation above it and the first page of direct replies below it, in `order`. */
  async thread(viewerId: string | null, id: string, order: ReplyOrder = 'newest'): Promise<Thread | null> {
    const post = await this.post(viewerId, id)
    if (!post) return null

    // Roots need no ancestor query. One extra ID makes truncation explicit;
    // only the nearest 50 ancestors are hydrated. The path also stops cycles.
    const chain = post.replyParentId
      ? await this.db.execute<{ id: string; depth: number }>(sql`
      with recursive up as (
        select p.id, p.reply_parent_id, 1 as depth, array[${post.id}::uuid, p.id] as path
        from posts p where p.id = ${post.replyParentId} and p.id <> ${post.id}
        union all
        select p.id, p.reply_parent_id, up.depth + 1, up.path || p.id
        from posts p join up on p.id = up.reply_parent_id
        where up.depth < ${MAX_THREAD_DEPTH + 1} and not p.id = any(up.path)
      )
      select id, depth from up order by depth asc`)
      : { rows: [] }
    const ancestorIds = chain.rows.slice(0, MAX_THREAD_DEPTH).map((r) => r.id).reverse()

    const [ancestors, replies] = await Promise.all([
      ancestorIds.length
        ? this.select(viewerId, inArray(posts.id, ancestorIds), { includeDeleted: true, withReplyContext: false })
        : Promise.resolve([]),
      this.replyPage(viewerId, id, REPLY_PAGE_SIZE, order),
    ])
    // Root first. An ancestor by a now-inactive member is simply absent.
    ancestors.sort((a, b) => ancestorIds.indexOf(a.id) - ancestorIds.indexOf(b.id))
    return {
      ancestors,
      post,
      replies: replies.replies,
      replyCursor: replies.cursor,
      ancestorsTruncated: chain.rows.length > MAX_THREAD_DEPTH,
      // Continue through a known eligible live focus. The raw next ancestor may
      // be deleted or blocked and would make a broken continuation permalink.
      earlierAncestorId: chain.rows.length > MAX_THREAD_DEPTH ? ancestors.find((ancestor) => !ancestor.deleted)?.id ?? null : null,
    }
  }

  /** A lightweight read for confirmed inline replies; no ancestors or children. */
  async post(viewerId: string | null, id: string): Promise<PostView | null> {
    const [post] = await this.select(viewerId, eq(posts.id, id), { limit: 1, withReplyContext: false })
    return post ?? null
  }

  /** A parent is checked afresh, including when its structural stub was loaded earlier. */
  async replies(
    viewerId: string | null,
    parentId: string,
    limit = REPLY_PAGE_SIZE,
    cursor?: string,
    order: ReplyOrder = 'newest',
  ): Promise<ReplyPage | null> {
    // Validate even when the parent is unavailable. A cursor grants no access.
    if (cursor) decodeReplyCursor(cursor, parentId, order)
    const [parent] = await this.db
      .select({ id: posts.id })
      .from(posts)
      .innerJoin(members, eq(members.id, posts.authorId))
      .where(
        and(
          eq(posts.id, parentId),
          visibleAuthor(viewerId, sql`${posts.authorId}`, sql`${members.active}`),
          or(live, sql`exists(select 1 from posts child where child.reply_parent_id = ${posts.id})`),
        ),
      )
      .limit(1)
    if (!parent) return null
    return this.replyPage(viewerId, parentId, Math.min(REPLY_PAGE_SIZE, Math.max(1, limit)), order, cursor)
  }

  /**
   * One bounded sibling query, followed by live-row hydration inside that statement.
   *
   * Replies by the author of the post they answer come first, then everyone
   * else's; each group is in time order, newest or oldest first. Nothing is
   * ranked. Each group is its own index-ordered read of at most a page, so a
   * page never sorts all of a busy post's replies. A deleted or taken-down reply
   * by the author is a placeholder among everyone else's, so its place does not
   * say whose it was.
   */
  private async replyPage(viewerId: string | null, parentId: string, limit: number, order: ReplyOrder, cursor?: string): Promise<ReplyPage> {
    const after = cursor ? decodeReplyCursor(cursor, parentId, order) : null
    const direction = sql.raw(order === 'newest' ? 'desc' : 'asc')
    const beyond = (group: 0 | 1) => {
      if (!after || after.group < group) return sql``
      if (after.group > group) return sql`and false`
      return order === 'newest'
        ? sql`and (p.created_at, p.id) < (${after.timestamp}::timestamptz, ${after.id}::uuid)`
        : sql`and (p.created_at, p.id) > (${after.timestamp}::timestamptz, ${after.id}::uuid)`
    }
    const parentAuthor = sql`(select author_id from posts where id = ${parentId})`
    const visible = visibleAuthor(viewerId, sql`p.author_id`, sql`a.active`)
    type ReplyRow = {
      id: string
      reply_parent_id: string | null
      created_at: Date
      grp: 0 | 1
      cursor_timestamp: string
      view: (Omit<PostView, 'images' | 'createdAt' | 'authorAvatar' | 'quote' | 'poll' | 'links' | 'linkPreview'> & {
        images: ImageRow[]
        createdAt: string
        authorAvatarId: string | null
        quote: QuoteRow | null
        poll: PollRow | null
        linkPreview: LinkPreviewRow | null
      }) | null
    }
    const { rows } = await this.db.execute<ReplyRow>(sql`
      with page as materialized (
        select * from (
          (select p.id, p.reply_parent_id, p.created_at, false as unavailable, 0 as grp
          from posts p join members a on a.id = p.author_id
          where p.reply_parent_id = ${parentId}
            and p.author_id = ${parentAuthor} and p.deleted_at is null and p.removed_at is null
            and ${visible}
            ${beyond(0)}
          order by p.created_at ${direction}, p.id ${direction}
          limit ${limit + 1})
          union all
          (select p.id, p.reply_parent_id, p.created_at,
            p.deleted_at is not null or p.removed_at is not null as unavailable, 1 as grp
          from posts p join members a on a.id = p.author_id
          where p.reply_parent_id = ${parentId}
            and (p.author_id is distinct from ${parentAuthor} or p.deleted_at is not null or p.removed_at is not null)
            and ${visible}
            and ((p.deleted_at is null and p.removed_at is null)
              or exists(select 1 from posts child where child.reply_parent_id = p.id))
            ${beyond(1)}
          order by p.created_at ${direction}, p.id ${direction}
          limit ${limit + 1})
        ) candidates
        order by grp, created_at ${direction}, id ${direction}
        limit ${limit + 1}
      )
      select page.id, page.reply_parent_id, page.created_at, page.grp,
        to_char(page.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_timestamp,
        case when page.unavailable then null else json_build_object(
          'id', p.id, 'authorId', p.author_id, 'authorHandle', a.handle,
          'authorName', a.display_name, 'authorAvatarId', a.avatar_media_id, 'authorFounder', ${isFounder(sql`p.author_id`)},
          'text', p.text, 'images', ${imagesOf(sql`p.id`)}, 'mentions', ${mentionsOf(viewerId, sql`p.id`)},
          'hashtags', ${hashtagsOf(sql`p.id`)},
          'linkPreview', ${linkPreviewOf(sql`p.link_url`)},
          'createdAt', p.created_at, 'replyParentId', p.reply_parent_id, 'replyTo', null,
          'replyAudience', ${replyAudienceOf(sql`p.id`, sql`p.root_id`)},
          'viewerCanReply', ${canReplyTo(viewerId, sql`p.id`, sql`p.root_id`)},
          'poll', ${pollOf(viewerId, sql`p.id`)},
          'likeCount', p.like_count, 'replyCount', p.reply_count, 'repostCount', p.repost_count,
          'hasReplies', p.reply_count > 0 or exists(select 1 from posts child where child.reply_parent_id = p.id),
          'viewerLiked', ${viewerId ? sql`exists(select 1 from likes l where l.post_id = p.id and l.member_id = ${viewerId})` : sql`false`},
          'viewerBookmarked', ${viewerId ? sql`exists(select 1 from bookmarks b where b.post_id = p.id and b.member_id = ${viewerId})` : sql`false`},
          'viewerReposted', ${viewerId ? sql`exists(select 1 from reposts r where r.post_id = p.id and r.member_id = ${viewerId})` : sql`false`},
          'quote', ${quoteOf(viewerId, sql`p.quote_post_id`)},
          'deleted', false, 'reason', null, 'repostedBy', null,
          'pinnedOnProfile', false, 'pinnedInCommunity', false, 'viewerCanPinInCommunity', false,
          'community', case when c.id is null then null else json_build_object('slug', c.slug, 'name', c.name) end
        ) end as view
      from page join posts p on p.id = page.id
      join members a on a.id = p.author_id
      left join communities c on c.id = p.community_id and c.active
      order by page.grp, page.created_at ${direction}, page.id ${direction}`)
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      replies: page.map((row): ThreadReply => {
        if (!row.view) {
          return {
            unavailable: true,
            id: row.id,
            replyParentId: row.reply_parent_id,
            createdAt: row.created_at,
            hasReplies: true,
          }
        }
        const { images, createdAt, authorAvatarId, quote, poll, linkPreview, ...post } = row.view
        return {
          ...post,
          images: toPostImages(images),
          links: findLinks(post.text),
          linkPreview: toLinkPreview(linkPreview),
          createdAt: new Date(createdAt),
          authorAvatar: avatarPath(authorAvatarId),
          quote: toQuote(quote),
          poll: toPoll(poll),
        }
      }),
      cursor: rows.length > limit && last
        ? encodeReplyCursor(parentId, order, { group: last.grp, timestamp: last.cursor_timestamp, id: last.id })
        : null,
    }
  }

  /**
   * `communitySlug` posts into a community the author has joined. A reply always
   * lands in its parent's community (or none), whatever is asked for. `images`
   * must be the author's own uploads, processed and not on another post. `quote`
   * makes it a quote post of a post the author can currently see. Members named
   * with @handle in `text` are recorded and told (see `recordMentions`), and
   * its #hashtags recorded (see `recordHashtags`).
   */
  async create(
    authorId: string,
    text: string,
    {
      replyTo,
      communitySlug,
      images = [],
      quote,
      poll,
      replyAudience = 'everyone',
      anyMember = false,
      alongside,
    }: {
      replyTo?: string
      communitySlug?: string
      images?: PostImageInput[]
      quote?: string
      poll?: PollInput
      replyAudience?: ReplyAudience
      /** Any member may post in the community, joined or not (the ideas board). */
      anyMember?: boolean
      /** More to write in the same transaction, once the post has its ID. */
      alongside?: (tx: Transaction, id: string) => Promise<void>
    } = {},
  ): Promise<{ id: string; linkUrl: string | null }> {
    let parent: { id: string; authorId: string; rootId: string | null; communityId: string | null } | undefined
    let communityId: string | null = null
    let quoted: { id: string; authorId: string } | undefined

    if (quote) {
      // The same test as for replying: live, by an active member, no block either way.
      ;[quoted] = await this.db
        .select({ id: posts.id, authorId: posts.authorId })
        .from(posts)
        .innerJoin(members, eq(members.id, posts.authorId))
        .where(
          and(
            eq(posts.id, quote),
            live,
            eq(members.active, true),
            sql`not ${blockedEitherWay(authorId, sql`"posts"."author_id"`)}`,
          ),
        )
      if (!quoted) throw new QuotedPostNotFoundError('the post you are quoting is no longer available')
    }

    if (replyTo) {
      // You can only reply to something a reader could currently see.
      ;[parent] = await this.db
        .select({ id: posts.id, authorId: posts.authorId, rootId: posts.rootId, communityId: posts.communityId })
        .from(posts)
        .innerJoin(members, eq(members.id, posts.authorId))
        .where(
          and(
            eq(posts.id, replyTo),
            live,
            eq(members.active, true),
            sql`not ${blockedEitherWay(authorId, sql`"posts"."author_id"`)}`,
          ),
        )
      if (!parent) throw new ParentNotFoundError('the post you are replying to no longer exists')
      communityId = parent.communityId
    } else if (communitySlug) {
      const [community] = await this.db
        .select({
          id: communities.id,
          joined: sql<boolean>`exists(select 1 from community_memberships cm where cm.community_id = "communities"."id" and cm.member_id = ${authorId})`,
        })
        .from(communities)
        .where(and(eq(communities.slug, communitySlug), eq(communities.active, true)))
      if (!community) throw new CommunityNotFoundError('no such community')
      if (!community.joined && !anyMember) throw new NotACommunityMemberError('join the community to post in it')
      communityId = community.id
    }

    // The first web address gets a preview card; asking for it is up to the caller,
    // once the post exists (see `LinksService.request`).
    const linkUrl = previewUrlOf(text)
    return this.db.transaction(async (tx) => {
      if (parent) {
        // Locking the root waits out a change to its reply audience, so a reply
        // already in flight cannot slip past a new restriction. Only the root
        // post's row is locked: locking its author's member row too would block
        // every write that refers to them, and deadlock two members replying in
        // each other's conversations. A root that is gone restricts no one.
        const [root] = await tx
          .select({ allowed: canReplyTo(authorId, sql`${posts.id}`, sql`null`) })
          .from(posts)
          .where(eq(posts.id, parent.rootId ?? parent.id))
          .for('no key update')
        if (root && !root.allowed) throw new ReplyNotAllowedError('the conversation author limited who can reply')
      }
      const [row] = await tx
        .insert(posts)
        .values({
          authorId,
          text,
          linkUrl,
          communityId,
          replyParentId: parent?.id ?? null,
          rootId: parent ? (parent.rootId ?? parent.id) : null,
          quotePostId: quoted?.id ?? null,
          replyAudience: parent ? 'everyone' : replyAudience,
        })
        .returning({ id: posts.id })
      if (poll) {
        await tx.insert(postPolls).values({ postId: row!.id, multiple: poll.multiple, expiresAt: pollExpiresAt(poll.expiresIn) })
        // `pollInput` already refused options that differ only in case, but the
        // database folds case its own way (to it 'İ' and 'i' are the same letter).
        const added = await tx
          .insert(pollOptions)
          .values(poll.options.map((option, position) => ({ postId: row!.id, position, text: option })))
          .onConflictDoNothing()
          .returning({ id: pollOptions.id })
        if (added.length !== poll.options.length) throw new PollOptionsError('poll options must be different')
      }
      for (const [position, image] of images.entries()) {
        const attached = await tx
          .update(media)
          .set({ postId: row!.id, position, alt: image.alt })
          .where(
            and(
              eq(media.id, image.id),
              eq(media.ownerId, authorId),
              eq(media.kind, 'post_image'),
              eq(media.status, 'ready'),
              isNull(media.postId),
            ),
          )
          .returning({ id: media.id })
        if (attached.length === 0) throw new ImagesNotReadyError('an image is missing, still processing or already used')
      }
      await recordHashtags(tx, { id: row!.id, text })
      // Someone told about this post as a reply or a quote is not told again that
      // it mentions them, and only the first few others named are told at all.
      const mentioned = (await recordMentions(tx, { id: row!.id, authorId, text }))
        .filter((id) => id !== parent?.authorId && id !== quoted?.authorId)
        .slice(0, MENTIONS_NOTIFIED_MAX)
      await notify(tx, [
        ...(parent ? [{ recipientId: parent.authorId, kind: 'reply' as const, actorId: authorId, postId: row!.id }] : []),
        // A reply that quotes the post it answers notifies once, as a reply.
        ...(quoted && quoted.authorId !== parent?.authorId
          ? [{ recipientId: quoted.authorId, kind: 'quote' as const, actorId: authorId, postId: row!.id }]
          : []),
        ...mentioned.map((recipientId) => ({ recipientId, kind: 'mention' as const, actorId: authorId, postId: row!.id })),
      ])
      await alongside?.(tx, row!.id)
      return { id: row!.id, linkUrl }
    })
  }

  /** Changes only future replies. Existing replies remain in the conversation. */
  async setReplyAudience(authorId: string, postId: string, audience: ReplyAudience): Promise<boolean> {
    const changed = await this.db
      .update(posts)
      .set({ replyAudience: audience })
      .where(and(
        eq(posts.id, postId),
        eq(posts.authorId, authorId),
        isNull(posts.replyParentId),
        live,
      ))
      .returning({ id: posts.id })
    return changed.length > 0
  }

  /** Records one immutable ballot. A multiple-choice ballot creates several option rows atomically. */
  async votePoll(memberId: string, postId: string, requestedOptionIds: string[]): Promise<void> {
    const optionIds = [...new Set(requestedOptionIds)]
    if (optionIds.length === 0 || optionIds.length > POLL_OPTIONS_MAX) throw new PollOptionsError('choose at least one poll option')
    await this.db.transaction(async (tx) => {
      // Locking the poll's row makes a member's two ballots sent at once take
      // turns, so the second sees the first below. Only that row: locking the
      // post or its author's member row as well would hold up every write that
      // refers to them, and deadlock two members voting on each other's polls.
      const [poll] = await tx
        .select({ multiple: postPolls.multiple, expiresAt: postPolls.expiresAt })
        .from(postPolls)
        .innerJoin(posts, eq(posts.id, postPolls.postId))
        .innerJoin(members, eq(members.id, posts.authorId))
        .where(and(eq(postPolls.postId, postId), pollReadableBy(memberId)))
        .for('update', { of: postPolls })
      if (!poll) throw new PollNotFoundError('the poll is no longer available')
      if (poll.expiresAt && poll.expiresAt <= new Date()) throw new PollClosedError('the poll has ended')
      if (!poll.multiple && optionIds.length !== 1) throw new PollOptionsError('choose one poll option')

      const valid = await tx
        .select({ id: pollOptions.id })
        .from(pollOptions)
        .where(and(eq(pollOptions.postId, postId), inArray(pollOptions.id, optionIds)))
      if (valid.length !== optionIds.length) throw new PollOptionsError('one of those poll options does not exist')

      const [existing] = await tx
        .select({ optionId: pollVotes.optionId })
        .from(pollVotes)
        .where(and(eq(pollVotes.postId, postId), eq(pollVotes.memberId, memberId)))
        .limit(1)
      if (existing) throw new PollAlreadyVotedError('your vote has already been recorded')
      await tx.insert(pollVotes).values(optionIds.map((optionId) => ({ postId, optionId, memberId })))
    })
  }

  /** Public ballots, one member per row, newest first. */
  async pollVoters(viewerId: string | null, postId: string, limit: number, cursor?: string): Promise<PollVoterPage | null> {
    const [visible] = await this.db
      .select({ postId: postPolls.postId })
      .from(postPolls)
      .innerJoin(posts, eq(posts.id, postPolls.postId))
      .innerJoin(members, eq(members.id, posts.authorId))
      .where(and(eq(postPolls.postId, postId), pollReadableBy(viewerId)))
    if (!visible) return null
    let before = sql`true`
    if (cursor) {
      const [createdAt, memberId] = decodeExactCursor(cursor)
      before = sql`(pv.created_at, pv.member_id) < (${createdAt}::timestamptz, ${memberId}::uuid)`
    }
    type BallotRow = {
      member_id: string
      handle: string
      display_name: string | null
      avatar_media_id: string | null
      option_ids: string[]
      created_at: Date
      cursor_timestamp: string
    }
    // A ballot's votes are written together and share created_at, so walking
    // poll_votes_ballot_idx newest first finds one page of ballots without
    // reading the rest of the poll; only that page's choices are gathered.
    const { rows } = await this.db.execute<BallotRow>(sql`
      with page as (
        select pv.member_id, pv.created_at
        from poll_votes pv
        where pv.post_id = ${postId} and ${before}
          and exists(select 1 from members voter where voter.id = pv.member_id and voter.active)
        group by pv.created_at, pv.member_id
        order by pv.created_at desc, pv.member_id desc
        limit ${limit + 1}
      )
      select page.member_id, m.handle, m.display_name, m.avatar_media_id, page.created_at,
        (select json_agg(v.option_id order by po.position)
          from poll_votes v join poll_options po on po.post_id = v.post_id and po.id = v.option_id
          where v.post_id = ${postId} and v.member_id = page.member_id) as option_ids,
        to_char(page.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_timestamp
      from page join members m on m.id = page.member_id
      order by page.created_at desc, page.member_id desc`)
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      voters: page.map((row) => ({
        member: {
          id: row.member_id,
          handle: row.handle,
          displayName: row.display_name,
          avatar: avatarPath(row.avatar_media_id),
        },
        optionIds: row.option_ids,
        createdAt: row.created_at,
      })),
      cursor: rows.length > limit && last ? encodeExactCursor(last.cursor_timestamp, last.member_id) : null,
    }
  }

  /** Soft-deletes the post only if it belongs to `authorId`. */
  async remove(authorId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(posts)
      .set({ deletedAt: new Date() })
      .where(and(eq(posts.id, id), eq(posts.authorId, authorId), isNull(posts.deletedAt)))
      .returning({ id: posts.id })
    return rows.length > 0
  }

  /** Idempotent. False if the post is not there to be liked. */
  async like(memberId: string, postId: string): Promise<boolean> {
    const [visible] = await this.select(memberId, eq(posts.id, postId), { limit: 1 })
    if (!visible) return false
    await this.db.insert(likes).values({ memberId, postId }).onConflictDoNothing()
    await notify(this.db, [{ recipientId: visible.authorId, kind: 'like', actorId: memberId, postId }])
    return true
  }

  /** Idempotent. */
  async unlike(memberId: string, postId: string): Promise<void> {
    await this.db.delete(likes).where(and(eq(likes.memberId, memberId), eq(likes.postId, postId)))
  }

  /**
   * Idempotent: reposting again keeps the first repost and its place in feeds.
   * False if the post is not there to be reposted.
   */
  async repost(memberId: string, postId: string): Promise<boolean> {
    const [visible] = await this.select(memberId, eq(posts.id, postId), { limit: 1 })
    if (!visible) return false
    await this.db.insert(reposts).values({ memberId, postId }).onConflictDoNothing()
    await notify(this.db, [{ recipientId: visible.authorId, kind: 'repost', actorId: memberId, postId }])
    return true
  }

  /** Idempotent. */
  async unrepost(memberId: string, postId: string): Promise<void> {
    await this.db.delete(reposts).where(and(eq(reposts.memberId, memberId), eq(reposts.postId, postId)))
  }

  /** Idempotent. False if the post is not there to be saved. */
  async bookmark(memberId: string, postId: string): Promise<boolean> {
    const [visible] = await this.select(memberId, eq(posts.id, postId), { limit: 1 })
    if (!visible) return false
    await this.db.insert(bookmarks).values({ memberId, postId }).onConflictDoNothing()
    return true
  }

  /** Idempotent. */
  async unbookmark(memberId: string, postId: string): Promise<void> {
    await this.db.delete(bookmarks).where(and(eq(bookmarks.memberId, memberId), eq(bookmarks.postId, postId)))
  }
}
