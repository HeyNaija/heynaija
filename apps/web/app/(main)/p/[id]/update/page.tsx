import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createUpdate } from '@/app/actions'
import { Composer } from '@/app/ui/composer'
import { PostsSkeleton } from '@/app/ui/post-item'
import { QuotedPostCard } from '@/app/ui/quoted-post'
import { getPost, getViewer } from '@/lib/api'
import { currentDataSaver } from '@/lib/low-data-server'
import { composerOffersMark } from '@/lib/sensitive'

export const metadata: Metadata = { title: 'Add update' }

type Props = PageProps<'/p/[id]/update'>

export default function UpdatePage(props: Props) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <UpdateView {...props} />
    </Suspense>
  )
}

/**
 * Writing an update to a story (docs/adr/0024): your words above, the story's
 * first post below. Only its author gets here; from an update, its story.
 */
async function UpdateView({ params }: Props) {
  const { id } = await params
  const [viewer, found] = await Promise.all([getViewer(), getPost(id)])
  if (viewer.state !== 'member') redirect(viewer.state === 'anonymous' ? '/login' : '/')
  if (!found || found.deleted) notFound()
  if (found.story && found.story.number > 0) redirect(`/p/${found.story.id}/update`)
  const post = found
  if (post.authorId !== viewer.me.id || post.replyParentId) notFound()
  const saver = await currentDataSaver()
  const next = (post.story?.updates ?? 0) + 1

  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">{post.story ? 'Your story' : 'Start a story'}</p>
        <h1 className="page-title">Add update {next}</h1>
        <p className="page-description">
          {post.story
            ? 'It goes at the end of your story. Feeds show your story once, at its newest update, and everyone following it is told.'
            : 'Your post becomes a story: its updates go under it in order, and feeds show it once, at its newest update. People can follow it to hear about each one.'}
        </p>
      </header>
      <Composer
        handle={viewer.me.handle}
        avatar={viewer.me.avatar}
        polls={viewer.me.features?.polls ?? false}
        // An update starts with the first post's reply setting; it is changed from the post's menu.
        replyControls={false}
        sensitiveLabels={composerOffersMark(viewer.me)}
        placeholder="What happened next?"
        submitAction={createUpdate}
        story={{ id: post.id, preview: <QuotedPostCard quote={post} now={Date.now()} saver={saver} label={post.story ? 'Your story' : 'Your post'} /> }}
      />
      <Link prefetch={false} href={`/p/${post.id}`} className="self-start text-sm font-medium text-muted hover:text-ink hover:underline">
        Cancel
      </Link>
    </div>
  )
}
