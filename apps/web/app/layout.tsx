import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'heynaija', template: '%s · heynaija' },
  description: 'A Nigeria-first, community-owned social network on the AT Protocol.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1411' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-NG" className="h-full antialiased">
      <body className="min-h-full font-sans">
        <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4">
          <header className="flex items-center justify-between py-4">
            <Link href="/" className="text-xl font-bold tracking-tight">
              hey<span className="text-accent">naija</span>
            </Link>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
              private beta
            </span>
          </header>
          <main className="flex-1 pb-16">{children}</main>
        </div>
      </body>
    </html>
  )
}
