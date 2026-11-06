'use client'

import { useActionState, useEffect } from 'react'
import { acceptInvite, type JoinState } from '@/app/actions'

export function JoinForm({ initialCode }: { initialCode: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(acceptInvite, {})

  // A full page load, so the browser itself follows Kratos's redirects and keeps its cookies.
  useEffect(() => {
    if (state.next) window.location.assign(state.next)
  }, [state.next])
  const busy = pending || Boolean(state.next)

  const dateInvalid = Boolean(state.dateError) || undefined
  return (
    <form action={action} aria-busy={busy} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="invite-code" className="field-label">
          Invite code
        </label>
        <input
          id="invite-code"
          name="code"
          type="text"
          required
          defaultValue={state.code ?? initialCode}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          placeholder="HN-XXXX-XXXX-XXXX"
          aria-invalid={Boolean(state.error) || undefined}
          aria-describedby={state.error ? 'invite-code-error' : 'invite-code-hint'}
          className={`field min-h-12 font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal ${state.error ? 'border-danger' : ''}`}
        />
        {state.error ? (
          <p id="invite-code-error" role="alert" className="text-sm leading-relaxed text-danger">{state.error}</p>
        ) : (
          <p id="invite-code-hint" className="field-hint">You'll find this in the invite shared with you.</p>
        )}
      </div>
      <fieldset className="join-dob" aria-describedby={state.dateError ? 'join-dob-error' : 'join-dob-hint'}>
        <legend className="field-label">Date of birth</legend>
        <div className="join-dob-fields">
          <div>
            <label htmlFor="join-dob-day">Day</label>
            <input
              id="join-dob-day"
              name="day"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              required
              autoComplete="bday-day"
              defaultValue={state.birth?.day}
              aria-invalid={dateInvalid}
              className={`field min-h-12 ${state.dateError ? 'border-danger' : ''}`}
            />
          </div>
          <div>
            <label htmlFor="join-dob-month">Month</label>
            <input
              id="join-dob-month"
              name="month"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              required
              autoComplete="bday-month"
              defaultValue={state.birth?.month}
              aria-invalid={dateInvalid}
              className={`field min-h-12 ${state.dateError ? 'border-danger' : ''}`}
            />
          </div>
          <div>
            <label htmlFor="join-dob-year">Year</label>
            <input
              id="join-dob-year"
              name="year"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{4}"
              minLength={4}
              maxLength={4}
              required
              autoComplete="bday-year"
              defaultValue={state.birth?.year}
              aria-invalid={dateInvalid}
              className={`field min-h-12 ${state.dateError ? 'border-danger' : ''}`}
            />
          </div>
        </div>
        {state.dateError ? (
          <p id="join-dob-error" role="alert" className="text-sm leading-relaxed text-danger">{state.dateError}</p>
        ) : (
          <p id="join-dob-hint" className="field-hint">
            For example, 27 3 2004. Only you can see it, in Settings. It is never shown on your profile.
          </p>
        )}
      </fieldset>
      <div className="flex flex-col gap-2">
        <label className="join-age">
          <input
            type="checkbox"
            name="confirm"
            value="yes"
            required
            defaultChecked={state.confirmed}
            aria-invalid={Boolean(state.confirmError) || undefined}
            aria-describedby={state.confirmError ? 'join-confirm-error' : undefined}
          />
          <span>This is my real date of birth</span>
        </label>
        {state.confirmError ? (
          <p id="join-confirm-error" role="alert" className="text-sm leading-relaxed text-danger">{state.confirmError}</p>
        ) : null}
      </div>
      {state.ageError ? (
        <p role="alert" className="notice">{state.ageError}</p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="btn btn-primary btn-lg btn-block"
      >
        {busy ? 'Checking…' : 'Check invite code'}
      </button>
    </form>
  )
}
