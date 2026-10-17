import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PostList, PostsSkeleton } from '@/app/ui/post-item'
import { getBookmarks, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Bookmarks' }

export default function BookmarksPage({ searchParams }: PageProps<'/bookmarks'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Your personal collection</p>
        <h1 className="page-title">Bookmarks</h1>
        <p className="page-description">Good conversations, kept close. Only you can see the posts you save here.</p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Bookmarks searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Bookmarks({ searchParams }: Pick<PageProps<'/bookmarks'>, 'searchParams'>) {
  const viewer = await getViewer()
  if (viewer.state !== 'member') redirect('/login')

  const { cursor } = await searchParams
  const page = typeof cursor === 'string' ? cursor : undefined
  const feed = await getBookmarks(page)

  return (
    <PostList
      posts={feed.posts}
      viewerId={viewer.me.id}
      now={Date.now()}
      empty={
        page
          ? { title: 'No older bookmarks' }
          : { title: 'Nothing saved yet', detail: 'Tap the bookmark on any post to keep it here.' }
      }
      more={{ source: { kind: 'bookmarks' }, cursor: feed.cursor }}
    />
  )
}
