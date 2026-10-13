import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'heynaija',
    short_name: 'heynaija',
    description: 'A Nigeria-first, community-owned social network.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf9f6',
    theme_color: '#0b7a4b',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
