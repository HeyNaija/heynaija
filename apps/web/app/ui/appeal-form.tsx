'use client'

import { useActionState } from 'react'
import { type FormState, submitAppeal } from '@/app/actions'

export function AppealForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(submitAppeal, {})

  if (state.done) {
    return (
      <p role="status" className="notice mt-4">
        Your appeal has been sent. A moderator will review it.
      </p>
    )
  }

  return (
    <form action={action} className="mt-4 flex flex-col gap-3">
      <label htmlFor="appeal-message" className="field-label">
        Why should this be looked at again?
      </label>
      <textarea
        id="appeal-message"
        name="message"
        rows={4}
        required
        minLength={10}
        maxLength={1000}
        className="field"
      />
      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary self-start"
      >
        {pending ? 'Sending…' : 'Send appeal'}
      </button>
    </form>
  )
}
