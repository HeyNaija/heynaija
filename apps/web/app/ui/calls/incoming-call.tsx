'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { PhoneIcon, PhoneOffIcon } from '@/app/ui/icons'
import { apiCall } from '@/app/ui/gists/api'
import { activationAllowed, incomingPollDelay, mayTakeFocus, ringSecondsLeft, startFailure, type CallView } from '@/lib/calls'
import { personName } from '@/lib/gists'

/**
 * The incoming-call alert, on every page of the app for members who have calls
 * (it is mounted only when `features.calls` is on). It asks the API every few
 * seconds whether a call is ringing: there is no realtime channel, and a closed
 * tab cannot ring. Accept opens the call screen; Decline sends the caller a
 * "declined". It works over a DM page or anywhere else. It is announced by its role
 * and never steals focus from a field or an open dialog; otherwise focus goes to the
 * alert itself (not to a button). Nothing acts for the first 700 ms, and Esc does nothing:
 * only the Decline button declines.
 */
export function IncomingCall() {
  const router = useRouter()
  const pathname = usePathname()
  const titleId = useId()
  const descId = useId()
  const [call, setCall] = useState<CallView | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [missed, setMissed] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const shownAt = useRef(0)
  const returnTo = useRef<Element | null>(null)
  // Calls this tab already answered or dismissed, so a late poll does not bring them back.
  const handled = useRef(new Set<string>())
  const callRef = useRef(call)
  callRef.current = call

  // On the call screen the call itself is in front of the member; do not ask.
  const onCallScreen = pathname.startsWith('/calls/')

  useEffect(() => {
    if (onCallScreen) {
      setCall(null)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let stopped = false
    const tick = async () => {
      const res = await apiCall<{ call: CallView | null }>('GET', '/v1/calls/incoming')
      if (stopped) return
      // A 404 means calls are not for this member (or are off): ask rarely, not never.
      failures = res.ok ? 0 : res.status === 404 ? 3 : failures + 1
      if (res.ok) {
        const next = res.data.call && !handled.current.has(res.data.call.id) ? res.data.call : null
        const shown = callRef.current
        if (shown && !next && !handled.current.has(shown.id)) setMissed(`Missed call from ${personName(shown.other)}.`)
        setCall(next)
      }
      schedule()
    }
    const schedule = () => {
      if (stopped) return
      timer = setTimeout(tick, incomingPollDelay({ hidden: document.hidden, failures }))
    }
    const onVisibility = () => {
      if (document.hidden) return
      clearTimeout(timer)
      void tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [onCallScreen])

  // The countdown, and the end of the ring.
  useEffect(() => {
    if (!call) return
    setNow(Date.now())
    const t = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (ringSecondsLeft(call.ringExpiresAt, current) === 0) {
        handled.current.add(call.id)
        setMissed(`Missed call from ${personName(call.other)}.`)
        setCall(null)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [call])

  // When the alert appears: start the activation guard, and move focus to the alert only if that
  // would not pull it out of a field or a dialog. Focus goes back when the alert goes.
  const callId = call?.id
  useEffect(() => {
    if (!callId) return
    shownAt.current = Date.now()
    const active = document.activeElement
    const target = active instanceof HTMLElement ? { tagName: active.tagName, isContentEditable: active.isContentEditable, inModalDialog: Boolean(active.closest('dialog[open], [aria-modal="true"]')) } : null
    const moved = mayTakeFocus(target)
    if (moved) {
      returnTo.current = active
      dialog.current?.focus()
    }
    return () => {
      const back = returnTo.current
      returnTo.current = null
      if (moved && back instanceof HTMLElement && document.contains(back)) back.focus()
    }
  }, [callId])

  const decline = useCallback(async () => {
    const current = callRef.current
    if (!current || !activationAllowed(shownAt.current, Date.now())) return
    handled.current.add(current.id)
    setCall(null)
    await apiCall('POST', `/v1/calls/${current.id}/decline`)
  }, [])

  async function answer() {
    if (!call || !activationAllowed(shownAt.current, Date.now())) return
    setBusy(true)
    setError(null)
    const res = await apiCall<CallView>('POST', `/v1/calls/${call.id}/accept`)
    setBusy(false)
    if (!res.ok) {
      handled.current.add(call.id)
      setCall(null)
      setMissed('That call is no longer available.')
      if (res.status !== 404) setError(startFailure(res.status, res.code))
      return
    }
    handled.current.add(call.id)
    setCall(null)
    router.push(`/calls/${call.id}`)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Esc does nothing here: declining is the Decline button, and only that.
    if (event.key !== 'Tab') return
    // Once focus is inside the alert, keep Tab inside it. Focus elsewhere is left alone.
    if (!dialog.current?.contains(document.activeElement)) return
    const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!buttons || buttons.length === 0) return
    const first = buttons[0]!
    const last = buttons[buttons.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const left = call ? ringSecondsLeft(call.ringExpiresAt, now) : 0
  const name = call ? personName(call.other) : ''

  return (
    <>
      {/* A missed call is said once, politely, after the alert goes. */}
      <div role="status" aria-live="polite" className="sr-only">
        {missed}
      </div>
      {error ? (
        <p role="alert" className="notice notice-danger incoming-call-error">
          {error}
        </p>
      ) : null}
      {call ? (
        <div className="incoming-call-wrap">
          <div ref={dialog} role="alertdialog" aria-labelledby={titleId} aria-describedby={descId} className="incoming-call square-card" tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="incoming-call-who">
              <Avatar handle={call.other.handle} size={48} />
              <div className="min-w-0">
                <h2 id={titleId} className="section-title">
                  Incoming call
                </h2>
                <p id={descId} className="break-words text-sm">
                  {name} is calling
                  <span className="text-muted" aria-hidden="true">
                    {' '}
                    · {left}s
                  </span>
                </p>
              </div>
            </div>
            <div className="incoming-call-actions">
              <button type="button" className="btn btn-primary gist-btn" disabled={busy} onClick={() => void answer()}>
                <PhoneIcon size={20} />
                Accept
              </button>
              <button type="button" className="btn btn-danger gist-btn" disabled={busy} onClick={() => void decline()}>
                <PhoneOffIcon size={20} />
                Decline
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
