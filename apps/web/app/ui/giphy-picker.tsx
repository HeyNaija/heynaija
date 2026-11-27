'use client'

import { GiphyFetch } from '@giphy/js-fetch-api'
import { type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { GIPHY_ID } from '@/lib/giphy'
import { useFixedPlacement } from './use-fixed-placement'

const PAGE = 12

type Found = { id: string; title: string; src: string }

type Page = { found: Found[]; next: number | null }

/**
 * The GIF search of the composer, in its own chunk with Giphy's fetch library, so the box
 * carries neither until someone opens it. The member's browser talks to Giphy directly
 * (Giphy asks that calls and media are not proxied), limited to G and PG. Searching waits for
 * Enter, so a few keystrokes do not spend a key's hourly allowance.
 */
export default function GiphyPicker({
  anchor,
  apiKey,
  focusSearch,
  onPick,
  onUpload,
}: {
  anchor: RefObject<HTMLElement | null>
  apiKey: string
  /** Opened from the keyboard: focus moves into the picker. Opened by pointer, the box keeps it. */
  focusSearch: boolean
  onPick: (gif: { id: string; title: string }) => void
  /** The member would rather add a GIF file of their own. */
  onUpload: () => void
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<Found[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Counts restarts of the list, so a "More" answer that comes after a new search is dropped.
  const run = useRef(0)
  const client = useMemo(() => new GiphyFetch(apiKey), [apiKey])
  useFixedPlacement(anchor, panel, true, { tallest: 440, widest: 360 })

  useEffect(() => {
    if (focusSearch) search.current?.focus({ preventScroll: true })
  }, [focusSearch])

  const fetchPage = useCallback(
    async (offset: number): Promise<Page> => {
      const options = { limit: PAGE, offset, rating: 'pg' as const }
      const result = term ? await client.search(term, options) : await client.trending(options)
      const found: Found[] = []
      for (const gif of result.data) {
        const small = gif.images.fixed_width_small ?? gif.images.fixed_width
        const src = (small as { webp?: string; url: string }).webp ?? small.url
        // An id that is not letters and digits could not be posted, so it is not offered.
        if (GIPHY_ID.test(String(gif.id)) && src) found.push({ id: String(gif.id), title: gif.title || 'GIF', src })
      }
      const { offset: at, count, total_count: total } = result.pagination
      return { found, next: at + count < total ? at + count : null }
    },
    [client, term],
  )

  // A new term (or a retry) starts the list again; an answer to an earlier one is dropped.
  useEffect(() => {
    let current = true
    run.current += 1
    setLoading(true)
    setFailed(false)
    fetchPage(0)
      .then((page) => {
        if (!current) return
        setFound(page.found)
        setNext(page.next)
        setLoading(false)
      })
      .catch(() => {
        if (!current) return
        setFound([])
        setNext(null)
        setFailed(true)
        setLoading(false)
      })
    return () => {
      current = false
    }
  }, [fetchPage, attempt])

  const more = () => {
    if (next === null || loading) return
    setLoading(true)
    setFailed(false)
    const at = next
    const started = run.current
    fetchPage(at)
      .then((page) => {
        if (started !== run.current) return
        setFound((list) => [...list, ...page.found.filter((g) => !list.some((l) => l.id === g.id))])
        setNext(page.next)
      })
      .catch(() => {
        if (started === run.current) setFailed(true)
      })
      .finally(() => {
        if (started === run.current) setLoading(false)
      })
  }

  const status = failed
    ? ''
    : loading
      ? 'Loading GIFs…'
      : found.length === 0
        ? 'No GIFs found. Try another word.'
        : `${found.length} GIFs${term ? ` for ${term}` : ', trending now'}`

  return (
    <div ref={panel} role="dialog" aria-label="Search GIFs" className="emoji-picker giphy-picker">
      <label htmlFor={`${id}-search`} className="sr-only">Search GIFs</label>
      <input
        ref={search}
        id={`${id}-search`}
        type="search"
        value={draft}
        placeholder="Search GIPHY"
        enterKeyHint="search"
        autoComplete="off"
        className="field field-sm"
        onChange={(e) => setDraft(e.target.value)}
        // Enter searches; it must not post the form around the picker.
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          setTerm(draft.trim())
        }}
      />
      <div className="emoji-scroll">
        <p role="status" className="giphy-status">{status}</p>
        {failed ? (
          <p role="alert" className="giphy-error">
            Could not load GIFs from GIPHY. Check your connection.{' '}
            <button type="button" className="underline" onClick={() => (found.length ? more() : setAttempt((n) => n + 1))}>Try again</button>
          </p>
        ) : null}
        <div className="giphy-grid">
          {found.map((gif) => (
            <button
              key={gif.id}
              type="button"
              className="giphy-btn"
              aria-label={gif.title}
              title={gif.title}
              onClick={() => onPick({ id: gif.id, title: gif.title })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Giphy's own small rendition, loaded by the member's browser */}
              <img src={gif.src} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
        {next !== null && !failed ? (
          <button type="button" className="btn btn-sm giphy-more" disabled={loading} onClick={more}>More GIFs</button>
        ) : null}
      </div>
      <div className="giphy-footer">
        <button type="button" className="underline" onClick={onUpload}>Upload a GIF file instead</button>
        <span className="giphy-attrib">Powered by GIPHY</span>
      </div>
    </div>
  )
}
