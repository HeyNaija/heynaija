import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

export const metadata: Metadata = { title: 'Email notifications', robots: { index: false } }

/**
 * Where the unsubscribe link in a notification email lands, signed in or not.
 * The API has already turned email off by the time this shows (or refused the
 * link, which `?link=invalid` says).
 */
export default function EmailOffPage({ searchParams }: PageProps<'/email-off'>) {
  return (
    <div className="page-stack">
      <Suspense fallback={<div aria-busy="true" className="skeleton h-48" />}>
        <Result searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Result({ searchParams }: Pick<PageProps<'/email-off'>, 'searchParams'>) {
  const invalid = (await searchParams).link === 'invalid'
  return (
    <>
      <header className="page-intro">
        <p className="page-eyebrow">Email notifications</p>
        <h1 className="page-title">{invalid ? 'That link did not work' : 'Email notifications are off'}</h1>
        <p className="page-description">
          {invalid
            ? 'It may have been cut short when it was copied. Nothing was changed.'
            : 'We will not email you about your notifications any more. You will still see them in HeyNaija.'}
        </p>
      </header>
      <section className="content-panel settings-section">
        <p>
          {invalid
            ? 'Sign in and open Settings to turn email notifications off yourself.'
            : 'Changed your mind? Sign in and turn email back on in Settings, under Notifications.'}
        </p>
        <Link href="/settings" className="btn btn-secondary self-start">
          Open Settings
        </Link>
      </section>
    </>
  )
}
