// Only Kratos's own logout URL (with its one-time token) is followed, so /logout
// cannot be used as an open redirect, and a forged link without the token signs
// nobody out.
export const isLogoutUrl = (url: string): boolean => url.startsWith('/kratos/self-service/logout?')

/**
 * Signing in again while signed in, which keeps the session and moves its
 * sign-in time forward, then back to `returnTo`: an absolute address on the
 * site's own origin, the only kind Kratos returns to (allowed_return_urls).
 */
export const reauthUrl = (returnTo: string): string =>
  `/kratos/self-service/login/browser?refresh=true&return_to=${encodeURIComponent(returnTo)}`
