// Pure rules for 1:1 calls (docs/adr/0017 stage 1): wording, the ring countdown and
// poll pacing. No React, no livekit-client, so tests/calls.test.mjs covers them.
// The join / reconnect / leave machinery is the Gists one (lib/gist-session.ts).
import type { Person } from './gists.ts'

export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined'

/** What GET /v1/calls/:id and /v1/calls/incoming answer. */
export type CallView = {
  id: string
  status: CallStatus
  role: 'caller' | 'callee'
  other: Person
  ringExpiresAt: string
  answeredAt: string | null
  endedAt: string | null
}

/** What POST /v1/calls/:id/token answers. */
export type CallToken = { url: string; token: string; call: CallView }

/** Whole seconds until the ring runs out, rounded up so "1" shows until it is really over. */
export function ringSecondsLeft(expiresAt: string, now: number): number {
  const ms = Date.parse(expiresAt) - now
  if (Number.isNaN(ms)) return 0
  return Math.max(0, Math.ceil(ms / 1000))
}

export const INCOMING_POLL_MS = 4000
export const INCOMING_HIDDEN_POLL_MS = 15_000
export const INCOMING_POLL_MAX_MS = 30_000

/**
 * The wait before asking whether a call is ringing. A hidden tab polls slowly rather than
 * not at all, so a call still shows when the member comes back. Failures back off.
 */
export function incomingPollDelay({ hidden, failures }: { hidden: boolean; failures: number }): number {
  const base = hidden ? INCOMING_HIDDEN_POLL_MS : INCOMING_POLL_MS
  return Math.min(base * 2 ** Math.min(failures, 10), INCOMING_POLL_MAX_MS)
}

/** How a finished call is worded for the viewer; null while it is still ringing or active. */
export function callOutcome(status: CallStatus, role: 'caller' | 'callee'): { title: string; detail: string } | null {
  switch (status) {
    case 'declined':
      return { title: 'Call declined', detail: 'They are not able to talk right now.' }
    case 'missed':
      return role === 'caller'
        ? { title: 'No answer', detail: 'They did not pick up. Calls ring for 45 seconds.' }
        : { title: 'Missed call', detail: 'The call ended before you answered.' }
    case 'ended':
      return { title: 'Call ended', detail: 'Calls are not recorded.' }
    default:
      return null
  }
}

/** The words for a call that could not be started. Never says why a refusal happened. */
export function startFailure(status: number, code: string | undefined): string {
  if (status === 404) return 'You cannot call this person right now.'
  if (status === 409 && code === 'already_in_call') return 'You are already on a call.'
  if (status === 409) return 'They are on another call. Try again in a few minutes.'
  if (status === 429) return 'Too many calls. Wait a little and try again.'
  if (status === 0) return 'Could not reach HeyNaija. Check your connection and try again.'
  return 'Calls are not available right now. Try again in a moment.'
}

/** A key press or tap on the incoming-call alert does nothing until it has been showing this long. */
export const ACTIVATION_GRACE_MS = 700

/**
 * Whether Accept or Decline may act yet. Someone typing when the alert appears must not
 * answer it with the Enter or Space they were already pressing.
 */
export function activationAllowed(shownAt: number, now: number): boolean {
  return now - shownAt >= ACTIVATION_GRACE_MS
}

/** What is focused when the alert appears. */
export type FocusTarget = { tagName?: string; isContentEditable?: boolean; inModalDialog?: boolean } | null

/**
 * May the alert move focus? Never out of a field (input, textarea, select, editable text) or
 * an open modal dialog: it is then announced and shown without taking focus.
 */
export function mayTakeFocus(active: FocusTarget): boolean {
  if (!active) return true
  if (active.isContentEditable || active.inModalDialog) return false
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes((active.tagName ?? '').toUpperCase())
}
