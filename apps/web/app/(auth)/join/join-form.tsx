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
