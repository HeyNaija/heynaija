'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { type FormState, submitReport } from '@/app/actions'
import { REPORT_REASONS as REASONS } from '@/lib/report-reasons'

export function ReportForm({ postId, handle }: { postId?: string; handle?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitReport, {})

  if (state.done) {
    return (
      <div role="status">
        <p className="notice">
          Thank you. A moderator will review this. You will not be named to the person you reported.
        </p>
        <Link href="/" className="btn btn-secondary mt-4">
          Back to the feed
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {postId ? <input type="hidden" name="postId" value={postId} /> : null}
      {handle ? <input type="hidden" name="handle" value={handle} /> : null}

      <fieldset>
        <legend className="field-label">What is wrong?</legend>
        <div className="mt-2 flex flex-col gap-2">
          {REASONS.map(([value, label]) => (
            <label key={value} className="flex min-h-9 items-center gap-2.5 text-[15px]">
              <input type="radio" name="reason" value={value} required className="size-4 accent-[var(--accent)]" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="report-details" className="field-label">
          Anything a moderator should know? <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="report-details"
          name="details"
          rows={3}
          maxLength={500}
          className="field"
        />
      </div>

      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary self-start"
      >
        {pending ? 'Sending…' : 'Send report'}
      </button>
    </form>
  )
}
