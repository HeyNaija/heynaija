import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { SpaceRoom } from '@/app/ui/spaces/space-room'
import { getSpace, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Space' }

export default function SpacePage(props: PageProps<'/spaces/[id]'>) {
  // The notice sits outside Suspense: without JavaScript the streamed page never replaces its fallback.
  return (
    <>
      <noscript>
        <p className="notice">Spaces need JavaScript to play audio. Turn it on in your browser, then reload this page.</p>
      </noscript>
      <Suspense fallback={<div className="square-card" aria-busy="true">Opening the Space…</div>}>
        <SpaceView {...props} />
      </Suspense>
    </>
  )
}

async function SpaceView({ params }: Pick<PageProps<'/spaces/[id]'>, 'params'>) {
  const { id } = await params
  const viewer = await getViewer()
  // With Spaces off, or for anyone not on the list (or signed out), this page does not exist.
  if (viewer.state !== 'member' || !viewer.me.features.spaces) notFound()
  const space = await getSpace(id)
  if (!space) notFound()
  return (
    <>
      <SpaceRoom initial={space} meId={viewer.me.id} />
    </>
  )
}
