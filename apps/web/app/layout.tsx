import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { themeScript } from '@/lib/theme'
import './globals.css'

// Downloaded at build time and served from our own origin: no request to Google
// from a member's browser, and the text shows in a system font until it arrives.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'HeyNaija', template: '%s · HeyNaija' },
  description: 'Real people. Real conversations. A social network for Nigerians at home and abroad.',
  icons: {
    icon: [{ url: '/brand/heynaija-mark.svg', type: 'image/svg+xml', sizes: 'any' }],
    apple: [{ url: '/apple-icon.png', type: 'image/png', sizes: '180x180' }],
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111a17' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // The script below sets data-theme on this element before React attaches, which
    // is exactly the mismatch suppressHydrationWarning is for.
    <html lang="en-NG" className={`${jakarta.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Runs once, as the browser parses the page. The type switch keeps React
            from warning about a script it will never execute on the client. */}
        <script
          type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  )
}
