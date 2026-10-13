import type { NextConfig } from 'next'

// The browser only ever talks to this origin. The NestJS API is proxied under
// /api and Ory Kratos (sign-in, sign-up, sessions) under /kratos, so cookies are
// first-party and no CORS is involved. The API's /internal routes are not proxied.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'
const kratosInternalUrl = process.env.KRATOS_INTERNAL_URL ?? 'http://127.0.0.1:4533'

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Dev is served on 127.0.0.1, the origin Kratos is configured to issue cookies
  // and redirects for (infra/kratos/kratos.yml).
  allowedDevOrigins: ['127.0.0.1'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${apiInternalUrl}/v1/:path*` },
      { source: '/kratos/:path*', destination: `${kratosInternalUrl}/:path*` },
    ]
  },
}

export default nextConfig
