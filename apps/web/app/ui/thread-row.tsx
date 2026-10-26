import type { Post, ThreadReply } from '@/lib/api'
import type { ThreadRow } from '@/lib/thread-state'
import { PostItem } from './post-item'
import { ThreadBranch, ThreadReplyAction, ThreadToggle } from './thread-conversation'

export function renderThreadRow(
  post: ThreadReply,
  viewerId: string | null,
  now: number,
  depth: number,
  parentHandle: string | null,
  root = false,
): ThreadRow {
  const unavailable = post.unavailable === true
  return {
    id: post.id,
    // The API puts the parent's author's live replies first; this tells a new one where to go.
    lead: !unavailable && parentHandle !== null && post.authorHandle === parentHandle,
    node: (
      <ThreadBranch
        key={post.id}
        id={post.id}
        parentId={post.replyParentId}
        handle={unavailable ? null : post.authorHandle}
        replyCount={unavailable ? null : post.replyCount}
        hasReplies={unavailable || post.hasReplies === true || post.replyCount > 0}
        depth={depth}
        root={root}
      >
        {unavailable ? (
          <article id={`post-${post.id}`} className="post-card is-reply thread-unavailable">
            <p className="text-sm italic text-muted">This post is no longer available.</p>
            <div className="post-actions"><ThreadToggle /></div>
          </article>
        ) : (
          <PostItem
            post={post as Post}
            viewerId={viewerId}
            now={now}
            focused={root}
            inThread
            replyAction={(
              <ThreadReplyAction
                id={post.id}
                parentId={post.replyParentId}
                handle={post.authorHandle}
                depth={depth}
                count={post.replyCount}
              />
            )}
            threadToggle={<ThreadToggle />}
          />
        )}
      </ThreadBranch>
    ),
  }
}
