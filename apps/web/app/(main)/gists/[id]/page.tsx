import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { GistRoom } from '@/app/ui/gists/gist-room'
import { getGist, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Gist' }

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

async function GistView({ params }: Pick<PageProps<'/gists/[id]'>, 'params'>) {
  const { id } = await params
  const viewer = await getViewer()
  // With Gists off, or for anyone not on the list (or signed out), this page does not exist.
  if (viewer.state !== 'member' || !viewer.me.features.gists) notFound()
  const gist = await getGist(id)
  if (!gist) notFound()
  return (
    <>
      <GistRoom initial={gist} meId={viewer.me.id} />
    </>
  )
}
