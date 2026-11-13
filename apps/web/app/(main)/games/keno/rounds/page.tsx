import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { KenoIcon } from '@/app/ui/icons'
import { LocalTime } from '@/app/ui/local-time'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getKenoRounds, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Past Keno draws', robots: { index: false } }

/** Every draw, newest first, each with its own check (docs/adr/0028, phase 4). */
export default function KenoRoundsPage({ searchParams }: PageProps<'/games/keno/rounds'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/keno" className="hover:underline">Keno</Link>
        </p>
        <h1 className="page-title">Past draws</h1>
        <p className="page-description">Every round’s numbers, with its seed and hash, so anyone can check it was fair.</p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Rounds searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Rounds({ searchParams }: Pick<PageProps<'/games/keno/rounds'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const before = typeof params.before === 'string' && /^\d{1,9}$/.test(params.before) ? Number(params.before) : undefined
  const page = await getKenoRounds(before)
  if (!page) notFound()
  if (!page.rounds.length) {
    return (
      <section className="content-panel">
        <EmptyState icon={<KenoIcon size={28} />} title="No draws yet">
          The first draw comes out when the countdown on the Keno page ends.
        </EmptyState>
      </section>
    )
  }
  return (
    <section className="content-panel">
      <ul className="keno-tickets">
        {page.rounds.map((r) => (
          <li key={r.number}>
            <Link href={`/games/keno/rounds/${r.number}`} className="font-semibold hover:underline">Round #{r.number}</Link>
            <span className="text-sm text-muted">
              {r.numbers!.join(' · ')} · <LocalTime at={r.drawnAt!} as="posted" />
            </span>
          </li>
        ))}
      </ul>
      {page.next ? (
        <p className="mt-3">
          <Link href={`/games/keno/rounds?before=${page.next}`} className="btn btn-secondary">Older draws</Link>
        </p>
      ) : null}
    </section>
  )
}
