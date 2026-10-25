// Only Kratos's own logout URL (with its one-time token) is followed, so /logout
// cannot be used as an open redirect, and a forged link without the token signs
// nobody out.
export const isLogoutUrl = (url: string): boolean => url.startsWith('/kratos/self-service/logout?')
