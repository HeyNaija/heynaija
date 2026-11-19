'use client'

import { type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react'
import { EMOJI_GROUPS, type Emoji, emojiFor, searchEmoji } from '@/lib/emoji-data'
import { readRecent, remember } from '@/lib/emoji-recent'
import { useFixedPlacement } from './use-fixed-placement'

const STORAGE_KEY = 'emoji-recent'

// Storage can be missing, full or blocked: the picker works without it.
function loadRecent(): string[] {
  try {
    return readRecent(localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {}
}

/**
 * The emoji popover of the composer, in its own chunk so the box does not carry the
 * list until someone opens it. It stays open for more than one pick; the composer closes it.
 */
export default function EmojiPicker({
  anchor,
  focusSearch,
  onPick,
}: {
  anchor: RefObject<HTMLElement | null>
  /** Opened from the keyboard: focus moves into the picker. Opened by pointer, the box keeps it. */
  focusSearch: boolean
  onPick: (emoji: string, byPointer: boolean) => void
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  useFixedPlacement(anchor, panel, true, 360, 340)

  useEffect(() => {
    setRecent(loadRecent())
    if (focusSearch) search.current?.focus({ preventScroll: true })
  }, [focusSearch])

  const found = useMemo(() => searchEmoji(query), [query])
  const groups = useMemo(() => {
    const used = recent.map(emojiFor).filter((e): e is Emoji => e !== undefined)
    return [...(used.length ? [{ name: 'Recently used', emoji: used }] : []), ...EMOJI_GROUPS]
  }, [recent])

  const pick = (emoji: Emoji, byPointer: boolean) => {
    const next = remember(recent, emoji.char)
    setRecent(next)
    saveRecent(next)
    onPick(emoji.char, byPointer)
  }

  const grid = (list: Emoji[]) => (
    <div className="emoji-grid">
      {list.map((e) => (
        <button
          key={e.char}
          type="button"
          className="emoji-btn"
          aria-label={e.name}
          title={e.name}
          // Keeps focus (and the caret) where it is while the pointer picks.
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={(ev) => pick(e, ev.detail > 0)}
        >
          <span aria-hidden="true">{e.char}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div ref={panel} role="dialog" aria-label="Emoji" className="emoji-picker">
      <label htmlFor={`${id}-search`} className="sr-only">Search emoji</label>
      <input
        ref={search}
        id={`${id}-search`}
        type="search"
        value={query}
        placeholder="Search emoji"
        autoComplete="off"
        className="field field-sm"
        onChange={(e) => setQuery(e.target.value)}
        // Enter here must not post the form around the picker.
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
      />
      <div className="emoji-scroll">
        {query.trim() ? (
          found.length ? grid(found) : <p className="emoji-empty" role="status">No emoji match.</p>
        ) : (
          groups.map((g, i) => (
            <section key={g.name} aria-labelledby={`${id}-group-${i}`}>
              <h3 id={`${id}-group-${i}`} className="emoji-heading">{g.name}</h3>
              {grid(g.emoji)}
            </section>
          ))
        )}
      </div>
    </div>
  )
}
