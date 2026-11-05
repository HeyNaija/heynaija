/**
 * Where the Lichess callback (/games/chess/callback) sends a member back to after
 * linking, when it is not /games/chess: a community moderator allowing
 * tournaments comes back to that community's chess page (docs/adr/0018, phase 6).
 */
export const RETURN_COOKIE = 'lichess_return'

/** Only a community chess page is a place to go back to. */
export const returnPath = (value: string | undefined): string | null => (value && /^\/games\/chess\/teams\/[a-z0-9-]{1,60}$/.test(value) ? value : null)
