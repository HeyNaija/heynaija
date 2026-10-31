import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AgeVerificationPanel } from '@/app/ui/age-verification-panel'

export const metadata: Metadata = { title: 'Age verification' }

/**
 * Where Didit sends the member back to, and where a failed start lands. The result
 * is read from the API (which asks Didit if the webhook has not arrived yet); the
 * query string Didit appends is ignored, never trusted.
 */
export default function AgeVerificationPage({ searchParams }: PageProps<'/settings/age-verification'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Settings</p>
        <h1 className="page-title">Age verification</h1>
        <p className="page-description">Your result from the age check.</p>
      </header>
      <section className="content-panel settings-section" aria-labelledby="age-check-heading">
        <h2 id="age-check-heading" className="section-title">Your age check</h2>
        <Suspense fallback={<div aria-busy="true" className="skeleton h-24" />}>
          <Result searchParams={searchParams} />
        </Suspense>
      </section>
      <Link href="/settings" className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-accent-strong hover:underline">
        Back to settings
      </Link>
    </div>
  )
}

async function Result({ searchParams }: Pick<PageProps<'/settings/age-verification'>, 'searchParams'>) {
  const problem = (await searchParams).problem
  return (
    <AgeVerificationPanel
      problem={typeof problem === 'string' ? problem : undefined}
      whenOff={<p className="notice">Age verification is not available to you right now.</p>}
    />
  )
}
