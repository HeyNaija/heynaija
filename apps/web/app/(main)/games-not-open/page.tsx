import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

export const metadata: Metadata = { title: 'Games', robots: { index: false } }

/**
 * What proxy.ts shows at a Games address (/games/...) to a member Games is not
 * open to (docs/deployment/app-links.md): why they can't see it, instead of "page
 * not found". The apps say the same (GAMES_NOT_OPEN in the mobile repository). With
 * `?why=unavailable`, the API did not answer, so whether it is open is not known yet.
 */
export default function GamesNotOpenPage({ searchParams }: PageProps<'/games-not-open'>) {
  return (
    <div className="state-page">
      <p className="page-eyebrow mb-3">Games</p>
      <Suspense fallback={<h1 className="page-title">Games</h1>}>
        <Why searchParams={searchParams} />
      </Suspense>
      <Link href="/" className="btn btn-primary mt-6">
        Back to the feed
      </Link>
    </div>
  )
}

async function Why({ searchParams }: Pick<PageProps<'/games-not-open'>, 'searchParams'>) {
  const { why } = await searchParams
  if (why === 'unavailable') {
    return (
      <>
        <h1 className="page-title">Games did not open</h1>
        <p className="mt-2 text-sm text-muted">HeyNaija could not check your account just now. Try again in a moment.</p>
      </>
    )
  }
  return (
    <>
      <h1 className="page-title">Games is not open to you yet</h1>
      <p className="mt-2 text-sm text-muted">Some members are trying it out first.</p>
    </>
  )
}
