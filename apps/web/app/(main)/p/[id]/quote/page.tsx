import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createQuote } from '@/app/actions'
import { Composer } from '@/app/ui/composer'
import { PostsSkeleton } from '@/app/ui/post-item'
import { QuotedPostCard } from '@/app/ui/quoted-post'
import { getCommunities, getPost, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Quote post' }

type Props = PageProps<'/p/[id]/quote'>

export default function QuotePage(props: Props) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <QuoteView {...props} />
    </Suspense>
  )
}

/** Writing a quote post: your words above, the post you are quoting below. */
async function QuoteView({ params }: Props) {
  const { id } = await params
  const [viewer, post] = await Promise.all([getViewer(), getPost(id)])
  if (viewer.state !== 'member') redirect(viewer.state === 'anonymous' ? '/login' : '/')
  if (!post || post.deleted) notFound()
  const joined = (await getCommunities()).filter((c) => c.viewerIsMember)

  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Quote post</p>
        <h1 className="page-title">Add your take</h1>
        <p className="page-description">
          Your post shows @{post.authorHandle}’s post inside it. If they delete it, yours stays up with a note that it is gone.
        </p>
      </header>
      <Composer
        handle={viewer.me.handle}
        avatar={viewer.me.avatar}
        choices={joined}
        polls={viewer.me.features?.polls ?? false}
        replyControls={viewer.me.features?.replyControls ?? false}
        placeholder="Add your thoughts…"
        submitAction={createQuote}
        quote={{ id: post.id, preview: <QuotedPostCard quote={post} now={Date.now()} /> }}
      />
      <Link prefetch={false} href={`/p/${post.id}`} className="self-start text-sm font-medium text-muted hover:text-ink hover:underline">
        Cancel
      </Link>
    </div>
  )
}
