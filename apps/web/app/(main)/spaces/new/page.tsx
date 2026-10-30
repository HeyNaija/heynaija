import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { StartSpace } from '@/app/ui/spaces/start-space'
import { getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Start a Space' }

export default function NewSpacePage() {
  return (
    <>
      <noscript>
        <p className="notice">Spaces need JavaScript to play audio. Turn it on in your browser, then reload this page.</p>
      </noscript>
      <Suspense fallback={null}>
        <NewSpace />
      </Suspense>
    </>
  )
}

async function NewSpace() {
  const viewer = await getViewer()
  if (viewer.state !== 'member' || !viewer.me.features.spaces) notFound()
  return (
    <>
      <StartSpace heading={false} />
    </>
  )
}
