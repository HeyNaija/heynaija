'use client'

import { type MouseEvent, type RefObject, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  type ConfirmEvent,
  type ConfirmFlow,
  confirmStep,
  continuesPress,
  FOLLOW_UP_MS,
  type HeldPress,
  type Press,
  pressedWith,
  restOfHeldPress,
  wrapFocus,
} from '@/lib/confirm'

const FOLLOW_UP_EVENTS = ['pointerdown', 'mousedown', 'click', 'dblclick'] as const
const LIFT_EVENTS = ['pointerup', 'pointercancel'] as const
/** The longest a held follow-up press is waited for before its listeners go. */
const HELD_PRESS_MS = 10_000

/**
 * Once a click or tap has closed the dialog, the rest of that press (the second click
 * of a double click) would land on whatever the dialog covered: the post it deleted,
 * or the phone's tab bar under the sheet. Those presses (and their pointerdown and
 * mousedown, which would move focus) are stopped before anything sees them; any other
 * press goes through. A click from the keyboard (Enter or Space, `detail` 0) has no
 * second press, so it stops nothing. A press that goes down in time but is held past
 * it (a slow second click, a long second tap) is stopped whole: its mousedown and
 * click come after the window.
 */
function swallowRestOfPress(event: MouseEvent, pointerType: string) {
  const first: Press = { x: event.clientX, y: event.clientY, at: event.timeStamp, pointerType }
  let held: (HeldPress & { id: number }) | null = null
  let listening = true
  const stop = (next: Event) => {
    // Cancelling pointerdown would also stop mousedown, whose default (moving focus) is the one to cancel.
    if (next.type !== 'pointerdown') next.preventDefault()
    next.stopImmediatePropagation()
  }
  const swallow = (next: Event) => {
    if (!(next instanceof globalThis.MouseEvent)) return
    const at = { x: next.clientX, y: next.clientY, at: next.timeStamp, detail: next.detail }
    // A new pointerdown starts a new press, so a held one is over.
    if (next.type === 'pointerdown') held = null
    else if (held) {
      if (restOfHeldPress(held, at)) stop(next)
      return
    }
    const type = next instanceof PointerEvent ? next.pointerType : ''
    if (!continuesPress(first, { ...at, pointerType: type })) return
    if (next instanceof PointerEvent && next.type === 'pointerdown') held = { x: at.x, y: at.y, liftedAt: null, id: next.pointerId }
    stop(next)
  }
  const lift = (next: Event) => {
    if (!held || held.liftedAt !== null || !(next instanceof PointerEvent) || next.pointerId !== held.id) return
    held.liftedAt = next.timeStamp
    setTimeout(stopListening, FOLLOW_UP_MS)
  }
  const stopListening = () => {
    if (!listening) return
    listening = false
    for (const kind of FOLLOW_UP_EVENTS) window.removeEventListener(kind, swallow, true)
    for (const kind of LIFT_EVENTS) window.removeEventListener(kind, lift, true)
  }
  for (const kind of FOLLOW_UP_EVENTS) window.addEventListener(kind, swallow, true)
  for (const kind of LIFT_EVENTS) window.addEventListener(kind, lift, true)
  // Without a held press the window ends as before; a held one keeps it until it is lifted.
  setTimeout(() => {
    if (!held) stopListening()
  }, FOLLOW_UP_MS)
  setTimeout(stopListening, HELD_PRESS_MS)
}

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
  const pointerDown = useRef('')
  const id = useId()

  // Unmounting closes it; calling close() in cleanup would race Strict Mode.
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [])

  function step(event: ConfirmEvent, press?: MouseEvent) {
    const next = confirmStep(flow.current, event)
    flow.current = next.flow
    if (next.close) {
      if (press && press.detail > 0) {
        const own = press.nativeEvent instanceof PointerEvent ? press.nativeEvent.pointerType : ''
        swallowRestOfPress(press, pressedWith(pointerDown.current, own))
      }
      dialog.current?.close()
    }
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
      onPointerDown={(event) => {
        scrimPress.current = event.target === event.currentTarget
        pointerDown.current = event.pointerType
      }}
      onClick={(event) => {
        event.stopPropagation()
        // The second click of a double click on the button that opened it lands on the
        // scrim while it is open; the browser's confirm() ignored it, and so does this.
        if (scrimPress.current && event.target === event.currentTarget && event.detail <= 1) step('dismiss', event)
      }}
    >
      <div className="confirm-dialog-body">
        <h2 id={`${id}-title`} className="confirm-dialog-title">{title}</h2>
        {message ? <p id={`${id}-message`} className="confirm-dialog-message">{message}</p> : null}
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={(event) => step('dismiss', event)}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={(event) => step('confirm', event)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  )
}
