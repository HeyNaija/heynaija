import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

export const metadata: Metadata = { title: 'Email settings', robots: { index: false } }

/**
 * Where the unsubscribe link in a notification email lands, signed in or not,
 * and with `?what=highlights` the one in a weekly highlights email. The API has
 * already turned it off by the time this shows (or refused the link, which
 * `?link=invalid` says).
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
  const params = await searchParams
  const invalid = params.link === 'invalid'
  // The link in a weekly highlights email turns those off and nothing else (docs/adr/0027).
  const highlights = params.what === 'highlights'
  const turnedOff = highlights
    ? {
        eyebrow: 'Weekly highlights',
        title: 'Weekly highlights are off',
        description: 'We will not send you weekly highlights any more. Your notifications, and whether they are emailed, are as they were.',
        back: 'Changed your mind? Sign in and turn weekly highlights back on in Settings, under Notifications.',
        yourself: 'Sign in and open Settings to turn weekly highlights off yourself.',
      }
    : {
        eyebrow: 'Email notifications',
        title: 'Email notifications are off',
        description: 'We will not email you about your notifications any more. You will still see them in HeyNaija.',
        back: 'Changed your mind? Sign in and turn email back on in Settings, under Notifications.',
        yourself: 'Sign in and open Settings to turn email notifications off yourself.',
      }
  return (
    <>
      <header className="page-intro">
        <p className="page-eyebrow">{turnedOff.eyebrow}</p>
        <h1 className="page-title">{invalid ? 'That link did not work' : turnedOff.title}</h1>
        <p className="page-description">
          {invalid ? 'It may have been cut short when it was copied. Nothing was changed.' : turnedOff.description}
        </p>
      </header>
      <section className="content-panel settings-section">
        <p>{invalid ? turnedOff.yourself : turnedOff.back}</p>
        <Link href="/settings" className="btn btn-secondary self-start">
          Open Settings
        </Link>
      </section>
    </>
  )
}
