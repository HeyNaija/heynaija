'use client'

import { useActionState } from 'react'
import { type FormState, setCommunityModerator } from '@/app/actions'
import type { ModeratorRoster as Roster } from '@/lib/api'
import { SubmitButton } from './submit-button'

/**
 * Who moderates each community, with a way to add or remove them. For site
 * moderators; making someone a site moderator is not done here.
 */
export function ModeratorRoster({ roster }: { roster: Roster }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setCommunityModerator, {})

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line text-sm">
        {roster.map((c) => (
          <li key={c.slug} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
            <span className="w-32 shrink-0 font-semibold">{c.name}</span>
            {c.moderators.length === 0 ? <span className="text-muted">No moderators yet</span> : null}
            {c.moderators.map((m) => (
              <form key={m.handle} action={action} className="flex items-baseline gap-1.5">
                <input type="hidden" name="community" value={c.slug} />
                <input type="hidden" name="handle" value={m.handle} />
                <input type="hidden" name="on" value="0" />
                <span>@{m.handle}</span>
                <SubmitButton
                  className="text-xs font-semibold text-danger hover:underline"
                  confirmMessage={`Stop @${m.handle} moderating ${c.name}?`}
                >
                  Remove
                </SubmitButton>
              </form>
            ))}
          </li>
        ))}
      </ul>

      <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
        <input type="hidden" name="on" value="1" />
        <p className="field-label">Add a community moderator</p>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="mod-community">
            Community
          </label>
          <select id="mod-community" name="community" required className="field field-sm w-auto min-w-40">
            {roster.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="mod-handle">
            Handle
          </label>
          <input
            id="mod-handle"
            name="handle"
            required
            placeholder="@handle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="field field-sm min-w-0 flex-1"
          />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Why (kept in the decision log)</span>
          <input name="note" maxLength={500} className="field field-sm" />
        </label>
        <button type="submit" disabled={pending} className="btn btn-secondary btn-sm self-start">
          {pending ? 'Saving…' : 'Make moderator'}
        </button>
        <p className="field-hint">
          They can review reports about posts in that community and remove those posts. Site-wide moderators are
          assigned by whoever runs HeyNaija, not here.
        </p>
      </form>

      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
    </div>
  )
}
