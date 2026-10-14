import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getProfile, getThread, getViewer } from '@/lib/api'
import { ReportForm } from './report-form'

export const metadata: Metadata = { title: 'Report' }

export default function ReportPage({ searchParams }: PageProps<'/report'>) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <Report searchParams={searchParams} />
    </Suspense>
  )
}

async function Report({ searchParams }: Pick<PageProps<'/report'>, 'searchParams'>) {
  const viewer = await getViewer()
  if (viewer.state !== 'member') redirect('/login')

  const params = await searchParams
  const postId = typeof params.post === 'string' ? params.post : undefined
  const handle = typeof params.member === 'string' ? params.member : undefined

  // Show the member exactly what they are about to report.
  const thread = postId ? await getThread(postId) : null
  const profile = !postId && handle ? await getProfile(handle) : null
  if (!thread && !profile) notFound()

  return (
    <div className="content-panel">
      <header className="page-intro">
        <p className="page-eyebrow">Looking out for each other</p>
        <h1 className="page-title">{thread ? 'Report a post' : `Report @${profile!.handle}`}</h1>
        <p className="page-description">Tell our moderators what’s wrong. Your report helps keep this community safe.</p>
      </header>
      {thread ? (
        <blockquote className="mt-4 rounded-lg bg-panel p-4 text-sm">
          <span className="font-semibold">@{thread.post.authorHandle}</span>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-muted">{thread.post.text}</p>
        </blockquote>
      ) : null}
      <div className="mt-4">
        <ReportForm postId={thread?.post.id} handle={profile?.handle} />
      </div>
    </div>
  )
}
