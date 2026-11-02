'use client'

import { useId, useState } from 'react'
import { REPORT_REASONS } from '@/lib/report-reasons'

/**
 * Reporting the Gist itself (docs/adr/0017), in a sheet so the room keeps playing.
 * The same reasons as reporting a post; the API records who is in the room now,
 * since a Gist keeps no audio.
 */
export function ReportGist({ gistId, onDone }: { gistId: string; onDone: () => void }) {
  const detailsId = useId()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!form.get('reason')) return setError('Choose what is wrong.')
    setBusy(true)
    setError(null)
    const res = await fetch('/api/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gistId, reason: String(form.get('reason')), details: String(form.get('details') ?? '') }),
    }).catch(() => null)
    setBusy(false)
    if (res?.ok) return setSent(true)
    const problem = (await res?.json().catch(() => null)) as { message?: unknown } | null
    setError(
      res?.status === 429
        ? 'You have sent a lot of reports. Try again in a while.'
        : typeof problem?.message === 'string' && problem.message.length < 120
          ? `Could not send the report: ${problem.message}.`
          : 'Could not send the report. Try again.',
    )
  }

  if (sent) {
    return (
      <div role="status">
        <p className="notice">Thank you. A moderator will review this Gist. The host and speakers are not told who reported it.</p>
        <button type="button" className="btn btn-secondary gist-btn mt-4" onClick={onDone}>
          Back to the Gist
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-muted">
        Moderators see what the Gist is, who hosts it and who is in it now. Nothing is recorded, so tell them what happened.
      </p>
      <fieldset>
        <legend className="field-label">What is wrong?</legend>
        <div className="mt-2 flex flex-col gap-2">
          {REPORT_REASONS.map(([value, label]) => (
            <label key={value} className="flex min-h-9 items-center gap-2.5 text-[15px]">
              <input type="radio" name="reason" value={value} className="size-4 accent-[var(--accent)]" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={detailsId} className="field-label">
          What happened? <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={detailsId} name="details" rows={3} maxLength={500} className="field" />
      </div>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>
      <button type="submit" disabled={busy} className="btn btn-primary gist-btn self-start">
        {busy ? 'Sending…' : 'Send report'}
      </button>
    </form>
  )
}
