'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MentionPage, MentionSuggestion } from '@/lib/api'
import { trimTo } from '@/lib/mention-suggest'

const DEBOUNCE_MS = 120
const CACHE_MS = 60_000
const CACHE_MAX = 100

type Found = { query: string; list: MentionSuggestion[]; cursor: string | null }

// Answers by query, with every page loaded so far; shared by every composer on the page.
const cache = new Map<string, Found & { at: number }>()

function remember(found: Found) {
  cache.delete(found.query)
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(found.query, { ...found, at: Date.now() })
}

/** A fresh answer for `query`, if there is one. */
function known(query: string): Found | null {
  const hit = cache.get(query)
  return hit && Date.now() - hit.at <= CACHE_MS ? hit : null
}

async function fetchPage(query: string, cursor: string | null, signal: AbortSignal): Promise<MentionPage | null> {
  const params = new URLSearchParams({ q: query, ...(cursor ? { cursor } : {}) })
  const res = await fetch(`/api/v1/search/mentions?${params}`, { signal })
  return res.ok ? res.json() : null
}

export type MentionSuggestions = {
  list: MentionSuggestion[]
  /** More pages wait on the server. */
  more: boolean
  loading: boolean
  loadMore: () => void
}

/** Members to offer for the @mention being typed; asks the API after a pause, and for more pages on demand. */
export function useMentionSuggestions(query: string | null): MentionSuggestions {
  const [found, setFound] = useState<Found | null>(null)
  const [loading, setLoading] = useState(false)
  const paging = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const local = query ? known(query) : null
    if (local) setFound(local)
    else if (query) {
      timer = setTimeout(() => {
        fetchPage(query, null, controller.signal)
          .then((page) => {
            if (!page || controller.signal.aborted) return
            const next = { query, list: page.members, cursor: page.cursor }
            remember(next)
            setFound(next)
          })
          .catch(() => {})
      }, DEBOUNCE_MS)
    }
    // Whatever this query was doing, a page it asked for included, stops when it changes.
    return () => {
      clearTimeout(timer)
      controller.abort()
      paging.current?.abort()
      paging.current = null
      setLoading(false)
    }
  }, [query])

  const loadMore = useCallback(() => {
    if (!found || found.query !== query || !found.cursor || paging.current) return
    const controller = new AbortController()
    paging.current = controller
    setLoading(true)
    // A page that cannot be had (an error, the rate limit) ends the list for now, rather than being asked for on every key and scroll.
    const stop = () => setFound({ ...found, cursor: null })
    fetchPage(found.query, found.cursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        if (!page) return stop()
        const seen = new Set(found.list.map((m) => m.handle))
        const next = { query: found.query, list: [...found.list, ...page.members.filter((m) => !seen.has(m.handle))], cursor: page.cursor }
        remember(next)
        setFound(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) stop()
      })
      .finally(() => {
        if (paging.current !== controller) return
        paging.current = null
        setLoading(false)
      })
  }, [found, query])

  if (!query || !found) return { list: [], more: false, loading: false, loadMore }
  if (found.query === query) return { list: found.list, more: found.cursor !== null, loading, loadMore }
  // Keeps the last list, trimmed to what still fits, while the next one loads.
  return { list: trimTo(found.list, query), more: false, loading: false, loadMore }
}
