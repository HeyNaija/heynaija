import {
  bookmarks,
  communities,
  communityMemberships,
  type Db,
  follows,
  likes,
  media,
  members,
  posts,
} from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ALT_MAX, avatarPath, POST_IMAGES_MAX, postImagePath } from '../media/media.service.js'
import { decodeCursor, encodeCursor, InvalidCursorError } from '../cursor.js'
import { notify } from '../notifications/notifications.service.js'
import { graphemes } from '../text.js'
import { DB } from '../tokens.js'
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
      community: slug.optional(),
      images: postImagesInput,
    })
    .refine((p) => p.text.length > 0 || p.images.length > 0, { message: 'post is empty', path: ['text'] })

export type PostImage = {
  /** Path without the size suffix (see `postImagePath`). */
  src: string
  alt: string
  width: number
  height: number
}

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
  createdAt: Date
  replyParentId: string | null
  likeCount: number
  replyCount: number
  /** Always false for anonymous viewers. */
  viewerLiked: boolean
  /** Always false for anonymous viewers. Bookmarks are private to their owner. */
  viewerBookmarked: boolean
  /**
   * Deleted by its author or taken down by a moderator. Only ever true for
   * ancestors shown in a thread, as a placeholder.
   */
  deleted: boolean
  /** The community it was posted in, if any (and if that community is still active). */
  community: { slug: string; name: string } | null
  /** Why it is in the viewer's Following feed; null everywhere else. */
  reason: FeedReason | null
}

export type FeedReason = 'own' | 'following' | 'community'

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

const MAX_THREAD_DEPTH = 50
const REPLY_PAGE_SIZE = 20
const TRENDING_WINDOW_DAYS = 7
// The ranking is the same for every viewer, so it is computed at most once per
// TTL and each viewer's blocks and mutes are applied to it afterwards. Enough
// candidates are kept that a viewer who blocks or mutes a few of the authors
// still sees a full list.
export const TRENDING_TTL_MS = 60_000
const TRENDING_CANDIDATES = 50

const topLevel = isNull(posts.replyParentId)

// Neither deleted by the author nor taken down by a moderator.
const live = and(isNull(posts.deletedAt), isNull(posts.removedAt))

/** Shared eligibility for ordinary posts, reply nodes and branch parents. */
const visibleAuthor = (viewerId: string | null, authorId: SQL, active: SQL, ignoreMutes = false) =>
  and(
    active,
    viewerId ? sql`not ${blockedEitherWay(viewerId, authorId)}` : undefined,
    viewerId && !ignoreMutes
      ? sql`not exists(select 1 from mutes mu where mu.muter_id = ${viewerId} and mu.muted_id = ${authorId})`
      : undefined,
  )

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
  sql<{ id: string; alt: string; width: number; height: number }[]>`coalesce((select json_agg(json_build_object('id', m.id, 'alt', m.alt, 'width', m.width, 'height', m.height) order by m.position) from media m where m.post_id = ${postId} and m.status = 'ready'), '[]'::json)`

export const toPostImages = (rows: { id: string; alt: string; width: number; height: number }[]): PostImage[] =>
  rows.map(({ id, alt, width, height }) => ({ src: postImagePath(id), alt, width, height }))

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
      /** Show a muted author's posts anyway (when the viewer opens their profile). */
      ignoreMutes?: boolean
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
          { id: string; alt: string; width: number; height: number }[]
        >`case when ${posts.deletedAt} is null and ${posts.removedAt} is null then ${imagesOf(outerId)} else '[]'::json end`,
        createdAt: posts.createdAt,
        replyParentId: posts.replyParentId,
        // Kept on the row by triggers (see the posts schema): only active
        // members' likes and live replies count, as a reader would see them.
        likeCount: posts.likeCount,
        replyCount: posts.replyCount,
        viewerLiked: viewerId
          ? sql<boolean>`exists(select 1 from likes l where l.post_id = ${outerId} and l.member_id = ${viewerId})`
          : sql<boolean>`false`,
        viewerBookmarked: viewerId
          ? sql<boolean>`exists(select 1 from bookmarks b where b.post_id = ${outerId} and b.member_id = ${viewerId})`
          : sql<boolean>`false`,
        deleted: sql<boolean>`${posts.deletedAt} is not null or ${posts.removedAt} is not null`,
        communitySlug: communities.slug,
        communityName: communities.name,
        reason: opts.reason ?? sql<null>`null`,
      })
      .from(posts)
      .innerJoin(members, eq(members.id, posts.authorId))
      .leftJoin(communities, and(eq(communities.id, posts.communityId), eq(communities.active, true)))
      .where(
        and(
          visibleAuthor(viewerId, sql`${posts.authorId}`, sql`${members.active}`, opts.ignoreMutes),
          opts.includeDeleted ? undefined : live,
          where,
        ),
      )
      .orderBy(...(opts.order ?? []))
      .limit(opts.limit ?? 1000)

    return rows.map(({ communitySlug, communityName, authorAvatarId, images, ...row }) => ({
      ...row,
      images: toPostImages(images),
      authorAvatar: avatarPath(authorAvatarId),
      community: communitySlug && communityName ? { slug: communitySlug, name: communityName } : null,
    }))
  }

  /** Newest first, cursor-paginated. */
  private async page(
    viewerId: string | null,
    where: SQL | undefined,
    limit: number,
    cursor?: string,
    extra: { reason?: SQL<FeedReason>; ignoreMutes?: boolean } = {},
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
   * have joined, plus their own. Each post says which of those brought it in.
   */
  followingFeed(viewerId: string, limit: number, cursor?: string): Promise<PostPage> {
    const followed = this.db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(eq(follows.followerId, viewerId))
    const joined = this.db
      .select({ id: communityMemberships.communityId })
      .from(communityMemberships)
      .innerJoin(communities, eq(communities.id, communityMemberships.communityId))
      .where(and(eq(communityMemberships.memberId, viewerId), eq(communities.active, true)))

    const isOwn = eq(posts.authorId, viewerId)
    const isFollowed = inArray(posts.authorId, followed)
    return this.page(
      viewerId,
      and(topLevel, or(isOwn, isFollowed, inArray(posts.communityId, joined))),
      limit,
      cursor,
      { reason: sql<FeedReason>`case when ${isOwn} then 'own' when ${isFollowed} then 'following' else 'community' end` },
    )
  }

  /** Top-level posts in one community. */
  inCommunity(viewerId: string | null, communityId: string, limit: number, cursor?: string): Promise<PostPage> {
    return this.page(viewerId, and(topLevel, eq(posts.communityId, communityId)), limit, cursor)
  }

  /**
   * One list from a member's profile: their top-level posts, their replies, or
   * everything they posted with images (replies included).
   */
  byAuthor(
    viewerId: string | null,
    authorId: string,
    limit: number,
    cursor?: string,
    filter: ProfileFilter = 'posts',
  ): Promise<PostPage> {
    return this.page(viewerId, and(eq(posts.authorId, authorId), profileFilter[filter]), limit, cursor, {
      ignoreMutes: true,
    })
  }

  /** The posts a member has saved. Only ever shown to that member. */
  bookmarked(viewerId: string, limit: number, cursor?: string): Promise<PostPage> {
    const saved = this.db
      .select({ id: bookmarks.postId })
      .from(bookmarks)
      .where(eq(bookmarks.memberId, viewerId))
    return this.page(viewerId, inArray(posts.id, saved), limit, cursor)
  }

  private trendingRanking: { ids: string[]; expiresAt: number } | null = null
  private trendingRefresh: Promise<void> | null = null

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
    const ids = await this.trendingIds()
    if (ids.length === 0) return []
    return this.select(viewerId, inArray(posts.id, ids), {
      order: [sql`array_position(array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[], "posts"."id")`],
      limit,
    })
  }

  /**
   * The cached ranking. Once it is older than `TRENDING_TTL_MS`, one refresh runs
   * in the background and callers keep getting the old ranking until it lands,
   * so no page waits on the ranking query after the first.
   */
  private async trendingIds(): Promise<string[]> {
    const cached = this.trendingRanking
    if (cached && cached.expiresAt > Date.now()) return cached.ids
    this.trendingRefresh ??= this.rankTrending()
      .then((ids) => {
        this.trendingRanking = { ids, expiresAt: Date.now() + TRENDING_TTL_MS }
      })
      .finally(() => {
        this.trendingRefresh = null
      })
    if (!cached) {
      await this.trendingRefresh
      return this.trendingRanking!.ids
    }
    // A failed refresh leaves the old ranking in place; the next call retries.
    this.trendingRefresh.catch(() => {})
    return cached.ids
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
      view: (Omit<PostView, 'images' | 'createdAt' | 'authorAvatar'> & {
        images: { id: string; alt: string; width: number; height: number }[]
        createdAt: string
        authorAvatarId: string | null
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
          'text', p.text, 'images', ${imagesOf(sql`p.id`)},
          'createdAt', p.created_at, 'replyParentId', p.reply_parent_id,
          'likeCount', p.like_count, 'replyCount', p.reply_count,
          'hasReplies', p.reply_count > 0 or exists(select 1 from posts child where child.reply_parent_id = p.id),
          'viewerLiked', ${viewerId ? sql`exists(select 1 from likes l where l.post_id = p.id and l.member_id = ${viewerId})` : sql`false`},
          'viewerBookmarked', ${viewerId ? sql`exists(select 1 from bookmarks b where b.post_id = p.id and b.member_id = ${viewerId})` : sql`false`},
          'deleted', false, 'reason', null,
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
        const { images, createdAt, authorAvatarId, ...post } = row.view
        return { ...post, images: toPostImages(images), createdAt: new Date(createdAt), authorAvatar: avatarPath(authorAvatarId) }
      }),
      cursor: rows.length > limit && last ? encodeReplyCursor(parentId, last.cursor_timestamp, last.id) : null,
    }
  }

  /**
   * `communitySlug` posts into a community the author has joined. A reply always
   * lands in its parent's community (or none), whatever is asked for. `images`
   * must be the author's own uploads, processed and not on another post.
   */
  async create(
    authorId: string,
    text: string,
    {
      replyTo,
      communitySlug,
      images = [],
    }: { replyTo?: string; communitySlug?: string; images?: PostImageInput[] } = {},
  ): Promise<{ id: string }> {
    let parent: { id: string; authorId: string; rootId: string | null; communityId: string | null } | undefined
    let communityId: string | null = null

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

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(posts)
        .values({
          authorId,
          text,
          communityId,
          replyParentId: parent?.id ?? null,
          rootId: parent ? (parent.rootId ?? parent.id) : null,
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
      if (parent) await notify(tx, [{ recipientId: parent.authorId, kind: 'reply', actorId: authorId, postId: row!.id }])
      return row!
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
