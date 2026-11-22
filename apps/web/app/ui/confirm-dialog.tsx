'use client'

import { type RefObject, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { type ConfirmEvent, type ConfirmFlow, confirmStep, wrapFocus } from '@/lib/confirm'

/**
 * Asks before something that cannot be taken back, in place of the browser's own
 * confirm(): a bottom sheet on phones and a centred card from 640px, on the native
 * <dialog>, which makes the page behind it inert and closes on Esc. Render it only
 * while the question is open. It answers once, after it has closed and focus is
 * back on `trigger`: `onConfirm` or `onCancel` (Cancel, Esc, or a tap on the scrim).
 * Focus starts on Cancel, so Enter on a destructive question does nothing.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  trigger,
  onConfirm,
  onCancel,
}: {
  title: string
  message?: string | null
  /** The action itself, as a verb: "Delete post", never "OK". */
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  trigger: RefObject<HTMLElement | null>
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const flow = useRef<ConfirmFlow>('asking')
  const scrimPress = useRef(false)
  const id = useId()

  // Unmounting closes it; calling close() in cleanup would race Strict Mode.
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [])

  function step(event: ConfirmEvent) {
    const next = confirmStep(flow.current, event)
    flow.current = next.flow
    if (next.close) dialog.current?.close()
    if (!next.answer) return
    // Safari does not focus a button on click, so the browser has nothing to return focus to.
    trigger.current?.focus({ preventScroll: true })
    if (next.answer === 'confirm') onConfirm()
    else onCancel()
  }

  return createPortal(
    <dialog
      ref={dialog}
      role="alertdialog"
      className="confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={message ? `${id}-message` : undefined}
      onClose={() => step('closed')}
      onKeyDown={(event) => {
        // A portal's events still reach the React parents of the button that opened it.
        event.stopPropagation()
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')]
        const to = wrapFocus(controls.length, controls.indexOf(document.activeElement as HTMLElement), event.shiftKey)
        if (to === null) return
        event.preventDefault()
        controls[to]?.focus()
      }}
      onPointerDown={(event) => { scrimPress.current = event.target === event.currentTarget }}
      onClick={(event) => {
        event.stopPropagation()
        if (scrimPress.current && event.target === event.currentTarget) step('dismiss')
      }}
    >
      <div className="confirm-dialog-body">
        <h2 id={`${id}-title`} className="confirm-dialog-title">{title}</h2>
        {message ? <p id={`${id}-message`} className="confirm-dialog-message">{message}</p> : null}
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => step('dismiss')}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={() => step('confirm')}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  )
}
