'use client'

import { type ReactNode, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { confirmCopy } from '@/lib/confirm'
import { ConfirmDialog } from './confirm-dialog'

/** A form's submit button that dims while its server action is running. */
export function SubmitButton({
  children,
  className,
  confirmMessage,
  confirmTitle,
  confirmLabel = 'Confirm',
  cancelLabel,
  label,
  pressed,
  name,
  value,
}: {
  children: ReactNode
  className?: string
  /**
   * Ask before submitting (used for deletes): "Delete this post? This cannot be
   * undone." The question becomes the dialog's title unless `confirmTitle` is given.
   * Until the page's JavaScript has loaded the form is sent without asking.
   */
  confirmMessage?: string
  confirmTitle?: string
  /** The dialog's confirm button: the action as a verb, "Delete post". */
  confirmLabel?: string
  /** For when the action is itself a cancellation, and "Cancel" would read either way. */
  cancelLabel?: string
  label?: string
  pressed?: boolean
  /** Sent with the form when this is the button pressed (for forms with several). */
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()
  const button = useRef<HTMLButtonElement>(null)
  const [asking, setAsking] = useState(false)
  return (
    <>
      <button
        ref={button}
        type="submit"
        name={name}
        value={value}
        disabled={pending}
        aria-label={label}
        aria-pressed={pressed}
        onClick={confirmMessage ? (e) => { e.preventDefault(); setAsking(true) } : undefined}
        className={`${className ?? ''} disabled:opacity-50`}
      >
        {children}
      </button>
      {confirmMessage && asking ? (
        <ConfirmDialog
          {...confirmCopy(confirmMessage, confirmTitle)}
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          trigger={button}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false)
            const submitter = button.current
            // Sent as this button's own press, so its name and value go with the form.
            submitter?.form?.requestSubmit(submitter)
            // A menu closes when its form is sent, which would leave focus on a hidden item.
            submitter?.closest('details:not([open])')?.querySelector('summary')?.focus({ preventScroll: true })
          }}
        />
      ) : null}
    </>
  )
}
