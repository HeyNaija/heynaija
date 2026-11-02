'use client'

import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { LIVE_POLL_MS, type LiveGist, liveMeta } from '@/lib/gists'
import { gistCall } from './api'

/**
 * Live now, on Home: the live Gists this member may join (GET /v1/gists/live,
 * which never lists one they would be refused). Asked for again every 30
 * seconds while the tab is visible. Shows nothing until a Gist is live.
 */
export function LiveNow() {
  const headingId = useId()
  const [items, setItems] = useState<LiveGist[]>([])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      clearTimeout(timer)
      const res = await gistCall<{ items: LiveGist[] }>('GET', '/live')
      if (stopped) return
      // A failed ask keeps what is shown; the next one tries again.
      if (res.ok) setItems(res.data.items)
      if (!document.hidden) timer = setTimeout(load, LIVE_POLL_MS)
    }
    const onVisibility = () => (document.hidden ? clearTimeout(timer) : void load())
    void load()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

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
