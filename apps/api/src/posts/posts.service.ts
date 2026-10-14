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
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ALT_MAX, avatarPath, POST_IMAGES_MAX, postImagePath } from '../media/media.service.js'
import { decodeCursor, encodeCursor, InvalidCursorError } from '../cursor.js'
import { notify } from '../notifications/notifications.service.js'
import { graphemes } from '../text.js'
import { DB } from '../tokens.js'

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

export type PostPage = { posts: PostView[]; cursor: string | null }

export type Thread = { ancestors: PostView[]; post: PostView; replies: PostView[] }

export class ParentNotFoundError extends Error {}
export class CommunityNotFoundError extends Error {}
export { InvalidCursorError }
export class NotACommunityMemberError extends Error {}
export class ImagesNotReadyError extends Error {}

const MAX_THREAD_DEPTH = 50
const MAX_REPLIES_SHOWN = 200
const TRENDING_WINDOW_DAYS = 7

const topLevel = isNull(posts.replyParentId)

// Neither deleted by the author nor taken down by a moderator.
const live = and(isNull(posts.deletedAt), isNull(posts.removedAt))

/** True when either member has blocked the other. */
export const blockedEitherWay = (a: SQL | string, b: SQL | string) =>
  sql<boolean>`exists(select 1 from blocks bl where (bl.blocker_id = ${a} and bl.blocked_id = ${b}) or (bl.blocker_id = ${b} and bl.blocked_id = ${a}))`

// Written out so the outer post is unambiguous inside the count subqueries.
const outerId = sql`"posts"."id"`

// Only active members' likes and replies count, matching what a reader would see.
const likeCount = sql<number>`(select count(*)::int from likes l join members lm on lm.id = l.member_id and lm.active where l.post_id = ${outerId})`
const replyCount = sql<number>`(select count(*)::int from posts r join members rm on rm.id = r.author_id and rm.active where r.reply_parent_id = ${outerId} and r.deleted_at is null and r.removed_at is null)`

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
        likeCount,
        replyCount,
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
          eq(members.active, true),
          opts.includeDeleted ? undefined : live,
          // A viewer never sees posts by anyone they blocked or muted, or who blocked them.
          viewerId ? sql`not ${blockedEitherWay(viewerId, sql`"posts"."author_id"`)}` : undefined,
          viewerId && !opts.ignoreMutes
            ? sql`not exists(select 1 from mutes mu where mu.muter_id = ${viewerId} and mu.muted_id = "posts"."author_id")`
            : undefined,
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

  /** Everything one member has posted, replies included. */
  byAuthor(viewerId: string | null, authorId: string, limit: number, cursor?: string): Promise<PostPage> {
    return this.page(viewerId, eq(posts.authorId, authorId), limit, cursor, { ignoreMutes: true })
  }

  /** The posts a member has saved. Only ever shown to that member. */
  bookmarked(viewerId: string, limit: number, cursor?: string): Promise<PostPage> {
    const saved = this.db
      .select({ id: bookmarks.postId })
      .from(bookmarks)
      .where(eq(bookmarks.memberId, viewerId))
    return this.page(viewerId, inArray(posts.id, saved), limit, cursor)
  }

  /**
   * The conversations people are engaging with this week: top-level posts ranked
   * by replies (weighted double) and likes. Posts with neither are left out.
   */
  trending(viewerId: string | null, limit: number): Promise<PostView[]> {
    const score = sql<number>`(${replyCount} * 2 + ${likeCount})`
    const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 86_400_000)
    return this.select(viewerId, and(topLevel, gt(posts.createdAt, since), sql`${score} > 0`), {
      order: [sql`${score} desc`, desc(posts.createdAt)],
      limit,
    })
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
    const [post] = await this.select(viewerId, eq(posts.id, id), { limit: 1 })
    if (!post) return null

    const chain = await this.db.execute<{ id: string }>(sql`
      with recursive up as (
        select p.id, p.reply_parent_id, 1 as depth from posts p where p.id = ${post.replyParentId}
        union all
        select p.id, p.reply_parent_id, up.depth + 1
        from posts p join up on p.id = up.reply_parent_id
        where up.depth < ${MAX_THREAD_DEPTH}
      )
      select id from up order by depth desc`)
    const ancestorIds = chain.rows.map((r) => r.id)

    const [ancestors, replies] = await Promise.all([
      ancestorIds.length
        ? this.select(viewerId, inArray(posts.id, ancestorIds), { includeDeleted: true })
        : Promise.resolve([]),
      this.select(viewerId, eq(posts.replyParentId, id), {
        order: [asc(posts.createdAt), asc(posts.id)],
        limit: MAX_REPLIES_SHOWN,
      }),
    ])
    // Root first. An ancestor by a now-inactive member is simply absent.
    ancestors.sort((a, b) => ancestorIds.indexOf(a.id) - ancestorIds.indexOf(b.id))
    return { ancestors, post, replies }
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
