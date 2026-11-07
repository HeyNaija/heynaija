import { hideGistReply } from '@/app/actions'
import type { ReactNode } from 'react'
import type { Post, ThreadReply } from '@/lib/api'
import type { ReplyOrder, ThreadRow } from '@/lib/thread-state'
import { PostItem } from './post-item'
import { SubmitButton } from './submit-button'
import { ThreadBranch, ThreadReplyAction, ThreadToggle } from './thread-conversation'

export function renderThreadRow(
  post: ThreadReply,
  viewerId: string | null,
  now: number,
  depth: number,
  parentHandle: string | null,
  root = false,
  gist?: { id: string; viewerIsHost: boolean; order?: ReplyOrder },
  /** Under the post's card, before its replies: a story's updates (docs/adr/0024). */
  below?: ReactNode,
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
            <p className="text-sm italic text-muted">
              {post.hiddenByHost ? 'The host hid this reply.' : 'This post is no longer available.'}
            </p>
            {post.hiddenByHost && gist?.viewerIsHost ? (
              <form action={hideGistReply}>
                <input type="hidden" name="gist" value={gist.id} />
                <input type="hidden" name="id" value={post.id} />
                <input type="hidden" name="on" value="0" />
                <SubmitButton className="btn btn-secondary btn-lg">Show reply</SubmitButton>
              </form>
            ) : null}
            <div className="post-actions"><ThreadToggle /></div>
          </article>
        ) : (
          <PostItem
            post={post as Post}
            viewerId={viewerId}
            now={now}
            focused={root}
            inThread
            gist={gist}
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
        {below}
      </ThreadBranch>
    ),
  }
}
