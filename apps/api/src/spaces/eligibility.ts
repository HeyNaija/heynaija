/**
 * Who may join or host a Space (docs/adr/0017, sections 4a and 5).
 *
 * TEMPORARY GATE. The real rule is "signed in, 18 or over, age-verified, opted in
 * to calls, in good standing", and none of age verification (ADR 0006), the
 * opt-in or direct messages exist yet. Until they do, the only gate is: signed in
 * (the caller has a session) AND the member's handle is on the CALLS_MEMBERS
 * beta allow-list, and the account is active.
 *
 * Every eligibility decision in the Spaces code goes through `canJoinSpace` and
 * `canHostSpace`, and both end in `isCallsMember`. When the real gate exists,
 * replace the body of `isCallsMember` (and give it the member data it needs);
 * nothing else in the module should change. Do not add a second check elsewhere.
 */

export type SpaceViewer = { id: string; handle: string; active: boolean }

export type SpaceFacts = { status: 'scheduled' | 'live' | 'ended'; communityId: string | null }

export type EligibilityConfig = { callsMembers: readonly string[] }

/** The one place that decides whether a member may take part in calls at all. */
function isCallsMember(viewer: SpaceViewer, config: EligibilityConfig): boolean {
  return viewer.active && config.callsMembers.includes(viewer.handle.toLowerCase())
}

/**
 * May this viewer be shown and join this Space? `inCommunity` is whether they
 * belong to the Space's community (only read when it has one). Does not look at
 * blocks, the removed list, the cap or the lock: those are checked by the
 * service against live data.
 */
export function canJoinSpace(viewer: SpaceViewer, space: SpaceFacts, context: EligibilityConfig & { inCommunity: boolean }): boolean {
  if (!isCallsMember(viewer, context)) return false
  return space.communityId === null || context.inCommunity
}

/** May this viewer host a Space, be made a co-host, or be given the microphone? */
export function canHostSpace(viewer: SpaceViewer, config: EligibilityConfig): boolean {
  return isCallsMember(viewer, config)
}
