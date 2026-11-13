'use client'

import Link from 'next/link'
import { useId } from 'react'
import { liveMeta } from '@/lib/gists'
import { useLiveGists } from './live-gists'

/**
 * Live now, on Home: the live Gists this member may join. The list is shared with the
 * Gists button in the top bar (live-gists.ts), so both ask once. Shows nothing until a
 * Gist is live.
 */
export function LiveNow() {
  const headingId = useId()
  const items = useLiveGists()

  if (items.length === 0) return null
  return (
    <section className="square-card gist-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title flex items-center gap-2">
        <span className="gist-live-dot" aria-hidden="true" /> Live now
      </h2>
      <ul className="gist-live-list">
        {items.map((gist) => (
          <li key={gist.id}>
            <Link href={`/gists/${gist.id}`} className="gist-live-item">
              <span className="gist-live-item-title">{gist.title}</span>
              <span className="text-sm text-muted">{liveMeta(gist)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
