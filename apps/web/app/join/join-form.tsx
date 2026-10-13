'use client'

import { useActionState } from 'react'
import { acceptInvite, type JoinState } from '@/app/actions'

export function JoinForm({ initialCode }: { initialCode: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(acceptInvite, {})

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="invite-code" className="text-sm font-medium">
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
          className="rounded-xl border border-line bg-surface px-3 py-3 font-mono text-base uppercase placeholder:text-muted placeholder:normal-case"
        />
        <p role="alert" className="text-sm text-danger empty:hidden">
          {state.error}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-accent px-4 py-3 font-semibold text-accent-ink disabled:opacity-50"
      >
        {pending ? 'Checking…' : 'Continue'}
      </button>
    </form>
  )
}
