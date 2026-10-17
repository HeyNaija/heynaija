'use client'

import Link from 'next/link'
import { type ReactNode, useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { loadOlderPosts } from '@/app/feed-actions'
import { type FeedSource, olderHref } from './feed-source'

/**
 * Batches that load on their own as the reader nears the end; one page comes from
 * the server, so about 150 posts. After that the reader asks with the button, which
 * keeps data use in their hands and the bottom of the page reachable.
 */
const AUTO_BATCHES = 4

/**
 * The rest of a feed, added under the server-rendered first page. Without
 * JavaScript, "Older posts" is a plain link to the next page; with it, the same
 * control loads in place.
 */
export function MorePosts({
  source,
  cursor,
  version,
}: {
  source: FeedSource
  /** Where the server-rendered page ends; null when there is nothing older. */
  cursor: string | null
  /** Changes whenever the server re-renders the page (after a like, mute, delete…). */
  version: number
}) {
  const [items, setItems] = useState<ReactNode[]>([])
  const [loaded, setLoaded] = useState(0)
  const [next, setNext] = useState(cursor)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const busy = useRef(false)
  // Bumped by every rebuild, so a load that started before one is not appended to it.
  const generation = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)
  // Server calls run as transitions. Outside one, a refresh landing while a call is
  // in flight makes React swap the whole feed for its loading skeleton, which
  // collapses the page and throws the reader back to the top.
  const [, startTransition] = useTransition()

  const load = useCallback(() => {
    if (busy.current || !next) return
    busy.current = true
    const gen = generation.current
    setStatus('loading')
    setMessage('Loading older posts…')
    startTransition(async () => {
      const result = await loadOlderPosts(source, next).catch(() => ({ error: true }) as const)
      if (gen !== generation.current) return
      startTransition(() => {
        busy.current = false
        if ('error' in result) {
          setStatus('error')
          setMessage('Older posts could not be loaded.')
          return
        }
        setItems((current) => [...current, ...result.items])
        setLoaded((n) => n + 1)
        setNext(result.cursor)
        setStatus('idle')
        setMessage(result.count === 1 ? '1 more post loaded' : `${result.count} more posts loaded`)
      })
    })
  }, [source, next])

  // A refresh re-renders the first page, which may now end somewhere else (new
  // posts arrived, one was deleted, someone was muted). Rebuild what was appended
  // from its new end, so nothing goes stale and nothing falls into a gap.
  const seen = useRef(version)
  useEffect(() => {
    if (seen.current === version) return
    seen.current = version
    const gen = ++generation.current
    if (loaded === 0 || !cursor) {
      busy.current = false
      setItems([])
      setLoaded(0)
      setNext(cursor)
      setStatus('idle')
      return
    }
    busy.current = true
    startTransition(async () => {
      const result = await loadOlderPosts(source, cursor, loaded).catch(() => ({ error: true }) as const)
      if (gen !== generation.current) return
      startTransition(() => {
        busy.current = false
        // On failure the old posts stay up; they are only stale until the next refresh.
        if ('error' in result) return
        setItems(result.items)
        setNext(result.cursor)
        setStatus('idle')
      })
    })
  }, [version, cursor, loaded, source])

  // Start the next batch about a screen before the reader gets to the end.
  const auto = loaded < AUTO_BATCHES && status === 'idle' && next !== null
  useEffect(() => {
    const target = sentinel.current
    if (!auto || !target) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && load(), {
      rootMargin: '0px 0px 100% 0px',
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [auto, load])

  return (
    <>
      {items.length ? <ul className="post-list more-posts">{items}</ul> : null}
      <div ref={sentinel} aria-hidden="true" />
      <p role="status" className="sr-only">
        {message}
      </p>

      {status === 'error' ? (
        <div className="notice notice-danger mt-4 flex flex-wrap items-center justify-between gap-3">
          <span>Older posts could not be loaded. Check your connection and try again.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            Try again
          </button>
        </div>
      ) : next ? (
        <Link
          href={olderHref(source, next)}
          prefetch={false}
          className="btn btn-secondary btn-block mt-4"
          aria-disabled={status === 'loading'}
          onClick={(e) => {
            e.preventDefault()
            load()
          }}
        >
          {status === 'loading' ? 'Loading older posts…' : 'Older posts'}
        </Link>
      ) : loaded > 0 ? (
        <p className="mt-6 text-center text-sm text-muted">No older posts.</p>
      ) : null}
    </>
  )
}
