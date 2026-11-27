/**
 * How long a Trivia round page waits for the API before asking again (docs/adr/0028).
 * The app does the same (TriviaWait.kt in heynaija-mobile).
 *
 * The API holds each request until the round changes: at the latest when the next
 * question opens or closes, or after 25 seconds. On patchy mobile data a reply can be
 * lost on the way while the browser still thinks the request is open. Waiting for the
 * browser to notice can cost a whole question (a tester missed two on 3G, 2026-11-22),
 * so the page gives up on a reply that is late and asks again.
 */

/** What the waits go by: a round as the API sends it. */
export type RoundTimes = {
  status: string
  startsAt: string
  current: { opensAt: string; closesAt: string; prompt: string | null } | null
}

/** The API holds a request 25 seconds at most: a reply later than this is not coming. */
export const HOLD_MS = 30_000
/** A question opening or closing gets a reply at once. One this late after it was lost. */
export const LATE_MS = 2_000
/** Never give up on a request sooner than this, doubled for each one given up on in a row, so a slow line still gets through. */
export const LEAST_MS = 4_000
/** Before the host starts the round there is no time to go by, and it can start at any moment. */
export const NO_TIMES_MS = 10_000
/** After a failed request, wait 1 second, then 2, 4… up to this. */
export const RETRY_MAX_MS = 30_000
/** …but while a round is on, or starts within 10 minutes, at most this. */
export const RETRY_LIVE_MS = 2_000

/** How long to wait for the next reply, by the server's clock (`serverNow`). `cuts`: requests given up on in a row. */
export function waitLimit(round: RoundTimes, serverNow: number, cuts: number): number {
  const least = Math.min(LEAST_MS * 2 ** Math.min(cuts, 3), HOLD_MS)
  const c = round.current
  let wait: number
  if (c) {
    // Waiting for the text as it opens, or for the close once it is on screen.
    const edge = Date.parse(c.prompt === null ? c.opensAt : c.closesAt)
    wait = Number.isNaN(edge) ? HOLD_MS : Math.max(0, edge - serverNow) + LATE_MS
  } else {
    wait = round.status === 'scheduled' || round.status === 'live' ? NO_TIMES_MS : HOLD_MS
  }
  return Math.min(Math.max(wait, least), HOLD_MS)
}

/** How long to wait after the `failures`th failed request in a row. */
export function retryPause(round: RoundTimes, serverNow: number, failures: number): number {
  const grown = Math.min(1000 * 2 ** Math.min(Math.max(failures - 1, 0), 5), RETRY_MAX_MS)
  const on =
    round.status === 'live' ||
    round.current !== null ||
    (round.status === 'scheduled' && Date.parse(round.startsAt) - serverNow < 10 * 60_000)
  return on ? Math.min(grown, RETRY_LIVE_MS) : grown
}
