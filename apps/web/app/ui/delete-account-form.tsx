'use client'

import { useActionState, useEffect } from 'react'
import { type DeletionFormState, requestAccountDeletion } from '@/app/actions'

/**
 * Typing the handle asks for the account's deletion. A plain form: without
 * JavaScript the next step is a link to follow, with it the browser goes there.
 */
export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<DeletionFormState, FormData>(requestAccountDeletion, {})

  // A full page load, so the browser itself follows Kratos's redirects and keeps its cookies.
  useEffect(() => {
    if (state.next) window.location.assign(state.next.href)
  }, [state.next])

  if (state.next) {
    return (
      <p role="status" className="notice">
        <a href={state.next.href} className="font-semibold text-accent-strong hover:underline">{state.next.label}</a>
      </p>
    )
  }

  return (
    <form action={action} aria-busy={pending} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-handle" className="field-label">Type your handle to confirm</label>
        <input
          id="confirm-handle"
          name="confirmHandle"
          required
          maxLength={40}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={Boolean(state.error) || undefined}
          aria-describedby={state.error ? 'confirm-handle-error' : 'confirm-handle-hint'}
          className={`field ${state.error ? 'border-danger' : ''}`}
        />
        {state.error ? (
          <p id="confirm-handle-error" role="alert" className="text-sm leading-relaxed text-danger">{state.error}</p>
        ) : (
          <p id="confirm-handle-hint" className="field-hint">The name after the @ on your profile.</p>
        )}
      </div>
      <button type="submit" disabled={pending} className="btn btn-danger self-start">
        {pending ? 'Deleting…' : 'Delete my account'}
      </button>
    </form>
  )
}
