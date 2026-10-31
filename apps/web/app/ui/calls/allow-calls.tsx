'use client'

import { useId, useState } from 'react'
import { apiCall } from '@/app/ui/gists/api'

/** The "Allow calls" switch (ADR 0017 section 5), off until the member turns it on. Settings, for members who have calls. */
export function AllowCalls({ initial }: { initial: boolean }) {
  const hintId = useId()
  const [on, setOn] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function change(next: boolean) {
    setSaving(true)
    setError(null)
    const res = await apiCall<{ allowCalls: boolean }>('PUT', '/v1/calls/settings', { allowCalls: next })
    setSaving(false)
    if (res.ok) setOn(res.data.allowCalls)
    else setError('Could not save that. Try again.')
  }

  return (
    <div>
      <label className="gist-switch">
        <input type="checkbox" checked={on} disabled={saving} aria-describedby={hintId} onChange={(event) => void change(event.target.checked)} />
        <span>
          <span className="font-semibold">Allow calls</span>
          <span id={hintId} className="field-hint block">
            Lets people you can already message ring you, and lets you ring them. Off by default. Keep HeyNaija open to receive calls: a closed tab cannot ring. Calls are not recorded.
          </span>
        </span>
      </label>
      {error ? (
        <p role="alert" className="notice notice-danger mt-2">
          {error}
        </p>
      ) : null}
    </div>
  )
}
