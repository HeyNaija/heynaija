import { type AgeStatus, isAdultFor } from '../governance/age.js'

/**
 * Who may join or host a Gist (docs/adr/0017, sections 4a and 5).
 *
 * TEMPORARY GATE. The real rule is "signed in, 18 or over, age-verified, opted in
 * to calls, in good standing", and none of age verification (ADR 0006), the
 * opt-in or direct messages exist yet. Until they do, the only gate is: signed in
 * (the caller has a session) AND the `gists` feature flag is on for the member
 * (in production only through its allow-list: see gists-enabled.guard.ts), and
 * the account is active.
 *
 * The stage has one rule more: hosting, co-hosting, speaking, asking to speak and
 * the microphone itself are for adults by their stated age (`gist_stage` in
 * governance/age.ts). Under 18 and unknown ages listen only, and a host cannot
 * hand them the microphone (ADR 0020, section 4; owner, 6 November 2026).
 *
 * Every eligibility decision in the Gists code goes through `canJoinGist` and
 * `canHostGist`, and both end in `isCallsMember`. When the real gate exists,
 * replace the body of `isCallsMember` (and give it the member data it needs);
 * nothing else in the module should change. Do not add a second check elsewhere.
 */

export type GistViewer = { id: string; handle: string; active: boolean }

/** A viewer with the age they are treated as having (`ageStatusOf`), for the stage. */
export type StageCandidate = GistViewer & { age: AgeStatus }

export type GistFacts = { status: 'scheduled' | 'live' | 'ended'; communityId: string | null }

/** `allowed` is `GistsAccess.member`, read once before the checks so that none of them awaits. */
export type EligibilityConfig = { allowed: (memberId: string) => boolean }

/**
 * The one place that decides whether a member may take part in calls at all. Notifications
 * are filtered by an SQL copy of this rule, `memberOpensGist` in gist-open.ts: change both together.
 */
function isCallsMember(viewer: GistViewer, config: EligibilityConfig): boolean {
  return viewer.active && config.allowed(viewer.id)
}

/**
 * May this viewer be shown and join this Gist, as a listener? `inCommunity` is
 * whether they belong to the Gist's community (only read when it has one). Does
 * not look at age, blocks, the removed list, the cap or the lock: those are
 * checked by the service against live data.
 */
export function canJoinGist(viewer: GistViewer, gist: GistFacts, context: EligibilityConfig & { inCommunity: boolean }): boolean {
  if (!isCallsMember(viewer, context)) return false
  return gist.communityId === null || context.inCommunity
}

/** May this viewer host a Gist, be made a co-host or speaker, ask to speak, or have the microphone? */
export function canHostGist(viewer: StageCandidate, config: EligibilityConfig): boolean {
  return isCallsMember(viewer, config) && isAdultFor(viewer.age, 'gist_stage')
}
