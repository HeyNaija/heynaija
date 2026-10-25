import {
  bookmarks,
  communities,
  type Db,
  likes,
  media,
  members,
  postHashtags,
  posts,
  reposts,
} from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { findLinks, type FoundLink, previewUrlOf } from '../links/link-text.js'
import { type LinkPreview, type LinkPreviewRow, linkPreviewOf, toLinkPreview } from '../links/links.service.js'
import { ALT_MAX, avatarPath, POST_IMAGES_MAX, postImagePath } from '../media/media.service.js'
import { decodeCursor, decodeExactCursor, encodeCursor, encodeExactCursor, InvalidCursorError } from '../cursor.js'
import { notify } from '../notifications/notifications.service.js'
import { graphemes } from '../text.js'
import { Refreshing } from '../refreshing.js'
import { DB } from '../tokens.js'
import { hashtagsOf, type PostHashtag, recordHashtags } from './hashtags.js'
import { MENTIONS_NOTIFIED_MAX, mentionsOf, type PostMention, recordMentions } from './mentions.js'
import { decodeReplyCursor, encodeReplyCursor } from './reply-cursor.js'

export const POST_MAX_GRAPHEMES = 300

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
    })
    .refine((p) => p.text.length > 0 || p.images.length > 0, { message: 'post is empty', path: ['text'] })

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
      text: string
      images: PostImage[]
      createdAt: Date
      replyParentId: string | null
    }
  // Deleted, taken down, by an inactive member, or by someone the reader blocked,
  // was blocked by or muted. One placeholder for all, so it gives nothing away.
  | { unavailable: true }

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
   * Why it is in the viewer's Following feed. On a profile, 'repost' marks the
   * member's reposts. Null everywhere else.
   */
  reason: FeedReason | null
  /** Who reposted it, when `reason` is 'repost'. */
  repostedBy: { id: string; handle: string; displayName: string | null } | null
}

export type FeedReason = 'own' | 'following' | 'community' | 'repost'

/** The lists on a member's profile: top-level posts, replies, and posts with images. */
export const PROFILE_FILTERS = ['posts', 'replies', 'media'] as const
export type ProfileFilter = (typeof PROFILE_FILTERS)[number]

export type PostPage = { posts: PostView[]; cursor: string | null }

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

const topLevel = isNull(posts.replyParentId)

// Neither deleted by the author nor taken down by a moderator.
const live = and(isNull(posts.deletedAt), isNull(posts.removedAt))

/**
 * Shared eligibility for ordinary posts, reply nodes, branch parents, quoted posts
 * and reposters. `unmuted` is a member shown even if the viewer muted them: the
 * one whose profile they opened.
 */
const visibleAuthor = (viewerId: string | null, authorId: SQL, active: SQL, unmuted?: string) =>
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
    'authorAvatarId', qa.avatar_media_id, 'text', q.text, 'images', ${imagesOf(sql`q.id`)},
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
        text: sql<string>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${posts.text} else '' end`,
        images: sql<
          ImageRow[]
        >`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${imagesOf(outerId)} else '[]'::json end`,
        mentions: sql<PostMention[]>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${mentionsOf(viewerId, outerId)} else '[]'::json end`,
        hashtags: sql<PostHashtag[]>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${hashtagsOf(outerId)} else '[]'::json end`,
        linkPreview: sql<LinkPreviewRow | null>`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${linkPreviewOf(sql`"posts"."link_url"`)} end`,
        createdAt: posts.createdAt,
        replyParentId: posts.replyParentId,
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

    return rows.map(({ communitySlug, communityName, authorAvatarId, images, quote, linkPreview, ...row }) => ({
      ...row,
      images: toPostImages(images),
      links: findLinks(row.text),
      linkPreview: toLinkPreview(linkPreview),
      authorAvatar: avatarPath(authorAvatarId),
      community: communitySlug && communityName ? { slug: communitySlug, name: communityName } : null,
      quote: toQuote(quote),
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

  /** A post with the conversation above it and the direct replies below it. */
  async thread(viewerId: string | null, id: string): Promise<Thread | null> {
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
        ? this.select(viewerId, inArray(posts.id, ancestorIds), { includeDeleted: true })
        : Promise.resolve([]),
      this.replyPage(viewerId, id, REPLY_PAGE_SIZE),
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
    const [post] = await this.select(viewerId, eq(posts.id, id), { limit: 1 })
    return post ?? null
  }

  /** A parent is checked afresh, including when its structural stub was loaded earlier. */
  async replies(viewerId: string | null, parentId: string, limit = REPLY_PAGE_SIZE, cursor?: string): Promise<ReplyPage | null> {
    // Validate even when the parent is unavailable. A cursor grants no access.
    if (cursor) decodeReplyCursor(cursor, parentId)
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
    return this.replyPage(viewerId, parentId, Math.min(REPLY_PAGE_SIZE, Math.max(1, limit)), cursor)
  }

  /** One bounded sibling query, followed by live-row hydration inside that statement. */
  private async replyPage(viewerId: string | null, parentId: string, limit: number, cursor?: string): Promise<ReplyPage> {
    const after = cursor ? decodeReplyCursor(cursor, parentId) : null
    type ReplyRow = {
      id: string
      reply_parent_id: string | null
      created_at: Date
      cursor_timestamp: string
      view: (Omit<PostView, 'images' | 'createdAt' | 'authorAvatar' | 'quote' | 'links' | 'linkPreview'> & {
        images: ImageRow[]
        createdAt: string
        authorAvatarId: string | null
        quote: QuoteRow | null
        linkPreview: LinkPreviewRow | null
      }) | null
    }
    const { rows } = await this.db.execute<ReplyRow>(sql`
      with page as materialized (
        select p.id, p.reply_parent_id, p.created_at,
          p.deleted_at is not null or p.removed_at is not null as unavailable
        from posts p join members a on a.id = p.author_id
        where p.reply_parent_id = ${parentId}
          and ${visibleAuthor(viewerId, sql`p.author_id`, sql`a.active`)}
          and ((p.deleted_at is null and p.removed_at is null)
            or exists(select 1 from posts child where child.reply_parent_id = p.id))
          ${after ? sql`and (p.created_at, p.id) > (${after[0]}::timestamptz, ${after[1]}::uuid)` : sql``}
        order by p.created_at asc, p.id asc
        limit ${limit + 1}
      )
      select page.id, page.reply_parent_id, page.created_at,
        to_char(page.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_timestamp,
        case when page.unavailable then null else json_build_object(
          'id', p.id, 'authorId', p.author_id, 'authorHandle', a.handle,
          'authorName', a.display_name, 'authorAvatarId', a.avatar_media_id,
          'text', p.text, 'images', ${imagesOf(sql`p.id`)}, 'mentions', ${mentionsOf(viewerId, sql`p.id`)},
          'hashtags', ${hashtagsOf(sql`p.id`)},
          'linkPreview', ${linkPreviewOf(sql`p.link_url`)},
          'createdAt', p.created_at, 'replyParentId', p.reply_parent_id,
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
      order by page.created_at asc, page.id asc`)
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
        const { images, createdAt, authorAvatarId, quote, linkPreview, ...post } = row.view
        return {
          ...post,
          images: toPostImages(images),
          links: findLinks(post.text),
          linkPreview: toLinkPreview(linkPreview),
          createdAt: new Date(createdAt),
          authorAvatar: avatarPath(authorAvatarId),
          quote: toQuote(quote),
        }
      }),
      cursor: rows.length > limit && last ? encodeReplyCursor(parentId, last.cursor_timestamp, last.id) : null,
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
    }: { replyTo?: string; communitySlug?: string; images?: PostImageInput[]; quote?: string } = {},
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
      if (!community.joined) throw new NotACommunityMemberError('join the community to post in it')
      communityId = community.id
    }

    // The first web address gets a preview card; asking for it is up to the caller,
    // once the post exists (see `LinksService.request`).
    const linkUrl = previewUrlOf(text)
    return this.db.transaction(async (tx) => {
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
        })
        .returning({ id: posts.id })
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
      return { id: row!.id, linkUrl }
    })
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
