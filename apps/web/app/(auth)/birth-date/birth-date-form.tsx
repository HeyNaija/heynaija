'use client'

import { useActionState } from 'react'
import { type BirthDateState, giveBirthDate } from '@/app/actions'
import { BirthDateFields } from '@/app/ui/birth-date-fields'

export function BirthDateForm() {
  const [state, action, pending] = useActionState<BirthDateState, FormData>(giveBirthDate, {})
  return (
    <form action={action} aria-busy={pending} className="flex flex-col gap-5">
      <BirthDateFields birth={state.birth} confirmed={state.confirmed} dateError={state.dateError} confirmError={state.confirmError} />
      {state.error ? (
        <p role="alert" className="notice">{state.error}</p>
      ) : null}
      <button type="submit" disabled={pending} className="btn btn-primary btn-lg btn-block">
        {pending ? 'Saving…' : 'Save date of birth'}
      </button>
    </form>
  )
}
