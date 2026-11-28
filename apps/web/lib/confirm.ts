/**
 * The words of a confirmation. Call sites write one line, "Delete this post? This
 * cannot be undone.": the question is the dialog's title and the rest its message.
 * It is split at the last "? ", so a name in the question may hold one; a question
 * that ends in a name comes as `title` instead.
 */
export function confirmCopy(message: string, title?: string): { title: string; message: string | null } {
  if (title) return { title, message: message.trim() || null }
  const end = message.lastIndexOf('? ')
  if (end === -1) return { title: message, message: null }
  return { title: message.slice(0, end + 1), message: message.slice(end + 2).trim() || null }
}

export type ConfirmFlow = 'asking' | 'confirmed' | 'done'
export type ConfirmEvent = 'confirm' | 'dismiss' | 'closed'
export type ConfirmStep = { flow: ConfirmFlow; close: boolean; answer: 'confirm' | 'cancel' | null }

/**
 * One question gets one answer, given once the dialog has closed (so focus is back
 * on the page first). `confirm` is the confirm button, `dismiss` is Cancel or the
 * scrim, and `closed` is the dialog closing, which is all Esc sends.
 */
export function confirmStep(flow: ConfirmFlow, event: ConfirmEvent): ConfirmStep {
  if (event === 'closed') {
    if (flow === 'done') return { flow, close: false, answer: null }
    return { flow: 'done', close: false, answer: flow === 'confirmed' ? 'confirm' : 'cancel' }
  }
  if (flow !== 'asking') return { flow, close: false, answer: null }
  return { flow: event === 'confirm' ? 'confirmed' : 'asking', close: true, answer: null }
}

/** A press: where and when, and the pointer it came from ('' when the browser does not say). */
export type Press = { x: number; y: number; at: number; pointerType: string }

/** How long after the dialog closes the rest of a double click or double tap can still arrive. */
export const FOLLOW_UP_MS = 500
const TAP_SLOP_PX = 30

const byTouch = (pointerType: string) => pointerType === 'touch' || pointerType === 'pen'

/** The pointer a press came from: the one its pointerdown named, since Safari's click after a tap says 'mouse' or nothing. */
export const pressedWith = (down: string, click: string) => down || click

/**
 * Whether a click that arrives after a press closed the dialog is the rest of that
 * same press (the second click of a double click, the second tap of a double tap),
 * which would otherwise land on whatever the dialog was covering. A mouse says so
 * itself in `detail`, except on pointerdown, which carries no count; that, and a
 * finger or pen, is judged by time and place. Safari follows a tap with a mousedown
 * and click counted 1, with no pointer type or 'mouse', so after a tap closed the
 * dialog any counted press is judged like the tap.
 */
export function continuesPress(first: Press, next: Press & { detail: number }): boolean {
  if (next.at - first.at > FOLLOW_UP_MS) return false
  if (next.detail > 1) return true
  const uncounted = next.pointerType === 'mouse' && next.detail === 0
  const afterTap = byTouch(first.pointerType) && next.detail > 0
  if (!byTouch(next.pointerType) && !uncounted && !afterTap) return false
  return Math.hypot(next.x - first.x, next.y - first.y) <= TAP_SLOP_PX
}

/**
 * A follow-up press whose pointerdown was stopped: where it went down, and when it was
 * lifted (null while it is still held).
 */
export type HeldPress = { x: number; y: number; liftedAt: number | null }

/**
 * Whether a mousedown, click or dblclick is the rest of a held press. A slow second
 * click or a long second tap goes down in time but ends after FOLLOW_UP_MS, so its
 * mousedown and click are judged by place: until FOLLOW_UP_MS after it is lifted. A
 * click from the keyboard (`detail` 0) is never part of it.
 */
export function restOfHeldPress(held: HeldPress, next: Omit<Press, 'pointerType'> & { detail: number }): boolean {
  if (next.detail === 0) return false
  if (held.liftedAt !== null && next.at - held.liftedAt > FOLLOW_UP_MS) return false
  return Math.hypot(next.x - held.x, next.y - held.y) <= TAP_SLOP_PX
}

/**
 * Where Tab should land to stay inside a dialog of `count` controls when focus is
 * on control `index` (-1: on none of them), or null to let the browser move it.
 */
export function wrapFocus(count: number, index: number, shift: boolean): number | null {
  if (!count) return null
  if (shift) return index <= 0 ? count - 1 : null
  return index === -1 || index === count - 1 ? 0 : null
}
