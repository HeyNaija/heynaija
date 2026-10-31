// Pure rules for small group meetings (docs/adr/0017 stage 2): types, wording and seat counts.
// No React, no livekit-client, so tests/meetings.test.mjs covers them. The join / reconnect /
// leave machinery is the Gists one (lib/gist-session.ts); the incoming-invitation alert is the
// calls one (app/ui/calls/incoming-call.tsx, with lib/calls.ts's focus and activation rules).
import type { Person } from './gists.ts'

export type MeetingParticipantState = 'invited' | 'joined' | 'left' | 'declined' | 'missed' | 'removed'

export type MeetingPerson = Person & { state: 'joined' | 'invited'; isHost: boolean }

/** What GET /v1/meetings/:id answers. `participants` is empty unless the viewer is in the meeting now. */
export type MeetingView = {
  id: string
  status: 'open' | 'ended'
  locked: boolean
  capacity: number
  role: 'host' | 'participant'
  me: MeetingParticipantState
  host: Person
  participants: MeetingPerson[]
  startedAt: string
  endedAt: string | null
}

/** What GET /v1/meetings/incoming answers (inside `{ meeting }`). */
export type IncomingMeeting = { id: string; host: Person; expiresAt: string }

/** What POST /v1/meetings/:id/token answers. */
export type MeetingToken = { url: string; token: string; meeting: MeetingView }

/** An invitation's time left, in the largest sensible unit: "45s", then whole minutes rounded up. */
export function countdownLabel(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft))
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`
}

export const joinedPeople = (view: Pick<MeetingView, 'participants'>) => view.participants.filter((p) => p.state === 'joined')
export const invitedPeople = (view: Pick<MeetingView, 'participants'>) => view.participants.filter((p) => p.state === 'invited')

/** Joined and invited members both hold a seat. */
export const seatsLeft = (view: Pick<MeetingView, 'participants' | 'capacity'>) => Math.max(0, view.capacity - view.participants.length)

/** How a finished meeting is worded; null while it is open. Says nothing about who or why. */
export function meetingOutcome(view: Pick<MeetingView, 'status'>): { title: string; detail: string } | null {
  if (view.status === 'open') return null
  return { title: 'Meeting ended', detail: 'Meetings are not recorded.' }
}

/** The words for a meeting action that was refused. Never says why a refusal happened. */
export function meetingFailure(status: number, code: string | undefined): string {
  if (status === 404) return 'You cannot do that right now.'
  if (status === 409 && code === 'already_in_meeting') return 'You are already in a meeting.'
  if (status === 409 && code === 'in_call') return 'You are on a call. Hang up first.'
  if (status === 409 && code === 'full') return 'This meeting is full.'
  if (status === 409 && code === 'locked') return 'This meeting is locked.'
  if (status === 429) return 'Too many tries. Wait a little and try again.'
  if (status === 0) return 'Could not reach HeyNaija. Check your connection and try again.'
  return 'Meetings are not available right now. Try again in a moment.'
}

export const INVITE_SEARCH_DEBOUNCE_MS = 250
