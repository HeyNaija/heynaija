'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PhoneIcon } from '@/app/ui/icons'
import { apiCall } from '@/app/ui/gists/api'
import { startFailure, type CallView } from '@/lib/calls'

/**
 * "Call" on a member's profile, shown only when `features.calls` is on and the API
 * says this member can be called (it answers a plain yes or no). It moves to the
 * DM header when direct messages ship (ADR 0016).
 */
export function CallButton({ memberId, name }: { memberId: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    const res = await apiCall<CallView>('POST', '/v1/calls', { memberId })
    if (res.ok) return router.push(`/calls/${res.data.id}`)
    setBusy(false)
    setError(startFailure(res.status, res.code))
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" disabled={busy} aria-label={`Call ${name}`} onClick={() => void start()}>
        <PhoneIcon size={18} />
        Call
      </button>
      {error ? (
        <p role="alert" className="notice notice-danger call-button-error">
          {error}
        </p>
      ) : null}
    </>
  )
}
