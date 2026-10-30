'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { LiveIcon } from '@/app/ui/icons'
import { TITLE_MAX, titleProblem, type SpaceView } from '@/lib/spaces'
import { spaceCall } from './api'
import { CURRENT_SPACE_KEY } from './space-room'

/** "Start a Space": a title and a button. Shown on Home to members on the Spaces list, and at /spaces/new. */
export function StartSpace({ heading = true }: { heading?: boolean }) {
  const router = useRouter()
  const fieldId = useId()
  const hintId = useId()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)

  // The API has no list of live Spaces yet, so a Space you are in is remembered for this tab.
  useEffect(() => setCurrent(sessionStorage.getItem(CURRENT_SPACE_KEY)), [])

  async function start(event: React.FormEvent) {
    event.preventDefault()
    const problem = titleProblem(title)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const res = await spaceCall<SpaceView>('POST', '', { title: title.trim() })
    if (res.ok) return router.push(`/spaces/${res.data.id}`)
    setBusy(false)
    setError(res.message ?? 'Could not start the Space. Try again.')
  }

  return (
    <section className="square-card space-section" aria-labelledby={`${fieldId}-h`}>
      {heading ? (
        <h2 id={`${fieldId}-h`} className="section-title flex items-center gap-2">
          <LiveIcon size={18} /> Start a Space
        </h2>
      ) : (
        <h1 id={`${fieldId}-h`} className="page-title">
          Start a Space
        </h1>
      )}
      <p id={hintId} className="mt-1 text-sm text-muted">
        A live audio room. You talk, others listen, and you choose who else may speak. Not recorded. Needs JavaScript and a browser with a microphone.
      </p>
      <form onSubmit={start} className="mt-3 flex flex-col gap-3 sm:flex-row" noValidate>
        <label htmlFor={fieldId} className="sr-only">
          Space title
        </label>
        <input
          id={fieldId}
          className="field sm:flex-1"
          value={title}
          maxLength={TITLE_MAX}
          placeholder="What is it about?"
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" disabled={busy} className="btn btn-primary space-btn">
          {busy ? 'Starting…' : 'Go live'}
        </button>
      </form>
      {error ? (
        <p role="alert" className="notice notice-danger mt-3">
          {error}
        </p>
      ) : null}
      {current ? (
        <p className="mt-3 text-sm">
          <Link href={`/spaces/${current}`} className="font-semibold text-accent-strong hover:underline">
            Return to the Space you are in
          </Link>
        </p>
      ) : null}
    </section>
  )
}
