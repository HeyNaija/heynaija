/** Only the provider's local logout endpoint is followed; Kratos validates its token. */
export const isLogoutUrl = (url: string): boolean => url.startsWith('/api/v1/auth/logout?')
