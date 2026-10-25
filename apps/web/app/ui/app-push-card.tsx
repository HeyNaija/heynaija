'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { isInstalledApp, readPushState, turnOnPush } from './push-device'

const DISMISSED = 'hn-app-push-card'

/**
 * On the home page of HeyNaija opened as an installed app, an offer to turn on
 * push notifications, until the member takes it or says not now. It is how an
 * iPhone gets push at all: the welcome flow happened in Safari, where push does
 * not exist, and sent them here (welcome-notifications.tsx). Nothing shows in a
 * browser tab, where Settings has the switch, nor where push is already on or
 * blocked. "Not now" holds for this device.
 */
export function AppPushCard({ publicKey }: { publicKey: string }) {
  const [shown, setShown] = useState<'no' | 'offer' | 'on'>('no')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isInstalledApp()) return
    try {
      if (localStorage.getItem(DISMISSED)) return
    } catch {
      // No storage: offer it, and "Not now" lasts until the page is left.
    }
    let live = true
    void readPushState(publicKey).then((state) => live && state === 'off' && setShown('offer'))
    return () => {
      live = false
    }
  }, [publicKey])

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {}
    setShown('no')
  }

  async function turnOn() {
    setPending(true)
    setError('')
    const result = await turnOnPush(publicKey)
    setPending(false)
    if (result.state === 'on') {
      setShown('on')
      try {
        localStorage.setItem(DISMISSED, '1')
      } catch {}
    } else if (result.state === 'blocked') {
      // Asked and refused: not ours to ask again.
      dismiss()
    } else {
      setError(result.error ?? '')
    }
  }

  if (shown === 'no') return null
  return (
    <section className="welcome-nudge" aria-labelledby="app-push-title">
      <h2 id="app-push-title" className="section-title">
        {shown === 'on' ? 'Notifications are on' : 'Turn on notifications'}
      </h2>
      <p className="field-hint">
        {shown === 'on' ? (
          <>
            You will hear about replies, mentions and new followers on this device. Choose what notifies you in{' '}
            <Link href="/settings" className="font-semibold underline underline-offset-2">Settings</Link>.
          </>
        ) : (
          'Hear about replies, mentions and new followers as they happen, even with HeyNaija closed.'
        )}
      </p>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>
      <div className="welcome-actions">
        {shown === 'on' ? (
          <button type="button" onClick={() => setShown('no')} className="welcome-back">Done</button>
        ) : (
          <>
            <button type="button" disabled={pending} onClick={turnOn} className="btn btn-primary">
              {pending ? 'Turning on…' : 'Turn on notifications'}
            </button>
            <button type="button" onClick={dismiss} className="welcome-back">Not now</button>
          </>
        )}
      </div>
    </section>
  )
}
