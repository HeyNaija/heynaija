'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { apiCall } from '@/app/ui/gists/api'
import { meetingFailure, type MeetingView } from '@/lib/meetings'

/**
 * "Start a meeting": makes an empty meeting with the member as host, then opens it. Inviting
 * happens inside, from People, so the list of who can be invited is the API's. Starting does not
 * turn on the microphone or ring anyone.
 */
export function StartMeeting() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    const res = await apiCall<MeetingView>('POST', '/v1/meetings', { memberIds: [] })
    if (res.ok) return router.push(`/meetings/${res.data.id}`)
    setBusy(false)
    setError(meetingFailure(res.status, res.code))
  }

  return (
    <section className="square-card gist-section" aria-labelledby="start-meeting-heading">
      <h1 id="start-meeting-heading" className="page-title">
        Start a meeting
      </h1>
      <p className="mt-1 text-sm text-muted">
        A voice meeting for up to 8 people. You invite them, one by one, and only members who can join a call with you can be invited. You can lock it and remove people. Not recorded. Your microphone stays off until you tap it.
      </p>
      <button type="button" className="btn btn-primary gist-btn mt-3" disabled={busy} onClick={() => void start()}>
        {busy ? 'Starting…' : 'Start a meeting'}
      </button>
      {error ? (
        <p role="alert" className="notice notice-danger mt-3">
          {error}
        </p>
      ) : null}
    </section>
  )
}
