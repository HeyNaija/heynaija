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

export type Press = { x: number; y: number; at: number }

/** How long after the dialog closes the rest of a double click or double tap can still arrive. */
export const FOLLOW_UP_MS = 500
const TAP_SLOP_PX = 30

/**
 * Whether a click that arrives after a press closed the dialog is the rest of that
 * same press (the second click of a double click, the second tap of a double tap),
 * which would otherwise land on whatever the dialog was covering. A mouse says so
 * itself in `detail`; a finger or pen is judged by time and place.
 */
export function continuesPress(first: Press, next: Press & { detail: number; pointerType: string }): boolean {
  if (next.at - first.at > FOLLOW_UP_MS) return false
  if (next.detail > 1) return true
  if (next.pointerType !== 'touch' && next.pointerType !== 'pen') return false
  return Math.hypot(next.x - first.x, next.y - first.y) <= TAP_SLOP_PX
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
