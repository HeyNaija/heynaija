import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { GistReplies } from '@/app/ui/gists/gist-replies'
import { GistRoom } from '@/app/ui/gists/gist-room'
import { getGist, getGistReplies, getViewer } from '@/lib/api'
import type { ReplyOrder } from '@/lib/thread-state'

/**
 * The tab shows the Gist's title. Only members on the Gists list get this far
 * (proxy.ts); everyone else, link preview fetchers included, gets the sign-in page
 * or the missing page, neither of which names the Gist.
 */
export async function generateMetadata({ params }: PageProps<'/gists/[id]'>): Promise<Metadata> {
  const gist = await getGist((await params).id).catch(() => null)
  return { title: gist?.title ?? 'Gist', robots: { index: false } }
}

export default function GistPage(props: PageProps<'/gists/[id]'>) {
  // The notice sits outside Suspense: without JavaScript the streamed page never replaces its fallback.
  return (
    <>
      <noscript>
        <p className="notice">Gists need JavaScript to play audio. Turn it on in your browser, then reload this page.</p>
      </noscript>
      <Suspense fallback={<div className="square-card" aria-busy="true">Opening the Gist…</div>}>
        <GistView {...props} />
      </Suspense>
    </>
  )
}

async function GistView({ params, searchParams }: Pick<PageProps<'/gists/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const order: ReplyOrder = query.replies === 'oldest' ? 'oldest' : 'newest'
  const viewer = await getViewer()
  // With Gists off, or for anyone not on the list (or signed out), this page does not exist.
  if (viewer.state !== 'member' || !viewer.me.features.gists) notFound()
  const gist = await getGist(id)
  if (!gist) notFound()
  const cursor = typeof query.repliesCursor === 'string' ? query.repliesCursor : undefined
  const replies = await getGistReplies(id, cursor, order).catch(() => null)
  const writable = viewer.me.features.gistReplies === true
  return (
    <>
      <GistRoom initial={gist} meId={viewer.me.id} />
      {replies && (writable || replies.count > 0) ? (
        <GistReplies
          gistId={id}
          hostHandle={gist.host.handle}
          page={replies}
          viewer={{ id: viewer.me.id, handle: viewer.me.handle, avatar: viewer.me.avatar }}
          writable={writable}
          order={order}
        />
      ) : null}
    </>
  )
}
