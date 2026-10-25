'use client'

import { useEffect, useState } from 'react'
import { type PushState, readPushState, turnOffPush, turnOnPush } from './push-device'

/**
 * Turns push notifications on or off for the browser it is open in. Push belongs
 * to a browser, not an account, so this is a button that acts at once rather than
 * a box in the form below. Needs JavaScript, as push itself does.
 */
export function PushSwitch({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<PushState | 'checking'>('checking')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    void readPushState(publicKey).then((next) => live && setState(next))
    return () => {
      live = false
    }
  }, [publicKey])

  async function turn(to: 'on' | 'off') {
    setPending(true)
    setError('')
    const result = to === 'on' ? await turnOnPush(publicKey) : await turnOffPush()
    setState(result.state)
    setError(result.error ?? '')
    setPending(false)
  }

  return (
    <div role="group" aria-labelledby="push-label" aria-describedby="push-hint" className="flex flex-col gap-2">
      <p id="push-label" className="field-label">Push notifications</p>
      {state === 'checking' ? <p className="text-sm text-muted">Checking this browser…</p> : null}
      {state === 'off' || state === 'on' ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => turn(state === 'on' ? 'off' : 'on')}
            className={state === 'on' ? 'btn btn-secondary' : 'btn btn-primary'}
          >
            {pending ? (state === 'on' ? 'Turning off…' : 'Turning on…') : state === 'on' ? 'Turn off on this device' : 'Turn on push notifications'}
          </button>
          {/* A live region, not role="status": the form below has the section's status. */}
          <p aria-live="polite" className="text-sm text-muted">
            {state === 'on' ? 'On for this device.' : ''}
          </p>
        </div>
      ) : null}
      {state === 'blocked' ? (
        <p className="notice">
          Notifications from HeyNaija are blocked in this browser. Allow them in the browser’s settings for this site, then reload this page.
        </p>
      ) : null}
      {state === 'install' ? (
        <p className="notice">
          On an iPhone or iPad, add HeyNaija to your Home Screen first: tap Share, then Add to Home Screen. Open HeyNaija from
          there and come back to Settings.
        </p>
      ) : null}
      {state === 'unsupported' ? (
        <p className="notice">This browser cannot show push notifications. You will still see everything in HeyNaija.</p>
      ) : null}
      <p id="push-hint" className="field-hint">
        Get your notifications on this device as they happen, even when HeyNaija is closed. Only the account signed in here
        gets them, and signing out stops them. Anything you get as a push notification is not emailed as well.
      </p>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>
    </div>
  )
}
