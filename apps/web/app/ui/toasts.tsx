'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { addToast, dismissToast, EMPTY_TOASTS, expireToasts, nextExpiry, pauseToasts, resumeToasts, type ToastInput, type ToastKind } from '@/lib/toasts'
import { AlertIcon, CheckIcon, CloseIcon } from './icons'

type Show = (toast: { kind: ToastKind; message: string; id?: string }) => void

const ToastContext = createContext<Show | null>(null)
let made = 0

/** `useToast().show({ kind, message })`: a short line that something happened, gone again in a few seconds. */
export function useToast(): { show: Show } {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast outside ToastProvider')
  return useMemo(() => ({ show }), [show])
}

/**
 * Holds the toasts and draws them over the page: under the top bar on phones,
 * bottom right on desktop. A toast is never the only place an error is told: a
 * form's own error stays beside the form. The words are also put in two live
 * regions that are always in the page, because a screen reader only announces
 * changes to a region it already knows: successes politely, errors at once.
 * A toast raised while a modal dialog is open sits behind it, unseen and unheard,
 * so close the dialog first.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(EMPTY_TOASTS)

  const show = useCallback<Show>(({ id = `toast-${++made}`, kind, message }) => {
    const now = Date.now()
    setState((current) => addToast(current, { id, kind, message }, now))
  }, [])

  const due = nextExpiry(state)
  useEffect(() => {
    if (due === null) return
    const timer = setTimeout(() => {
      const now = Date.now()
      setState((current) => expireToasts(current, now))
    }, Math.max(0, state.at + due - Date.now()))
    return () => clearTimeout(timer)
  }, [due, state.at])

  const pause = () => {
    const now = Date.now()
    setState((current) => pauseToasts(current, now))
  }
  const resume = () => {
    const now = Date.now()
    setState((current) => resumeToasts(current, now))
  }
  const dismiss = (toast: ToastInput, stack: Element | null, pointerType: string | undefined) => {
    const now = Date.now()
    // A removed button sends no blur, so the keyboard's hold on the others ends here;
    // a mouse still over them keeps it until it leaves. A tap leaves the stack
    // matching :hover with no leave to come, so only a mouse counts.
    const held = pointerType === 'mouse' && (stack?.matches(':hover') ?? false)
    setState((current) => {
      const next = dismissToast(current, toast.id)
      return held ? next : resumeToasts(next, now)
    })
  }

  const said = (kind: ToastKind) => state.toasts.filter((toast) => toast.kind === kind).map((toast) => <p key={toast.id}>{toast.message}</p>)

  return (
    <ToastContext value={show}>
      {children}
      <div role="status" className="sr-only">{said('success')}</div>
      <div role="alert" className="sr-only">{said('error')}</div>
      {state.toasts.length ? (
        <section
          className="toast-stack"
          aria-label="Notifications"
          onPointerEnter={pause}
          onPointerLeave={(event) => {
            if (!event.currentTarget.contains(document.activeElement)) resume()
          }}
          onFocus={pause}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(':hover')) resume()
          }}
        >
          {state.toasts.map((toast) => (
            <div key={toast.id} className={`toast${toast.kind === 'error' ? ' toast-error' : ''}`}>
              {toast.kind === 'error' ? <AlertIcon size={18} /> : <CheckIcon size={18} />}
              {/* The live regions above have already said it. */}
              <p>{toast.message}</p>
              <button type="button" className="icon-btn toast-close" aria-label="Dismiss" onClick={(event) => dismiss(toast, event.currentTarget.closest('.toast-stack'), (event.nativeEvent as Partial<PointerEvent>).pointerType)}>
                <CloseIcon size={18} />
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </ToastContext>
  )
}
