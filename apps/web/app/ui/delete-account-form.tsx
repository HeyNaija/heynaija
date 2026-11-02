'use client'

import { useActionState, useEffect, useSyncExternalStore } from 'react'
import { type DeletionFormState, requestAccountDeletion } from '@/app/actions'
import { REFUSALS, type Refusal } from '@/lib/account-deletion'

const unchanging = () => () => {}

/**
 * Typing the handle asks for the account's deletion. A plain form, in the page's
 * prerendered shell, which a refused action cannot redraw without JavaScript. So
 * the action is told whether script is running (`js`): with it, the form shows a
 * refusal in place and opens the sign-in step itself; without, the action
 * redirects, to a page that renders the form with `refusal`, or to Kratos.
 */
export function DeleteAccountForm({ refusal }: { refusal?: Refusal }) {
  const [state, action, pending] = useActionState<DeletionFormState, FormData>(requestAccountDeletion, {})
  // '1' once hydrated; the server's HTML, all a browser without JavaScript has, says ''.
  const scripted = useSyncExternalStore(unchanging, () => true, () => false)
  const error = state.error ?? (refusal ? REFUSALS[refusal] : undefined)

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
      <input type="hidden" name="js" value={scripted ? '1' : ''} />
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
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? 'confirm-handle-error' : 'confirm-handle-hint'}
          className={`field ${error ? 'border-danger' : ''}`}
        />
        {error ? (
          <p id="confirm-handle-error" role="alert" className="text-sm leading-relaxed text-danger">{error}</p>
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
