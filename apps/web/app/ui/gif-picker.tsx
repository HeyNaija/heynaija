'use client'

import { type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { GifHit, GifProvider, GifSearch } from '@/lib/gif/types'
import { type PickerPlace, usePickerPlacement } from './use-fixed-placement'
import { usePressedBy } from './use-pressed-by'
import { useReducedMotion } from './use-gif'

const PAGE = 12

/**
 * The GIF search of the composer, the same for every provider, in its own chunk; the provider's
 * search (and any client library it uses) is loaded when this opens. The member's browser talks to
 * the provider directly. Searching waits for Enter, so a few keystrokes do not spend a key's
 * hourly allowance.
 */
export default function GifPicker({
  place,
  panel,
  provider,
  apiKey,
  focusSearch,
  onPick,
  onUpload,
}: {
  place: PickerPlace
  panel: RefObject<HTMLDivElement | null>
  provider: GifProvider
  apiKey: string
  /** Opened from the keyboard: focus moves into the picker. Opened by pointer, the box keeps it. */
  focusSearch: boolean
  /** `pointer` is the pointerType of the press that picked, or null for the keyboard or a screen reader. */
  onPick: (gif: { id: string; title: string }, pointer: string | null, provider: GifProvider) => void
  /** The member would rather add a GIF file of their own. */
  onUpload: () => void
}) {
  const id = useId()
  const pressedBy = usePressedBy()
  const reducedMotion = useReducedMotion()
  const search = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<GifHit[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Counts restarts of the list, so a "More" answer that comes after a new search is dropped.
  const run = useRef(0)
  // Counts Try again presses, for the provider's search (lib/gif/types.ts).
  const retries = useRef(0)
  // The provider's search, loaded once; a failed load is forgotten so Try again loads it again.
  const client = useRef<Promise<GifSearch> | null>(null)
  const searcher = useCallback(() => {
    client.current ??= provider.search(apiKey).catch((err: unknown) => {
      client.current = null
      throw err
    })
    return client.current
  }, [provider, apiKey])
  usePickerPlacement(place, panel, { tallest: 440, widest: 360 })

  useEffect(() => {
    if (focusSearch) search.current?.focus({ preventScroll: true })
  }, [focusSearch])

  const fetchPage = useCallback(
    async (offset: number) => {
      const search = await searcher()
      const page = await search({ term, offset, limit: PAGE, retry: retries.current })
      // An id the provider's own rule refuses could not be posted, so it is not offered.
      return { ...page, found: page.found.filter((gif) => provider.idPattern.test(gif.id)) }
    },
    [searcher, provider, term],
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
    <div ref={panel} role="dialog" aria-label="Search GIFs" className="emoji-picker gif-picker" onPointerDown={pressedBy.onPointerDown} onKeyDown={pressedBy.onKeyDown}>
      <label htmlFor={`${id}-search`} className="sr-only">Search GIFs</label>
      <input
        ref={search}
        id={`${id}-search`}
        type="search"
        value={draft}
        placeholder={provider.searchPlaceholder}
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
        <p role="status" className="gif-status">{status}</p>
        {failed ? (
          <p role="alert" className="gif-error">
            Could not load GIFs from {provider.label}. Check your connection.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                retries.current += 1
                if (found.length) more()
                else setAttempt((n) => n + 1)
              }}
            >
              Try again
            </button>
          </p>
        ) : null}
        <div className="gif-grid">
          {found.map((gif) => (
            <button
              key={gif.id}
              type="button"
              className="gif-btn"
              aria-label={gif.title}
              title={gif.title}
              onClick={() => onPick({ id: gif.id, title: gif.title }, pressedBy.take(), provider)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the provider's own small rendition, loaded by the member's browser */}
              <img src={reducedMotion ? gif.still : gif.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
        {next !== null && !failed ? (
          <button type="button" className="btn btn-sm gif-more" disabled={loading} onClick={more}>More GIFs</button>
        ) : null}
      </div>
      <div className="gif-footer">
        <button type="button" className="underline" onClick={onUpload}>Upload a GIF file instead</button>
        <span className="gif-attrib">{provider.attribution}</span>
      </div>
    </div>
  )
}
