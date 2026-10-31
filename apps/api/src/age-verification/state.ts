import type { AGE_VERIFICATION_STATUSES } from '@heynaija/db'

export type VerificationStatus = (typeof AGE_VERIFICATION_STATUSES)[number]

/** The part of a stored result the rules look at. Nothing else of the provider's answer is kept. */
export type StoredVerification = {
  status: VerificationStatus
  diditSessionId: string
  method: string | null
  verifiedAt: Date | null
}

/** What a webhook or a polled decision says: Didit's session, its exact status string, and how an approval was reached. */
export type DiditStatusEvent = { sessionId: string; status: string; method?: string | undefined }

export type Change = { change: 'none' } | { change: 'update'; status: VerificationStatus; method: string | null; verifiedAt: Date | null }

/**
 * Didit's status strings are exact and case-sensitive ("Kyc Expired" has one capital
 * K). Not Started, In Progress, Resubmitted, Awaiting User and anything new are not
 * an outcome, so they map to nothing and the stored result stays as it is.
 * Abandoned is a session that will not be finished: the member may start again.
 */
export function statusFromDidit(didit: string): VerificationStatus | null {
  switch (didit) {
    case 'Approved':
      return 'verified'
    case 'Declined':
      return 'declined'
    case 'In Review':
      return 'in_review'
    case 'Expired':
    case 'Kyc Expired':
    case 'Abandoned':
      return 'expired'
    default:
      return null
  }
}

/**
 * Which moves a result may make. Deliveries repeat and arrive out of order (Didit
 * says so), so an event never moves a result back to an earlier stage: a late
 * "In Review" cannot undo an approval. The two moves that look backwards are
 * deliberate: a reviewer in Didit's console can approve a declined or expired
 * session, and can reverse an approval, and both are Didit's decision to make.
 */
const MOVES: Record<VerificationStatus, readonly VerificationStatus[]> = {
  pending: ['in_review', 'verified', 'declined', 'expired'],
  in_review: ['verified', 'declined', 'expired'],
  verified: ['declined'],
  declined: ['verified'],
  expired: ['verified'],
}

/**
 * What one status event does to the stored result. Only the session this member
 * started counts; any other (an old session, someone else's) changes nothing.
 * `verifiedAt` is set on approval and cleared when approval is withdrawn.
 */
export function transition(current: StoredVerification | undefined, event: DiditStatusEvent, now: Date): Change {
  if (!current || current.diditSessionId !== event.sessionId) return { change: 'none' }
  const next = statusFromDidit(event.status)
  if (next === null || !MOVES[current.status].includes(next)) return { change: 'none' }
  if (next === 'verified') return { change: 'update', status: 'verified', method: event.method ?? 'didit', verifiedAt: now }
  return { change: 'update', status: next, method: null, verifiedAt: null }
}

/**
 * What asking to verify does. Someone already verified has nothing to do, and one
 * whose session is with a reviewer must wait. Otherwise a session is started:
 * for a member with a session still open Didit hands back that same session
 * (one open session per workflow and member), so asking again resumes it.
 */
export function sessionAction(current: StoredVerification | undefined): 'start' | 'already_verified' | 'in_review' {
  if (current?.status === 'verified') return 'already_verified'
  if (current?.status === 'in_review') return 'in_review'
  return 'start'
}

/** How an approval was reached, from the decision's features. Only this word is kept, never the decision. */
export function methodFromDecision(decision: unknown): 'document' | 'age_estimation' | 'didit' {
  if (decision === null || typeof decision !== 'object') return 'didit'
  const { id_verifications: ids, features } = decision as { id_verifications?: unknown; features?: unknown }
  if (Array.isArray(ids) && ids.length > 0) return 'document'
  if (Array.isArray(features) && features.includes('AGE_ESTIMATION')) return 'age_estimation'
  return 'didit'
}

/** Whether this stored result counts as an adult. */
export const isVerifiedAdult = (row: Pick<StoredVerification, 'status'> | undefined): boolean => row?.status === 'verified'
