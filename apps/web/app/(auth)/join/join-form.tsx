'use client'

import { useActionState } from 'react'
import { acceptInvite, type JoinState } from '@/app/actions'

export function JoinForm({ initialCode }: { initialCode: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(acceptInvite, {})

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
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
          className="field font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal"
        />
        <p role="alert" className="text-sm text-danger empty:hidden">
          {state.error}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary btn-lg btn-block"
      >
        {pending ? 'Checking…' : 'Check invite code'}
      </button>
    </form>
  )
}
