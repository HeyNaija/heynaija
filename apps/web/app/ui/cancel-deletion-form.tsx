'use client'

import { useActionState } from 'react'
import { cancelAccountDeletion, type FormState } from '@/app/actions'

/** "Keep my account": calls off a deletion during the grace period, and the page is drawn again. */
export function CancelDeletionForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelAccountDeletion, {})
  return (
    <form action={action} className="flex flex-col gap-3">
      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? 'Keeping it…' : 'Keep my account'}
      </button>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
    </form>
  )
}
