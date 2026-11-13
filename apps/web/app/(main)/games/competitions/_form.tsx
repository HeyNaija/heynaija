'use client'

import { useActionState, useState } from 'react'
import { SubmitButton } from '@/app/ui/submit-button'
import { type CompetitionFormState, saveCompetition } from './actions'

export type CompetitionDefaults = {
  id?: string
  name: string
  eligibility: 'open' | 'community' | 'invite'
  community: string
  invite: string
  entryOpensAt: string
  entryClosesAt: string
  startsAt: string
  endsAt: string
}

/** Making or changing a competition. Times are Lagos times. */
export function CompetitionForm({ defaults, communities }: { defaults: CompetitionDefaults; communities: { slug: string; name: string }[] }) {
  const [state, action] = useActionState<CompetitionFormState, FormData>(saveCompetition, {})
  const [eligibility, setEligibility] = useState(defaults.eligibility)
  return (
    <form action={action} className="flex flex-col gap-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Name</span>
        <input name="name" className="field" required minLength={3} maxLength={80} defaultValue={defaults.name} placeholder="Weekend Keno Cup" />
      </label>
      <p className="text-sm text-muted">Game: Keno, most points from tickets in rounds drawn during the competition.</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="field-label">Who can enter</legend>
        {(
          [
            ['open', 'Anyone with Games'],
            ['community', 'Members of one community'],
            ['invite', 'Only members you invite'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="eligibility" value={value} checked={eligibility === value} onChange={() => setEligibility(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      {eligibility === 'community' ? (
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Community</span>
          <select name="community" className="field" defaultValue={defaults.community} required>
            <option value="">Choose a community</option>
            {communities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {eligibility === 'invite' ? (
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Invited members</span>
          <textarea name="invite" className="field" rows={3} defaultValue={defaults.invite} placeholder="@ada @bayo @chi" required />
          <span className="field-hint">Handles, separated by spaces or commas.</span>
        </label>
      ) : null}
      <div className="competition-times">
        {(
          [
            ['entryOpensAt', 'Entry opens'],
            ['entryClosesAt', 'Entry closes'],
            ['startsAt', 'Starts'],
            ['endsAt', 'Ends'],
          ] as const
        ).map(([name, label]) => (
          <label key={name} className="flex flex-col gap-1.5">
            <span className="field-label">{label} (Lagos time)</span>
            <input type="datetime-local" name={name} className="field" required defaultValue={defaults[name]} />
          </label>
        ))}
      </div>
      <p className="text-xs text-muted">Entry must close before the end. Points count from Keno rounds drawn between the start and the end.</p>
      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {defaults.id ? (
          <SubmitButton className="btn btn-primary">Save changes</SubmitButton>
        ) : (
          <>
            <SubmitButton className="btn btn-primary" name="publish" value="yes">
              Publish
            </SubmitButton>
            <SubmitButton className="btn btn-secondary" name="publish" value="no">
              Save as draft
            </SubmitButton>
          </>
        )}
      </div>
    </form>
  )
}
