import Link from 'next/link'
import type { ReactNode } from 'react'
import { deletePost, setBlock, setBookmark, setCommunityPin, setMute, setProfilePin, setReplyAudience } from '@/app/actions'
import type { Post } from '@/lib/api'
import { textParts } from '@/lib/mentions'
import { excerpt } from '@/lib/previews'
import { Avatar } from './avatar'
import { EmptyState } from './empty-state'
import type { FeedSource } from './feed-source'
import { FounderBadge } from './founder-badge'
import { BookmarkIcon, BubbleIcon, DotsIcon, HeartIcon, PinIcon, RepostIcon } from './icons'
import { LikeButton } from './like-button'
import { LinkCard } from './link-card'
import { Menu } from './menu'
import { MorePosts } from './more-posts'
import { PollCard } from './poll-card'
import { PostImages } from './post-images'
import { PostPermalink } from './post-permalink'
import { PostText } from './post-text'
import { QuotedPostCard } from './quoted-post'
import { ReplyLink } from './reply-link'
import { RepostButton } from './repost-button'
import { ShareButton } from './share-button'
import { SubmitButton } from './submit-button'
import { ThreadAuthorLabel } from './thread-author'
import { exactTime, postedAt, timeAgo } from './time'

/** The shared surface for forms, cases and other distinct objects. */
export const card = 'square-card'

/** What someone the reader follows did, in Discover's reason line. */
const VIA_ACTION: Record<NonNullable<Post['via']>['action'], string> = {
  replied: 'replied',
  quoted: 'quoted this',
  reposted: 'reposted',
}

const REPLY_AUDIENCE_LABEL = {
  everyone: 'Everyone can reply',
  following: 'People you follow can reply',
  mentioned: 'Only people mentioned can reply',
} satisfies Record<Post['replyAudience'], string>

export function PostItem({
  post,
  viewerId,
  now,
  focused = false,
  inThread = false,
  hideCommunity = false,
  explain = false,
  replyAction,
  threadToggle,
  pinned,
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
  /** Home feeds say why every post is there, not only the ones the Following feed picked. */
  explain?: boolean
  /** A thread supplies an in-place target picker; ordinary feeds retain navigation. */
  replyAction?: ReactNode
  /** A thread's control for the replies under this one, after the counts. */
  threadToggle?: ReactNode
  /** Shown above the list as the profile's or the community's pinned post. */
  pinned?: 'profile' | 'community'
}) {
  if (post.deleted) {
    return <p className="post-card text-sm italic text-muted">This post is no longer available.</p>
  }

  const href = `/p/${post.id}`
  const compact = inThread && !focused
  const openLabel = `Open ${post.replyParentId ? 'reply' : 'post'} by @${post.authorHandle}`
  const parts = textParts(post.text, post.mentions, post.links, post.hashtags)
  // Text with links of its own cannot sit inside the post's permalink.
  const rich = parts.some((part) => part.handle || part.tag || part.href)
  const likes = post.likeCount === 1 ? '1 like' : `${post.likeCount} likes`
  const reposts = post.repostCount === 1 ? '1 repost' : `${post.repostCount} reposts`
  const community = post.community ? (
    <Link prefetch={false} href={`/c/${post.community.slug}`} className="font-semibold text-accent-strong hover:underline">
      {post.community.name}
    </Link>
  ) : null
  const reposter = post.reason === 'repost' ? post.repostedBy : null
  const why =
    pinned ? (
      <span className="inline-flex items-center gap-1.5">
        <PinIcon size={13} />
        {pinned === 'community' ? 'Pinned by the moderators' : 'Pinned'}
      </span>
    ) : reposter ? (
      <span className="inline-flex items-center gap-1.5">
        <RepostIcon size={13} />
        {reposter.id === viewerId ? (
          'You reposted'
        ) : (
          <span>
            <Link prefetch={false} href={`/u/${reposter.handle}`} className="font-semibold text-accent-strong hover:underline">
              @{reposter.handle}
            </Link>{' '}
            reposted
          </span>
        )}
      </span>
    ) : post.reason === 'network' && post.via ? (
      <span>
        <Link prefetch={false} href={`/u/${post.via.handle}`} className="font-semibold text-accent-strong hover:underline">
          @{post.via.handle}
        </Link>{' '}
        {VIA_ACTION[post.via.action]}
        {post.via.others ? `, and ${post.via.others === 1 ? '1 other' : `${post.via.others} others`} you follow joined in` : null}
      </span>
    ) : post.reason === 'own' && explain ? (
      <>Your post</>
    ) : post.reason === 'active' ? (
      <>Active on HeyNaija</>
    ) : post.reason === 'recent' ? (
      <>New on HeyNaija</>
    ) : post.reason === 'following' ? (
      <>You follow @{post.authorHandle}</>
    ) : post.reason === 'community' && community ? (
      <>From {community}, which you joined</>
    ) : explain && community ? (
      <>Posted in {community}</>
    ) : null
  // A community's moderators keep one post at its top; the menu offers it to them anywhere.
  const communityPin =
    post.viewerCanPinInCommunity && post.community ? (
      <form action={setCommunityPin}>
        <input type="hidden" name="id" value={post.id} />
        <input type="hidden" name="on" value={post.pinnedInCommunity ? '0' : '1'} />
        <SubmitButton className="menu-item">
          {post.pinnedInCommunity ? `Unpin from ${post.community.name}` : `Pin to the top of ${post.community.name}`}
        </SubmitButton>
      </form>
    ) : null
  // The reason line already links the community when it names it; a chip would say it twice.
  const namesOther = post.reason !== null && post.reason !== 'community'
  const showChip = post.community && !hideCommunity && !compact && !(why && !namesOther && !reposter)

  return (
    <article id={`post-${post.id}`} className={`post-card ${focused ? 'is-focused' : 'is-clickable'}${compact ? ' is-reply' : ''}`}>
      {why ? <p className="post-context">{why}</p> : null}

      <div className="post-header flex gap-3">
        <Link prefetch={false} href={`/u/${post.authorHandle}`} tabIndex={-1} aria-hidden="true" className="h-fit rounded-full">
          <Avatar handle={post.authorHandle} src={post.authorAvatar} size={compact ? 32 : 42} />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="post-identity min-w-0">
              <p className="post-author flex items-center gap-1 text-[14px] leading-5">
                <Link prefetch={false} href={`/u/${post.authorHandle}`} className="block min-w-0 max-w-full truncate hover:underline">
                  <span className="truncate font-semibold">{post.authorName ?? `@${post.authorHandle}`}</span>
                </Link>
                {post.authorFounder ? <FounderBadge /> : null}
              </p>
              {compact ? <ThreadAuthorLabel authorId={post.authorId} /> : null}
              <p className="post-meta">
                {post.authorName && !compact ? <><span className="truncate">@{post.authorHandle}</span><span aria-hidden="true">·</span></> : null}
                <Link prefetch={false} href={href} className="shrink-0 hover:underline">
                  <time dateTime={post.createdAt} title={exactTime(post.createdAt)}>
                    {focused ? postedAt(post.createdAt) : timeAgo(post.createdAt, now)}
                  </time>
                </Link>
              </p>
              {showChip ? (
                <Link prefetch={false} href={`/c/${post.community!.slug}`} className="chip mt-1.5">
                  {post.community!.name}
                </Link>
              ) : null}
            </div>

            {viewerId ? (
              <Menu label="Post options" trigger={<DotsIcon />} className="-mr-2 -mt-1.5">
                {compact ? (
                  <form action={setBookmark}>
                    <input type="hidden" name="id" value={post.id} />
                    <input type="hidden" name="on" value={post.viewerBookmarked ? '0' : '1'} />
                    <SubmitButton className="menu-item" pressed={post.viewerBookmarked}>
                      <BookmarkIcon size={18} />
                      {post.viewerBookmarked ? 'Remove bookmark' : 'Bookmark'}
                    </SubmitButton>
                  </form>
                ) : null}
                {post.authorId === viewerId ? (
                  <>
                    {post.replyParentId ? null : (
                      <>
                        <form action={setProfilePin}>
                          <input type="hidden" name="id" value={post.id} />
                          <input type="hidden" name="on" value={post.pinnedOnProfile ? '0' : '1'} />
                          <SubmitButton className="menu-item">
                            {post.pinnedOnProfile ? 'Unpin from your profile' : 'Pin to your profile'}
                          </SubmitButton>
                        </form>
                        {(['everyone', 'following', 'mentioned'] as const).map((audience) => (
                          <form action={setReplyAudience} key={audience}>
                            <input type="hidden" name="id" value={post.id} />
                            <input type="hidden" name="audience" value={audience} />
                            <SubmitButton className="menu-item" pressed={post.replyAudience === audience}>
                              {REPLY_AUDIENCE_LABEL[audience]}
                            </SubmitButton>
                          </form>
                        ))}
                      </>
                    )}
                    {communityPin}
                    <form action={deletePost}>
                      <input type="hidden" name="id" value={post.id} />
                      <SubmitButton
                        className="menu-item menu-item-danger"
                        confirmMessage="Delete this post? This cannot be undone."
                      >
                        Delete post
                      </SubmitButton>
                    </form>
                  </>
                ) : (
                  <>
                    {communityPin}
                    <Link prefetch={false} href={`/report?post=${post.id}`} className="menu-item">
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
        </div>
      </div>

      {post.replyParentId && !inThread && !focused ? (
        <Link prefetch={false} href={`/p/${post.replyParentId}`} className="mt-1 block text-xs text-muted hover:underline">
          Replying to a post
        </Link>
      ) : null}

      {post.text ? (
        <p className={`mt-3 whitespace-pre-wrap break-words ${focused ? 'text-base leading-relaxed' : 'post-body'}`}>
          {focused ? (
            <PostText parts={parts} />
          ) : rich ? (
            <PostPermalink href={href} label={openLabel} beside>
              <PostText parts={parts} />
            </PostPermalink>
          ) : (
            <PostPermalink href={href}>{post.text}</PostPermalink>
          )}
        </p>
      ) : !focused ? <PostPermalink href={href} label={openLabel}><span className="sr-only">Open conversation</span></PostPermalink> : null}
      {post.poll ? <PollCard postId={post.id} poll={post.poll} member={viewerId !== null} /> : null}
      {post.images.length ? (
        <div className="mt-3">
          <PostImages images={post.images} />
        </div>
      ) : null}
      {post.quote ? (
        <div className="mt-3">
          <QuotedPostCard quote={post.quote} now={now} />
        </div>
      ) : null}
      {/* A card for the first address, unless the post already has pictures or a quote to show. */}
      {post.linkPreview && !post.images.length && !post.quote ? (
        <div className="mt-3">
          <LinkCard preview={post.linkPreview} />
        </div>
      ) : null}
      {!post.replyParentId && post.replyAudience !== 'everyone' ? (
        <p className="reply-audience-note"><BubbleIcon size={14} /> {REPLY_AUDIENCE_LABEL[post.replyAudience]}</p>
      ) : null}

      <div className="post-actions">
        {replyAction ?? <ReplyLink id={post.id} href={`${href}#compose`} count={post.replyCount} disabled={viewerId !== null && !post.viewerCanReply} />}

        {viewerId ? (
          <RepostButton id={post.id} reposted={post.viewerReposted} count={post.repostCount} />
        ) : (
          <span className="icon-btn pointer-events-none">
            <RepostIcon size={18} />
            <span aria-hidden="true" className="tabular-nums">{post.repostCount}</span>
            <span className="sr-only">{reposts}</span>
          </span>
        )}

        {viewerId ? (
          <LikeButton id={post.id} liked={post.viewerLiked} count={post.likeCount} />
        ) : (
          <span className="icon-btn pointer-events-none">
            <HeartIcon size={18} />
            <span aria-hidden="true" className="tabular-nums">{post.likeCount}</span>
            <span className="sr-only">{likes}</span>
          </span>
        )}

        {threadToggle}

        <div className="post-actions-end">
          {viewerId && !compact ? (
            <form action={setBookmark}>
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
          <ShareButton id={post.id} handle={post.authorHandle} name={post.authorName} avatar={post.authorAvatar} text={excerpt(post.text)} />
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
  more,
  hideCommunity,
  explain,
  end,
}: {
  posts: Post[]
  viewerId: string | null
  now: number
  /** Shown when there are no posts: a short title, optionally with more detail and a next step. */
  empty: { title: string; detail?: ReactNode; action?: ReactNode }
  /** The feed these posts come from and where they end, so older posts can load onto the list. */
  more?: { source: FeedSource; cursor: string | null }
  hideCommunity?: boolean
  explain?: boolean
  /** Said where the list ends, in place of "No older posts". */
  end?: ReactNode
}) {
  if (posts.length === 0) {
    return (
      <EmptyState icon={<BubbleIcon size={22} />} title={empty.title} action={empty.action}>
        {empty.detail}
      </EmptyState>
    )
  }
  return (
    <>
      <ul className="post-list">
        {posts.map((post) => (
          <li key={post.id}>
            <PostItem post={post} viewerId={viewerId} now={now} hideCommunity={hideCommunity} explain={explain} />
          </li>
        ))}
      </ul>
      {more ? (
        <MorePosts source={more.source} cursor={more.cursor} version={now} shown={posts.map((post) => post.id)} end={end} />
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
