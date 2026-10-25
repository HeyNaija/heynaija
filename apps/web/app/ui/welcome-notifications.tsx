'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { AppleShareIcon } from './icons'
import { InstallApp } from './install-app'
import { type PushState, readPushState, turnOnPush } from './push-device'

/**
 * The welcome flow's offer of push notifications, for the device it is open on.
 * Push asks the browser for permission only when the member taps the button, never
 * on arrival. On an iPhone or iPad in Safari, where push does not exist until
 * HeyNaija is on the Home Screen, it shows how to put it there instead; the home
 * page's card makes the offer again once it is opened from there (app-push-card.tsx).
 * Without JavaScript there is no push, and this is just a way on.
 */
export function WelcomeNotifications({ publicKey, next }: { publicKey: string; next: string }) {
  const [state, setState] = useState<PushState | 'checking'>('checking')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const onward = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    let live = true
    void readPushState(publicKey).then((next) => live && setState(next))
    return () => {
      live = false
    }
  }, [publicKey])

  async function turnOn() {
    setPending(true)
    setError('')
    const result = await turnOnPush(publicKey)
    setState(result.state)
    setError(result.error ?? '')
    setPending(false)
    // The button is gone once push is on; the way on is the next thing to do.
    if (result.state === 'on') requestAnimationFrame(() => onward.current?.focus())
  }

  return (
    <section className="content-panel settings-section" aria-labelledby="welcome-push-title">
      {state === 'install' ? (
        <div>
          <h2 id="welcome-push-title" className="section-title">Add HeyNaija to your Home Screen</h2>
          <p className="field-hint mt-1">
            On an iPhone or iPad, notifications only come to HeyNaija opened from the Home Screen.
          </p>
          <ol className="install-steps mt-4">
            {/* Each step is one span, so that the number beside it lines up with the sentence. */}
            <li>
              <span>
                Tap <span className="install-steps-key"><AppleShareIcon size={16} />Share</span> in your browser. If you do not see it, tap <span className="install-steps-key"><span aria-hidden="true">•••</span><span className="sr-only">More</span></span> first.
              </span>
            </li>
            <li>
              <span>
                Choose <strong>Add to Home Screen</strong> (under <strong>More</strong> if you do not see it). Leave{' '}
                <strong>Open as Web App</strong> on if it is there, then tap <strong>Add</strong>.
              </span>
            </li>
            <li>
              <span>Open HeyNaija from your Home Screen and sign in if it asks. It will offer to turn notifications on there.</span>
            </li>
          </ol>
        </div>
      ) : (
        <div>
          <h2 id="welcome-push-title" className="section-title">Notifications on this device</h2>
          <p className="field-hint mt-1">
            Replies, mentions, quotes and new followers show up as they happen, even with HeyNaija closed. Only this device
            gets them, and you can choose what notifies you, or turn them off, in Settings.
          </p>
        </div>
      )}

      {state === 'on' ? (
        <p role="status" className="notice">Notifications are on for this device.</p>
      ) : null}
      {state === 'blocked' ? (
        <p className="notice">
          Notifications from HeyNaija are blocked in this browser. To get them, allow notifications for this site in the
          browser’s settings, then turn them on in Settings.
        </p>
      ) : null}
      {state === 'unsupported' ? (
        <p className="notice">This browser cannot show notifications. Everything still shows under Notifications in HeyNaija.</p>
      ) : null}
      {state !== 'install' ? (
        <InstallApp />
      ) : null}
      <p role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>

      <div className="welcome-actions">
        {state === 'off' ? (
          <>
            <button type="button" disabled={pending} onClick={turnOn} className="btn btn-primary">
              {pending ? 'Turning on…' : 'Turn on notifications'}
            </button>
            <Link href={next} className="btn btn-ghost">Not now</Link>
          </>
        ) : (
          <Link ref={onward} href={next} className="btn btn-primary">Continue</Link>
        )}
      </div>
    </section>
  )
}
