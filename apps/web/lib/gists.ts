// Gists (docs/adr/0017, section 4a): the pure rules the room follows. No React, no
// browser and no livekit-client here, so this stays in the main bundle at almost no
// cost and is covered by tests/gists.test.mjs.

export type GistRole = 'host' | 'cohost' | 'speaker' | 'listener'
export type Person = { id: string; handle: string; displayName: string | null }

/** What GET /v1/gists/:id answers. */
export type GistView = {
  id: string
  title: string
  status: 'scheduled' | 'live' | 'ended'
  community: { id: string; slug: string; name: string } | null
  host: Person
  /** Co-hosts and speakers; the host is not repeated. */
  speakers: (Person & { role: 'cohost' | 'speaker' })[]
  locked: boolean
  requestsOpen: boolean
  listenerCap: number
  listenerCount: number
  peakListeners: number
  startedAt: string | null
  endedAt: string | null
  viewer: { role: GistRole | null; requestedToSpeak: boolean }
}

export type JoinResult = { url: string; token: string; role: GistRole; gist: GistView }
export type SpeakRequest = Person & { requestedAt: string }

export const personName = (p: Pick<Person, 'handle' | 'displayName'>) => p.displayName?.trim() || `@${p.handle}`

// ---- what each role may do ---------------------------------------------------

type ControlsInput = {
  status: GistView['status']
  requestsOpen: boolean
  viewer: { role: GistRole | null; requestedToSpeak: boolean }
  /** `gistStage` from /v1/me: false for a member who may only listen (under 18, or no date of birth). */
  mayTakeStage?: boolean
}

/**
 * The role-to-controls map. The API enforces every one of these again; this only
 * decides what to draw, so a listener is never shown a microphone, and a member who
 * may only listen is never offered to speak.
 */
export function controlsFor({ status, requestsOpen, viewer, mayTakeStage = true }: ControlsInput) {
  const none = { mic: false, request: false, cancelRequest: false, requestsClosed: false, moderate: false, settings: false, end: false, appointCohost: false }
  if (status !== 'live' || !viewer.role) return none
  const { role } = viewer
  const stage = role === 'host' || role === 'cohost' || role === 'speaker'
  const asking = role === 'listener' && mayTakeStage && !viewer.requestedToSpeak
  return {
    mic: stage && mayTakeStage,
    request: asking && requestsOpen,
    cancelRequest: role === 'listener' && viewer.requestedToSpeak,
    /** Say that the host is not taking requests: only to someone who could otherwise ask. */
    requestsClosed: asking && !requestsOpen,
    moderate: role === 'host' || role === 'cohost',
    settings: role === 'host',
    end: role === 'host',
    appointCohost: role === 'host',
  }
}

// ---- following the room by polling -------------------------------------------

export type Snapshot = { role: GistRole | null; status: GistView['status'] }

const ROLE_SENTENCE: Record<GistRole, string> = {
  host: 'You are the host.',
  cohost: 'You are now a co-host. Tap the microphone to talk.',
  speaker: 'You are now a speaker. Tap the microphone to talk.',
  listener: 'You are now a listener. Your microphone is off.',
}

/**
 * Folds a polled view into what the room last knew. `announcement` is for the
 * polite live region and is set only when something changed; `resync` asks the
 * room to call /sync so LiveKit's permissions follow the new role.
 */
export function applyView(prev: Snapshot, view: Pick<GistView, 'status' | 'viewer'>) {
  const role = view.viewer.role
  const ended = view.status === 'ended'
  let announcement: string | null = null
  let resync = false
  if (ended && prev.status !== 'ended') {
    announcement = 'This Gist has ended.'
  } else if (!ended && role && prev.role && role !== prev.role) {
    announcement = ROLE_SENTENCE[role]
    resync = true
  }
  return { role: role ?? prev.role, status: view.status, ended, announcement, resync }
}

export const POLL_BASE_MS = 4000
export const POLL_MAX_MS = 30_000

/** The wait before the next poll; null means do not poll (the tab is hidden). Failures back off. */
export function nextPollDelay({ hidden, failures }: { hidden: boolean; failures: number }): number | null {
  if (hidden) return null
  return Math.min(POLL_BASE_MS * 2 ** Math.min(failures, 10), POLL_MAX_MS)
}

// ---- joining -----------------------------------------------------------------

export type JoinFailure = 'notfound' | 'full' | 'locked' | 'ended' | 'retry'

/** Which room state a refused join or reconnect leads to. */
export function joinFailure(status: number, code: string | undefined): JoinFailure {
  if (status === 404) return 'notfound'
  if (status === 409 && code === 'gist_full') return 'full'
  if (status === 409 && code === 'gist_locked') return 'locked'
  if (status === 409 && code === 'gist_ended') return 'ended'
  return 'retry'
}

// ---- wording -------------------------------------------------------------------

export const listenerLabel = (n: number) =>
  n <= 0 ? 'No listeners yet' : `${n.toLocaleString('en-NG')} ${n === 1 ? 'listener' : 'listeners'}`

/** A Gist in the Live now list (GET /v1/gists/live). */
export type LiveGist = {
  id: string
  title: string
  host: Person
  community: { id: string; slug: string; name: string } | null
  listenerCount: number
  startedAt: string | null
}

/** The line under a Live now title: who hosts it, in which community, how many listen. */
export const liveMeta = (gist: Pick<LiveGist, 'host' | 'community' | 'listenerCount'>) =>
  [`Hosted by ${personName(gist.host)}`, gist.community ? `in ${gist.community.name}` : null, listenerLabel(gist.listenerCount)].filter(Boolean).join(' · ')

/** How often Home asks for the Live now list, while the tab is visible. */
export const LIVE_POLL_MS = 30_000

type Connection = { type?: string; saveData?: boolean } | undefined

/** About 43 MB an hour with three speakers (ADR 0017 section 4a); said plainly, louder on mobile data. */
export function dataUseHint(connection: Connection): string {
  const cost = 'Listening uses about 43 MB an hour.'
  if (connection?.type === 'cellular') return `You may be on mobile data. ${cost} Leave if you are low on data.`
  if (connection?.saveData) return `Your browser is set to save data. ${cost}`
  return `${cost} It is more on mobile data, so Wi-Fi is kinder to your bundle.`
}

/** Where the Home card finds "your Gist" again: the API has no list of live Gists yet. */
export const CURRENT_GIST_KEY = 'hn-gist-current'

/** What the API accepts (GistsService.create); its controller's schema is looser. */
export const TITLE_MAX = 120

export function titleProblem(title: string): string | null {
  const t = title.trim()
  if (!t) return 'Give your Gist a title.'
  if (t.length > TITLE_MAX) return `Keep the title to ${TITLE_MAX} characters or fewer.`
  return null
}

/**
 * Orders polled views. Responses arrive in any order, so each request takes a
 * ticket when it starts; a response applies only if it started after the last one
 * applied and after the member's last action (a view fetched before the action
 * may predate it, and must not undo it, least of all as a role downgrade).
 */
export function createLatest() {
  let issued = 0
  let applied = 0
  let floor = 0
  return {
    begin: () => ++issued,
    accept(ticket: number) {
      if (ticket <= applied || ticket <= floor) return false
      applied = ticket
      return true
    },
    /** Call when an action of the member's has finished: views requested before now are out of date. */
    noteAction() {
      floor = issued
    },
  }
}

// ---- the Gists button, its panel, and the bar over other pages ------------------

/** The phases in which the member is in a Gist, or on the way in: the sound is theirs to hear. */
export type InPhase = 'connecting' | 'live' | 'reconnecting'

export const isInGist = (phase: string | null | undefined): phase is InPhase => phase === 'connecting' || phase === 'live' || phase === 'reconnecting'

/** The Gists that are live, without the one the member is in. */
export const otherLive = <T extends { id: string }>(live: T[], currentId: string | null): T[] => live.filter((g) => g.id !== currentId)

/** What the Gists button in the top bar says to a screen reader: the member's own Gist first, then what else is live. */
export function gistsButtonLabel(inGist: boolean, othersLive: number): string {
  const n = othersLive.toLocaleString('en-NG')
  if (inGist && othersLive > 0) return `Gists. You are in one, and ${n} more ${othersLive === 1 ? 'is' : 'are'} live.`
  if (inGist) return 'Gists. You are in one.'
  if (othersLive > 0) return `Gists. ${n} live now.`
  return 'Gists'
}

/** Live now in the Gists panel, when there is nothing to list. */
export const noneLiveText = (inGist: boolean) => (inGist ? 'No other Gists are live right now.' : 'No Gists are live right now.')

/** What the bar and the panel say under the Gist's title: the connection while it is being made, a pause, then the member's microphone. */
export function gistBarStatus(s: { phase: string | null; hearing: boolean; mayUseMic: boolean; micOn: boolean; micBusy: boolean }): string {
  if (s.phase === 'connecting') return 'Connecting…'
  if (s.phase === 'reconnecting') return 'Reconnecting…'
  if (!s.hearing) return 'Paused. You are still in the Gist.'
  if (!s.mayUseMic) return 'Listening'
  if (s.micOn) return 'Your microphone is on'
  if (s.micBusy) return 'Starting your microphone…'
  return 'Your microphone is off'
}

/**
 * The bar over every page but the Gist's own: the Gist the member is in ('in'), why
 * they are no longer in it when that happened away from its page ('notice'), or nothing.
 */
export function gistDock(s: { roomId: string | null; phase: string | null; pathname: string; notice: string | null }): 'none' | 'in' | 'notice' {
  if (!s.roomId || s.pathname === `/gists/${s.roomId}`) return 'none'
  if (isInGist(s.phase)) return 'in'
  return s.notice ? 'notice' : 'none'
}

/**
 * Why the member is no longer in the Gist, said on the bar when it happens while they
 * are reading another page; null when they are still in, or never were. Leave says nothing:
 * the member knows.
 */
export function lostNotice(before: string | null, after: string | null): string | null {
  if (!isInGist(before) || isInGist(after)) return null
  switch (after) {
    case 'ended':
      return 'The Gist you were in has ended.'
    case 'elsewhere':
      return 'The Gist is playing in another tab or on another device.'
    case 'failed':
      return 'The connection to the Gist was lost.'
    case 'full':
    case 'locked':
      return 'Could not get back into the Gist.'
    // Back from the back/forward cache: the connection was dropped on the way out.
    case 'prejoin':
      return 'You left the Gist when you left HeyNaija.'
    default:
      return 'You are no longer in the Gist.'
  }
}
