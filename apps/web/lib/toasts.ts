export type ToastKind = 'success' | 'error'
export type ToastInput = { id: string; kind: ToastKind; message: string }
export type Toast = ToastInput & { remaining: number }
/** `at` is when the `remaining` times were last right; they run down from then unless paused. */
export type ToastState = { toasts: Toast[]; paused: boolean; at: number }

/** More than this on a phone would cover the page they are about. */
export const TOAST_MAX = 3
/** Long enough to read a short line twice; an error stays longer because it asks for something. */
export const TOAST_MS: Record<ToastKind, number> = { success: 5000, error: 8000 }

export const EMPTY_TOASTS: ToastState = { toasts: [], paused: false, at: 0 }

/** Takes the time that has passed off every toast and drops the ones that have none left. */
export function expireToasts(state: ToastState, now: number): ToastState {
  if (state.paused) return state
  const spent = now - state.at
  return {
    ...state,
    at: now,
    toasts: state.toasts.map((toast) => ({ ...toast, remaining: toast.remaining - spent })).filter((toast) => toast.remaining > 0),
  }
}

export function addToast(state: ToastState, toast: ToastInput, now: number): ToastState {
  const settled = expireToasts(state, now)
  if (settled.toasts.some((shown) => shown.id === toast.id)) return settled
  const others = settled.toasts.filter((shown) => shown.kind !== toast.kind || shown.message !== toast.message)
  return { ...settled, toasts: [...others, { ...toast, remaining: TOAST_MS[toast.kind] }].slice(-TOAST_MAX) }
}

/** Closing the last toast ends a pause: what held it (a pointer, the keyboard) went with it. */
export function dismissToast(state: ToastState, id: string): ToastState {
  const toasts = state.toasts.filter((toast) => toast.id !== id)
  return { ...state, toasts, paused: state.paused && toasts.length > 0 }
}

export function pauseToasts(state: ToastState, now: number): ToastState {
  return state.paused ? state : { ...expireToasts(state, now), paused: true }
}

export function resumeToasts(state: ToastState, now: number): ToastState {
  return state.paused ? { ...state, paused: false, at: now } : state
}

/** How long after `at` the next toast is due to go, or null when nothing is counting down. */
export function nextExpiry(state: ToastState): number | null {
  if (state.paused || !state.toasts.length) return null
  return Math.min(...state.toasts.map((toast) => toast.remaining))
}
