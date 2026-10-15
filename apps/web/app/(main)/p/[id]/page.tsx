import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostItem, PostsSkeleton } from '@/app/ui/post-item'
import { ThreadConversation } from '@/app/ui/thread-conversation'
import { renderThreadRow } from '@/app/ui/thread-row'
import { getReplies, getThread, getViewer } from '@/lib/api'
import { ChevronIcon } from '@/app/ui/icons'

type Props = PageProps<'/p/[id]'>

export const metadata: Metadata = { title: 'Post' }

export default function ThreadPage(props: Props) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <ThreadView {...props} />
    </Suspense>
  )
}

async function ThreadView({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const [thread, viewer] = await Promise.all([getThread(id), getViewer()])
  if (!thread) notFound()

  const viewerId = viewer.state === 'member' ? viewer.me.id : null
  const now = Date.now()
  // Plain pagination links keep branch reading available without JavaScript.
  const page = typeof query.repliesCursor === 'string'
    ? await getReplies(id, query.repliesCursor).catch(() => null)
    : null
  const replies = page?.replies ?? thread.replies
  const cursor = page ? page.cursor : thread.replyCursor
  const parent = thread.ancestors.find((post) => post.id === thread.post.replyParentId)
  const older = thread.ancestors.filter((post) => post.id !== parent?.id)

  return (
    <div className="thread-view flex flex-col">
      <Link prefetch={false} href="/" className="self-start text-sm font-medium text-muted hover:text-ink hover:underline">
        Back to the feed
      </Link>

      {/* The conversation so far, each post leading down to the one in focus. */}
      {older.length || thread.ancestorsTruncated ? (
        <details className="thread-context">
          <summary className="menu">
            <span>Earlier conversation</span>
            <ChevronIcon size={16} />
          </summary>
          <ol aria-label="Earlier in this conversation" className="post-list border-l-2 border-line-strong pl-3">
            {older.map((post) => (
              <li key={post.id}>
                <PostItem post={post} viewerId={viewerId} now={now} inThread />
              </li>
            ))}
          </ol>
          {thread.ancestorsTruncated ? (
            <p className="thread-context-note">
              Earlier posts are outside this view.
              {thread.earlierAncestorId ? <> <Link prefetch={false} href={`/p/${thread.earlierAncestorId}`}>Continue earlier conversation</Link></> : null}
            </p>
          ) : null}
        </details>
      ) : null}

      {parent ? <div className="thread-immediate-parent"><PostItem post={parent} viewerId={viewerId} now={now} inThread /></div> : null}
      {thread.post.replyParentId ? (
        <p className="thread-recipient">
          {parent && !parent.deleted ? `Replying to @${parent.authorHandle}` : 'Replying to an earlier post'}
        </p>
      ) : null}

      <ThreadConversation
        key={`${viewerId ?? 'visitor'}:${id}`}
        focus={{ id, parentId: thread.post.replyParentId, handle: thread.post.authorHandle, depth: 0 }}
        member={viewer.state === 'member' ? { handle: viewer.me.handle, avatar: viewer.me.avatar } : null}
        initialRows={replies.map((post) => renderThreadRow(post, viewerId, now, 1, thread.post.authorHandle))}
        cursor={cursor}
        version={now}
      >
        {renderThreadRow(thread.post, viewerId, now, 0, parent && !parent.deleted ? parent.authorHandle : null, true).node}
      </ThreadConversation>

      {viewer.state !== 'member' ? (
        <p className="notice">
          <Link href="/login" className="font-semibold underline underline-offset-2">
            Sign in
          </Link>{' '}
          to reply.
        </p>
      ) : null}
    </div>
  )
}
