/**
 * Who may join or host a Gist (docs/adr/0017, sections 4a and 5).
 *
 * The real rule is "signed in, 18 or over, age-verified, opted in to calls, in good
 * standing". Age verification (ADR 0018) is built behind the `ageVerification`
 * flag; the opt-in and direct messages do not exist yet. So the gate is: signed in
 * (the caller has a session), the account is active, and `isAgeVerifiedAdult`:
 *
 *  - flag on for the member: a verified result is on record (`ageVerified`);
 *  - flag off for the member (`ageVerified` undefined): the member's handle is on
 *    the CALLS_MEMBERS beta allow-list, exactly as before.
 *
 * Every eligibility decision in the Gists code goes through `canJoinGist` and
 * `canHostGist`, and both end in `isAgeVerifiedAdult`. Do not add a second check
 * elsewhere.
 */

export type GistViewer = {
  id: string
  handle: string
  active: boolean
  /**
   * Whether a verified age result is on record, when the age-verification flag is on
   * for this member; undefined when it is off, which keeps the allow-list rule.
   * Whoever builds the viewer reads it fresh (AgeVerificationService.adultGate).
   */
  ageVerified?: boolean | undefined
}

export type GistFacts = { status: 'scheduled' | 'live' | 'ended'; communityId: string | null }

export type EligibilityConfig = { callsMembers: readonly string[] }

/** The one place that decides whether a member may take part in calls at all. */
export function isAgeVerifiedAdult(viewer: GistViewer, config: EligibilityConfig): boolean {
  if (!viewer.active) return false
  if (viewer.ageVerified !== undefined) return viewer.ageVerified
  return config.callsMembers.includes(viewer.handle.toLowerCase())
}

/**
 * May this viewer be shown and join this Gist? `inCommunity` is whether they
 * belong to the Gist's community (only read when it has one). Does not look at
 * blocks, the removed list, the cap or the lock: those are checked by the
 * service against live data.
 */
export function canJoinGist(viewer: GistViewer, gist: GistFacts, context: EligibilityConfig & { inCommunity: boolean }): boolean {
  if (!isAgeVerifiedAdult(viewer, context)) return false
  return gist.communityId === null || context.inCommunity
}

/** May this viewer host a Gist, be made a co-host, or be given the microphone? */
export function canHostGist(viewer: GistViewer, config: EligibilityConfig): boolean {
  return isAgeVerifiedAdult(viewer, config)
}
