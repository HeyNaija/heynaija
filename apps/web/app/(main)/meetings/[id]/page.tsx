import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { MeetingRoom } from '@/app/ui/meetings/meeting-room'
import { getMeeting, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Meeting' }

export default function MeetingPage(props: PageProps<'/meetings/[id]'>) {
  // The notice sits outside Suspense: without JavaScript the streamed page never replaces its fallback.
  return (
    <>
      <noscript>
        <p className="notice">Meetings need JavaScript to carry audio. Turn it on in your browser, then reload this page.</p>
      </noscript>
      <Suspense fallback={<div className="square-card" aria-busy="true">Opening the meeting…</div>}>
        <MeetingView {...props} />
      </Suspense>
    </>
  )
}

async function MeetingView({ params }: Pick<PageProps<'/meetings/[id]'>, 'params'>) {
  const { id } = await params
  const viewer = await getViewer()
  // With calls off, or for anyone not on the list (or signed out), this page does not exist.
  if (viewer.state !== 'member' || !viewer.me.features.calls) notFound()
  // Not invited, removed, missing: all the same not-found page.
  const meeting = await getMeeting(id)
  if (!meeting) notFound()
  return <MeetingRoom initial={meeting} meId={viewer.me.id} />
}
