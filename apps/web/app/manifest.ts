import type { MetadataRoute } from 'next'

// What a phone or computer needs to install HeyNaija as an app. On an iPhone it
// is installed from Safari's Share menu, and only then can it get push
// notifications (docs/adr/0011).
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Fixed, so that a later change of start_url is still the same installed app.
    id: '/',
    name: 'HeyNaija',
    short_name: 'HeyNaija',
    description: 'A social network for Nigerians at home and abroad.',
    lang: 'en-NG',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#008751',
    categories: ['social'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      // For Android's own icon shapes: the letters sit inside the part never cropped.
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
