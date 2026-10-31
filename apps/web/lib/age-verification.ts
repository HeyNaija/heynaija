/** What GET /v1/me/age-verification answers: the member's own result, and whether a check can be started. */
export type AgeVerificationState = {
  available: boolean
  status: 'none' | 'pending' | 'in_review' | 'verified' | 'declined' | 'expired'
  verified: boolean
}

export type AgeVerificationView = {
  value: string
  detail: string
  /** The button's words, or null when there is nothing to start. */
  action: string | null
}

/**
 * The state in words. A declined or expired check is not a statement about the
 * member's age, so it never says one: only that the check did not finish.
 */
export function ageVerificationView({ available, status }: AgeVerificationState): AgeVerificationView {
  const offer = (action: string) => (available ? action : null)
  const unavailable = available ? '' : ' Age verification is not available right now.'
  switch (status) {
    case 'verified':
      return { value: 'Verified as 18 or older', detail: 'Confirmed by an age check. HeyNaija keeps the result, not your document or your face.', action: null }
    case 'pending':
      return {
        value: 'Check started',
        detail: `You have started a check but it is not finished. It can take a few minutes after you finish.${unavailable}`,
        action: offer('Continue verifying'),
      }
    case 'in_review':
      return { value: 'Being reviewed', detail: 'Your check has gone to a person for review. This can take a while; you do not need to do anything.', action: null }
    case 'declined':
      return { value: 'Not verified', detail: `Your last check did not go through. You can try again.${unavailable}`, action: offer('Try again') }
    case 'expired':
      return { value: 'Not verified', detail: `Your last check ran out before it was finished. You can start a new one.${unavailable}`, action: offer('Try again') }
    default:
      return {
        value: 'Not verified',
        detail: `Optional. Some features, such as calls, need a verified age. A short check with your ID and a selfie, run by Didit.${unavailable}`,
        action: offer('Verify your age'),
      }
  }
}
