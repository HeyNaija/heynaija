import type { ReactNode } from 'react'
import { startAgeVerification } from '@/app/actions'
import { ageVerificationView } from '@/lib/age-verification'
import { getAgeVerification } from '@/lib/api'

/**
 * The member's age check: its state in words, and the button that sends them to
 * Didit. Renders nothing while the feature is off for the member (the API answers
 * 404), so a build or a member without it sees no trace of it.
 */
export async function AgeVerificationPanel({ problem, whenOff = null }: { problem?: string | undefined; whenOff?: ReactNode }) {
  const state = await getAgeVerification()
  if (!state) return whenOff
  const view = ageVerificationView(state)
  return (
    <>
      {problem ? (
        <p role="alert" className="notice notice-danger">
          {problem === 'busy'
            ? 'You have started several checks this hour. Try again in an hour.'
            : 'The check could not be started just now. Try again in a few minutes.'}
        </p>
      ) : null}
      <dl className="settings-status">
        <div>
          <dt>Age check</dt>
          <dd>
            <p className="settings-status-value">{view.value}</p>
            <p>{view.detail}</p>
          </dd>
        </div>
      </dl>
      {view.action ? (
        <form action={startAgeVerification}>
          <button type="submit" className="btn btn-primary self-start">{view.action}</button>
        </form>
      ) : null}
    </>
  )
}
