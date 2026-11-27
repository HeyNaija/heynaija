import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { KenoIcon } from '@/app/ui/icons'
import { LocalTime } from '@/app/ui/local-time'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getKenoTickets, getViewer } from '@/lib/api'
import { ticketResult } from '../_components/ticket'

export const metadata: Metadata = { title: 'Your Keno tickets', robots: { index: false } }

/** The member's Keno tickets, newest first (docs/adr/0028, phase 4). */
export default function KenoTicketsPage({ searchParams }: PageProps<'/games/keno/tickets'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/keno" className="hover:underline">Keno</Link>
        </p>
        <h1 className="page-title">Your tickets</h1>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Tickets searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Tickets({ searchParams }: Pick<PageProps<'/games/keno/tickets'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const before = typeof params.before === 'string' && !Number.isNaN(Date.parse(params.before)) ? params.before : undefined
  const page = await getKenoTickets(before)
  if (!page) notFound()
  if (!page.tickets.length) {
    return (
      <section className="content-panel">
        <EmptyState icon={<KenoIcon size={28} />} title="No tickets yet">
          <Link href="/games/keno" className="underline">Pick some numbers</Link> to play your first.
        </EmptyState>
      </section>
    )
  }
  return (
    <section className="content-panel">
      <ul className="keno-tickets">
        {page.tickets.map((t) => (
          <li key={t.id}>
            <span className="keno-ticket-numbers">
              {t.numbers.map((n) => (
                <span key={n} className="keno-chip">{n}</span>
              ))}
            </span>
            <span className="text-sm text-muted">
              {ticketResult(t)} ·{' '}
              <Link href={`/games/keno/rounds/${t.round}`} className="underline">Round #{t.round}</Link> ·{' '}
              <LocalTime at={t.createdAt} as="posted" />
            </span>
          </li>
        ))}
      </ul>
      {page.next ? (
        <p className="mt-3">
          <Link href={`/games/keno/tickets?before=${encodeURIComponent(page.next)}`} className="btn btn-secondary">Older tickets</Link>
        </p>
      ) : null}
    </section>
  )
}
