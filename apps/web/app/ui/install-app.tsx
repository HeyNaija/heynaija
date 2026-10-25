'use client'

import { useEffect, useState } from 'react'

/** Chromium's install offer, held by lib/install.ts until a member asks for it. */
type InstallOffer = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

declare global {
  interface Window {
    __hnInstall?: InstallOffer | null
  }
}

/** The browser's offer to install HeyNaija, while there is one to take. */
function useInstallOffer() {
  const [offer, setOffer] = useState<InstallOffer | null>(null)
  useEffect(() => {
    const read = () => setOffer(window.__hnInstall ?? null)
    read()
    addEventListener('hn-installable', read)
    return () => removeEventListener('hn-installable', read)
  }, [])
  return offer
}

/**
 * Installs HeyNaija as an app, where the browser offers that (Chrome, Edge and
 * Samsung Internet; not Safari or Firefox). Renders nothing otherwise, including
 * once it is installed or opened as the app.
 */
export function InstallApp() {
  const offer = useInstallOffer()
  const [installed, setInstalled] = useState(false)

  async function install() {
    if (!offer) return
    await offer.prompt()
    const { outcome } = await offer.userChoice
    // An offer can be used once, whatever the answer.
    window.__hnInstall = null
    dispatchEvent(new Event('hn-installable'))
    if (outcome === 'accepted') setInstalled(true)
  }

  if (installed) {
    return (
      <p role="status" className="text-sm text-muted">
        Installed. HeyNaija is with your other apps now.
      </p>
    )
  }
  if (!offer) return null
  return (
    <div role="group" aria-labelledby="install-label" aria-describedby="install-hint" className="flex flex-col gap-2">
      <p id="install-label" className="field-label">HeyNaija app</p>
      <p id="install-hint" className="field-hint">Open HeyNaija from your home screen or desktop like your other apps, in its own window.</p>
      <button type="button" onClick={install} className="btn btn-secondary self-start">
        Install HeyNaija
      </button>
    </div>
  )
}
