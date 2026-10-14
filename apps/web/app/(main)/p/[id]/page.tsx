import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Composer } from '@/app/ui/composer'
import { PostItem, PostsSkeleton } from '@/app/ui/post-item'
import { getThread, getViewer } from '@/lib/api'
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

async function ThreadView({ params }: Props) {
  const { id } = await params
  const [thread, viewer] = await Promise.all([getThread(id), getViewer()])
  if (!thread) notFound()

  const viewerId = viewer.state === 'member' ? viewer.me.id : null
  const now = Date.now()

  return (
    <div className="thread-view flex flex-col">
      <Link href="/" className="self-start text-sm font-medium text-muted hover:text-ink hover:underline">
        Back to the feed
      </Link>

      {/* The conversation so far, each post leading down to the one in focus. */}
      {thread.ancestors.length ? (
        <details className="thread-context">
          <summary className="menu">
            <span>Replying to <strong>@{thread.ancestors.at(-1)!.authorHandle}</strong> · Earlier conversation</span>
            <ChevronIcon size={16} />
          </summary>
          <ol aria-label="Earlier in this conversation" className="post-list border-l-2 border-line-strong pl-3">
            {thread.ancestors.map((post) => (
              <li key={post.id}>
                <PostItem post={post} viewerId={viewerId} now={now} inThread />
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <PostItem post={thread.post} viewerId={viewerId} now={now} focused />

      {viewer.state === 'member' ? (
        <Composer
          handle={viewer.me.handle}
          avatar={viewer.me.avatar}
          replyTo={thread.post.id}
          placeholder={`Reply to @${thread.post.authorHandle}`}
        />
      ) : (
        <p className="notice">
          <Link href="/login" className="font-semibold underline underline-offset-2">
            Sign in
          </Link>{' '}
          to reply.
        </p>
      )}

      <section aria-label="Replies">
        <h2 className="thread-replies-heading">Replies</h2>
        {thread.replies.length ? (
          <ul className="post-list">
            {thread.replies.map((post) => (
              <li key={post.id}>
                <PostItem post={post} viewerId={viewerId} now={now} inThread />
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-sm text-muted">No replies yet.</p>
        )}
      </section>
    </div>
  )
}
