'use client'

import { useActionState, useState } from 'react'
import { type IdeaFormState, setIdeaStatus } from '@/app/idea-actions'
import type { IdeaStatus } from '@/lib/api'
import { STATUS_LABELS } from '@/lib/ideas'

/** For Building HeyNaija's moderators: set an idea's status. The author and voters are told. */
export function IdeaModeration({ id, status: current }: { id: string; status: IdeaStatus }) {
  const [state, action, pending] = useActionState<IdeaFormState, FormData>(setIdeaStatus, {})
  const [status, setStatus] = useState<IdeaStatus>(current)
  const needsReason = status === 'not_now' || status === 'duplicate'

  return (
    <form action={action} className="idea-moderation flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Set the status</h2>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-col gap-2">
        <label htmlFor="idea-status" className="field-label">Status</label>
        <select id="idea-status" name="status" value={status} onChange={(e) => setStatus(e.target.value as IdeaStatus)} className="field">
          {(Object.keys(STATUS_LABELS) as IdeaStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {status === 'duplicate' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="idea-original" className="field-label">Link to the idea it repeats</label>
          <input id="idea-original" name="duplicateOf" required className="field" placeholder="https://heynaija.ng/p/…" />
          <p className="field-hint">Its votes move there.</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="idea-reason" className="field-label">{needsReason ? 'Why (everyone will see this)' : 'A note for everyone (optional)'}</label>
        <textarea id="idea-reason" name="reason" rows={2} maxLength={500} required={needsReason} className="field" />
      </div>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className="btn btn-secondary self-start disabled:opacity-50">
        {pending ? 'Saving…' : 'Save and tell them'}
      </button>
    </form>
  )
}
