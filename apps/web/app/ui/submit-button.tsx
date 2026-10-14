'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/** A form's submit button that dims while its server action is running. */
export function SubmitButton({
  children,
  className,
  confirmMessage,
  label,
  pressed,
  name,
  value,
}: {
  children: ReactNode
  className?: string
  /** Ask before submitting (used for deletes). */
  confirmMessage?: string
  label?: string
  pressed?: boolean
  /** Sent with the form when this is the button pressed (for forms with several). */
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-label={label}
      aria-pressed={pressed}
      onClick={confirmMessage ? (e) => { if (!confirm(confirmMessage)) e.preventDefault() } : undefined}
      className={`${className ?? ''} disabled:opacity-50`}
    >
      {children}
    </button>
  )
}
