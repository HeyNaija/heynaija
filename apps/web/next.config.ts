import type { NextConfig } from 'next'

// The browser only ever talks to this origin. The NestJS API is proxied under
// /api and Ory Kratos (sign-in, sign-up, sessions) under /kratos, so cookies are
// first-party and no CORS is involved. The API's /internal routes are not proxied.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'
const kratosInternalUrl = process.env.KRATOS_INTERNAL_URL ?? 'http://127.0.0.1:4533'
// Public media bucket (MinIO locally). In production, route /media at the CDN
// straight to the R2 bucket so image bytes never pass through this server.
const mediaInternalUrl = process.env.MEDIA_INTERNAL_URL ?? 'http://127.0.0.1:9100/heynaija-media'

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Keep the development badge from covering the mobile Home tab.
  devIndicators: false,
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
      { source: '/media/:path*', destination: `${mediaInternalUrl}/:path*` },
    ]
  },
}

export default nextConfig
