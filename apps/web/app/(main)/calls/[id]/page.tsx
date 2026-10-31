import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { CallRoom } from '@/app/ui/calls/call-room'
import { getCall, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Call' }

export default function CallPage(props: PageProps<'/calls/[id]'>) {
  // The notice sits outside Suspense: without JavaScript the streamed page never replaces its fallback.
  return (
    <>
      <noscript>
        <p className="notice">Calls need JavaScript to carry audio. Turn it on in your browser, then reload this page.</p>
      </noscript>
      <Suspense fallback={<div className="square-card" aria-busy="true">Opening the call…</div>}>
        <CallView {...props} />
      </Suspense>
    </>
  )
}

async function CallView({ params }: Pick<PageProps<'/calls/[id]'>, 'params'>) {
  const { id } = await params
  const viewer = await getViewer()
  // With calls off, or for anyone not on the list (or signed out), this page does not exist.
  if (viewer.state !== 'member' || !viewer.me.features.calls) notFound()
  const call = await getCall(id)
  if (!call) notFound()
  return <CallRoom initial={call} />
}
