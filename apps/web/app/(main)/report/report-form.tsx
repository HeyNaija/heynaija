'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { type FormState, submitReport } from '@/app/actions'
import { NEEDS_LABEL_REASON, REPORT_REASONS } from '@/lib/report-reasons'

export function ReportForm({ postId, handle, community, gist, needsLabel = false }: {
  postId?: string
  handle?: string
  community?: string
  gist?: string
  /** Offer "not marked sensitive": a post, while the adultLabels flag is on. */
  needsLabel?: boolean
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitReport, {})
  const reasons = needsLabel ? [...REPORT_REASONS.slice(0, -1), NEEDS_LABEL_REASON, REPORT_REASONS.at(-1)!] : REPORT_REASONS

  if (state.done) {
    return (
      <div role="status">
        <p className="notice">
          Thank you. A moderator will review this. You will not be named to the person you reported.
        </p>
        <Link href={gist ? `/gists/${gist}` : '/'} className="btn btn-secondary mt-4">
          {gist ? 'Back to the Gist' : 'Back to the feed'}
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {postId ? <input type="hidden" name="postId" value={postId} /> : null}
      {handle ? <input type="hidden" name="handle" value={handle} /> : null}
      {community ? <input type="hidden" name="community" value={community} /> : null}

      <fieldset>
        <legend className="field-label">What is wrong?</legend>
        <div className="mt-2 flex flex-col gap-2">
          {reasons.map(([value, label]) => (
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
