'use client'

import { useActionState, useEffect } from 'react'
import { acceptInvite, type JoinState } from '@/app/actions'
import { BirthDateFields } from '@/app/ui/birth-date-fields'

/**
 * The invite code and the person's age: the "I am 18 or older" box, or, while
 * the API asks for one (`asksBirthDate`), their date of birth.
 */
export function JoinForm({ initialCode, asksBirthDate }: { initialCode: string; asksBirthDate: boolean }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(acceptInvite, {})

  // A full page load, so the browser itself follows Kratos's redirects and keeps its cookies.
  useEffect(() => {
    if (state.next) window.location.assign(state.next)
  }, [state.next])
  const busy = pending || Boolean(state.next)

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
      {asksBirthDate ? (
        <BirthDateFields birth={state.birth} confirmed={state.confirmed} dateError={state.dateError} confirmError={state.confirmError} />
      ) : (
        <div className="flex flex-col gap-2">
          <label className="join-age">
            <input
              type="checkbox"
              name="adult"
              value="yes"
              required
              defaultChecked={state.adult}
              aria-invalid={Boolean(state.confirmError) || undefined}
              aria-describedby={state.confirmError ? 'join-age-error' : 'join-age-hint'}
            />
            <span>I am 18 or older</span>
          </label>
          {state.confirmError ? (
            <p id="join-age-error" role="alert" className="text-sm leading-relaxed text-danger">{state.confirmError}</p>
          ) : (
            <p id="join-age-hint" className="field-hint">
              During the beta, accounts are 18+. We don’t ask for your date of birth or any ID.
            </p>
          )}
        </div>
      )}
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
