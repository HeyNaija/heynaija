import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { StartGist } from '@/app/ui/gists/start-gist'
import { getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Start a Gist' }

export default function NewGistPage() {
  return (
    <>
      <noscript>
        <p className="notice">Gists need JavaScript to play audio. Turn it on in your browser, then reload this page.</p>
      </noscript>
      <Suspense fallback={null}>
        <NewGist />
      </Suspense>
    </>
  )
}

async function NewGist() {
  const viewer = await getViewer()
  if (viewer.state !== 'member' || !viewer.me.features.gists) notFound()
  return (
    <>
      <StartGist heading={false} />
    </>
  )
}
