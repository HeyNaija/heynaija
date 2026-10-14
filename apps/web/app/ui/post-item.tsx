import Link from 'next/link'
import type { ReactNode } from 'react'
import { deletePost, setBlock, setBookmark, setLike, setMute } from '@/app/actions'
import type { Post } from '@/lib/api'
import { Avatar } from './avatar'
import { EmptyState } from './empty-state'
import { BookmarkIcon, BubbleIcon, DotsIcon, HeartIcon } from './icons'
import { Menu } from './menu'
import { PostImages } from './post-images'
import { SubmitButton } from './submit-button'
import { timeAgo } from './time'

/** A bordered panel, for things that are separate objects (forms, cases). Not for posts. */
export const card = 'square-card'

export function PostItem({
  post,
  viewerId,
  now,
  focused = false,
  inThread = false,
  hideCommunity = false,
}: {
  post: Post
  /** Null for visitors who are not signed-in members. */
  viewerId: string | null
  now: number
  /** The post a thread page is about: shown larger. */
  focused?: boolean
  /** On a thread page the conversation is already on screen, so replies need no pointer to it. */
  inThread?: boolean
  /** On a community's own page, every post is from it; the label would be noise. */
  hideCommunity?: boolean
}) {
  if (post.deleted) {
    return <p className="post-card text-sm italic text-muted">This post is no longer available.</p>
  }

  const href = `/p/${post.id}`
  const likes = post.likeCount === 1 ? '1 like' : `${post.likeCount} likes`
  const replies = post.replyCount === 1 ? '1 reply' : `${post.replyCount} replies`
  const why =
    post.reason === 'following'
      ? `You follow @${post.authorHandle}`
      : post.reason === 'community' && post.community
        ? `From ${post.community.name}, which you joined`
        : null

  return (
    <article id={`post-${post.id}`} className={`post-card ${focused ? 'is-focused' : ''}`}>
      {why ? <p className="mb-2 text-xs font-medium text-muted">{why}</p> : null}

      <div className="flex gap-3">
        <Link href={`/u/${post.authorHandle}`} tabIndex={-1} aria-hidden="true" className="h-fit rounded-full">
          <Avatar handle={post.authorHandle} src={post.authorAvatar} size={36} />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[15px] leading-5">
                <Link href={`/u/${post.authorHandle}`} className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 hover:underline">
                  <span className="truncate font-semibold">{post.authorName ?? `@${post.authorHandle}`}</span>
                  {post.authorName ? <span className="shrink-0 text-[13px] text-muted">@{post.authorHandle}</span> : null}
                </Link>
                <Link href={href} className="shrink-0 text-[13px] text-muted hover:underline">
                  <time dateTime={post.createdAt} title={new Date(post.createdAt).toUTCString()}>
                    {timeAgo(post.createdAt, now)}
                  </time>
                </Link>
              </p>
              {post.community && !hideCommunity ? (
                <Link href={`/c/${post.community.slug}`} className="chip mt-1.5">
                  {post.community.name}
                </Link>
              ) : null}
            </div>

            {viewerId ? (
              <Menu label="Post options" trigger={<DotsIcon />} className="-mr-2 -mt-1.5">
                {post.authorId === viewerId ? (
                  <form action={deletePost}>
                    <input type="hidden" name="id" value={post.id} />
                    <SubmitButton
                      className="menu-item menu-item-danger"
                      confirmMessage="Delete this post? This cannot be undone."
                    >
                      Delete post
                    </SubmitButton>
                  </form>
                ) : (
                  <>
                    <Link href={`/report?post=${post.id}`} className="menu-item">
                      Report post
                    </Link>
                    <form action={setMute}>
                      <input type="hidden" name="handle" value={post.authorHandle} />
                      <input type="hidden" name="on" value="1" />
                      <SubmitButton className="menu-item">Mute @{post.authorHandle}</SubmitButton>
                    </form>
                    <form action={setBlock}>
                      <input type="hidden" name="handle" value={post.authorHandle} />
                      <input type="hidden" name="on" value="1" />
                      <SubmitButton
                        className="menu-item menu-item-danger"
                        confirmMessage={`Block @${post.authorHandle}? You will stop seeing each other's posts.`}
                      >
                        Block @{post.authorHandle}
                      </SubmitButton>
                    </form>
                  </>
                )}
              </Menu>
            ) : null}
          </div>

          {post.replyParentId && !inThread && !focused ? (
            <Link href={`/p/${post.replyParentId}`} className="mt-1 block text-xs text-muted hover:underline">
              Replying to a post
            </Link>
          ) : null}

          {post.text ? (
            <p className={`mt-1.5 whitespace-pre-wrap break-words ${focused ? 'text-base leading-relaxed' : 'post-body'}`}>
              {focused ? post.text : <Link href={href} className="block">{post.text}</Link>}
            </p>
          ) : null}
          {post.images.length ? (
            <div className="mt-3">
              <PostImages images={post.images} />
            </div>
          ) : null}

          <div className="post-actions -ml-2 mt-1.5 flex items-center gap-3">
            <Link href={`${href}#compose`} className="icon-btn" aria-label={replies}>
              <BubbleIcon size={18} />
              <span className="tabular-nums">{post.replyCount}</span>
            </Link>

            {viewerId ? (
              <form action={setLike}>
                <input type="hidden" name="id" value={post.id} />
                <input type="hidden" name="on" value={post.viewerLiked ? '0' : '1'} />
                <SubmitButton
                  className="icon-btn"
                  label={post.viewerLiked ? `Unlike (${likes})` : `Like (${likes})`}
                  pressed={post.viewerLiked}
                >
                  <HeartIcon size={18} filled={post.viewerLiked} />
                  <span className="tabular-nums">{post.likeCount}</span>
                </SubmitButton>
              </form>
            ) : (
              <span className="icon-btn pointer-events-none" aria-label={likes}>
                <HeartIcon size={18} />
                <span className="tabular-nums">{post.likeCount}</span>
              </span>
            )}

            {viewerId ? (
              <form action={setBookmark} className="ml-auto">
                <input type="hidden" name="id" value={post.id} />
                <input type="hidden" name="on" value={post.viewerBookmarked ? '0' : '1'} />
                <SubmitButton
                  className="icon-btn"
                  label={post.viewerBookmarked ? 'Remove bookmark' : 'Bookmark'}
                  pressed={post.viewerBookmarked}
                >
                  <BookmarkIcon size={18} filled={post.viewerBookmarked} />
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export function PostList({
  posts,
  viewerId,
  now,
  empty,
  olderHref,
  hideCommunity,
}: {
  posts: Post[]
  viewerId: string | null
  now: number
  /** Shown when there are no posts: a short title, optionally with more detail. */
  empty: { title: string; detail?: ReactNode }
  /** Link to the next page, when there is one. */
  olderHref: string | null
  hideCommunity?: boolean
}) {
  if (posts.length === 0) {
    return (
      <EmptyState icon={<BubbleIcon size={22} />} title={empty.title}>
        {empty.detail}
      </EmptyState>
    )
  }
  return (
    <>
      <ul className="post-list">
        {posts.map((post) => (
          <li key={post.id}>
            <PostItem post={post} viewerId={viewerId} now={now} hideCommunity={hideCommunity} />
          </li>
        ))}
      </ul>
      {olderHref ? (
        <Link href={olderHref} className="btn btn-secondary btn-block mt-4">
          Older posts
        </Link>
      ) : null}
    </>
  )
}

/** Placeholder shaped like the posts that are about to arrive. */
export function PostsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="post-list">
      {[72, 48, 60].map((width) => (
        <div key={width} className="post-card flex gap-3">
          <span className="skeleton size-10 shrink-0 !rounded-full" />
          <div className="flex-1 space-y-2.5 py-1">
            <span className="skeleton block h-3.5 w-28" />
            <span className="skeleton block h-3.5" style={{ width: `${width}%` }} />
            <span className="skeleton block h-3.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
