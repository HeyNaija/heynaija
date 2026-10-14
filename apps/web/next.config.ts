import path from 'node:path'
import type { NextConfig } from 'next'

// The browser only ever talks to this origin. The NestJS API is proxied under
// /api and Ory Kratos (sign-in, sign-up, sessions) under /kratos, so cookies are
// first-party and no CORS is involved. The API's /internal routes are not proxied.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'
const kratosInternalUrl = process.env.KRATOS_INTERNAL_URL ?? 'http://127.0.0.1:4533'
// Public media bucket (MinIO locally). In a deployment nginx serves /media itself
// (infra/deploy/nginx/heynaija.conf.template), so this rewrite is only used in development.
// These three are read when `next build` runs: the Docker build passes them in.
const mediaInternalUrl = process.env.MEDIA_INTERNAL_URL ?? 'http://127.0.0.1:9100/heynaija-media'

const nextConfig: NextConfig = {
  // A self-contained server with only the files it needs, for the Docker image.
  output: 'standalone',
  // The monorepo root, so the standalone build includes workspace packages.
  outputFileTracingRoot: path.join(__dirname, '../..'),
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
