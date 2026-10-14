import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HeyNaija',
    short_name: 'HeyNaija',
    description: 'A social network for Nigerians at home and abroad.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#008751',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
