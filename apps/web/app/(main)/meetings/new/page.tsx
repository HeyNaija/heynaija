import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { StartMeeting } from '@/app/ui/meetings/start-meeting'
import { getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Start a meeting' }

export default function NewMeetingPage() {
  return (
    <>
      <noscript>
        <p className="notice">Meetings need JavaScript to carry audio. Turn it on in your browser, then reload this page.</p>
      </noscript>
      <Suspense fallback={null}>
        <NewMeeting />
      </Suspense>
    </>
  )
}

async function NewMeeting() {
  const viewer = await getViewer()
  if (viewer.state !== 'member' || !viewer.me.features.calls) notFound()
  return <StartMeeting />
}
