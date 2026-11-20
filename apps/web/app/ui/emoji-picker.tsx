'use client'

import { type KeyboardEvent, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EMOJI_GROUPS, type Emoji, emojiFor, searchEmoji } from '@/lib/emoji-data'
import { moveInGrid } from '@/lib/emoji-grid'
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
 * list until someone opens it. Drawn in the page's body, like the @mention list, so
 * nothing around the box (the phone's reply bar, its top bar) clips or covers it. It
 * stays open for more than one pick; the composer closes it. The grid is one tab stop
 * with the arrow keys inside it, so Tab is three presses: search, grid, away (`onExit`).
 */
export default function EmojiPicker({
  anchor,
  panel,
  focusSearch,
  onPick,
  onExit,
}: {
  anchor: RefObject<HTMLElement | null>
  panel: RefObject<HTMLDivElement | null>
  /** Opened from the keyboard: focus moves into the picker. Opened by pointer, the box keeps it. */
  focusSearch: boolean
  onPick: (emoji: string, byPointer: boolean) => void
  /** Tab went past the last stop (`next`) or before the first (`back`). */
  onExit: (to: 'next' | 'back') => void
}) {
  const id = useId()
  const search = useRef<HTMLInputElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  // What was used before, as of opening: the grid does not shift under the keys while picking.
  const [recent, setRecent] = useState<string[]>([])
  const latest = useRef<string[]>([])
  const [active, setActive] = useState(0)
  useFixedPlacement(anchor, panel, true, 360, 340)

  useEffect(() => {
    latest.current = loadRecent()
    setRecent(latest.current)
    if (focusSearch) search.current?.focus({ preventScroll: true })
  }, [focusSearch])

  const searching = query.trim() !== ''
  const found = useMemo(() => searchEmoji(query), [query])
  const groups = useMemo(() => {
    const used = recent.map(emojiFor).filter((e): e is Emoji => e !== undefined)
    return [...(used.length ? [{ name: 'Recently used', emoji: used }] : []), ...EMOJI_GROUPS]
  }, [recent])
  const shown = searching ? [{ name: 'Results', emoji: found }] : groups
  const sections = shown.map((g) => g.emoji.length)
  const total = sections.reduce((sum, n) => sum + n, 0)
  const stop = active < total ? active : 0

  const pick = (emoji: Emoji, byPointer: boolean) => {
    latest.current = remember(latest.current, emoji.char)
    saveRecent(latest.current)
    onPick(emoji.char, byPointer)
  }

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
    if (!cell || e.nativeEvent.isComposing) return
    const columns = getComputedStyle(cell.parentElement!).gridTemplateColumns.split(' ').length
    const to = moveInGrid({ key: e.key, at: Number(cell.dataset.cell), sections, columns, ctrl: e.ctrlKey || e.metaKey })
    if (to === null) return
    e.preventDefault()
    setActive(to)
    scroll.current?.querySelector<HTMLElement>(`[data-cell="${to}"]`)?.focus()
  }

  // The search box and the grid's one tab stop are the picker's two stops.
  const onTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const stops = [search.current, scroll.current?.querySelector('[data-cell][tabindex="0"]')].filter(Boolean)
    const at = stops.indexOf(document.activeElement as HTMLElement)
    if (at < 0 || (e.shiftKey ? at !== 0 : at !== stops.length - 1)) return
    e.preventDefault()
    onExit(e.shiftKey ? 'back' : 'next')
  }

  let cell = 0
  return createPortal(
    <div ref={panel} role="dialog" aria-label="Emoji" aria-describedby={`${id}-hint`} className="emoji-picker" onKeyDown={onTab}>
      <p id={`${id}-hint`} className="sr-only">Arrow keys move between emoji. Escape closes.</p>
      <label htmlFor={`${id}-search`} className="sr-only">Search emoji</label>
      <input
        ref={search}
        id={`${id}-search`}
        type="search"
        value={query}
        placeholder="Search emoji"
        autoComplete="off"
        className="field field-sm"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown') return
          e.preventDefault()
          scroll.current?.querySelector<HTMLElement>('[data-cell][tabindex="0"]')?.focus()
        }}
      />
      {/* Always in the page, so a change in it is spoken. */}
      <p role="status" className="sr-only">{searching ? (found.length ? `${found.length} emoji found` : 'No emoji match') : ''}</p>
      <div ref={scroll} className="emoji-scroll" onKeyDown={onGridKey}>
        {searching && found.length === 0 ? <p className="emoji-empty">No emoji match.</p> : null}
        {shown.map((g, i) =>
          g.emoji.length ? (
            <section key={g.name} aria-labelledby={`${id}-group-${i}`}>
              {searching ? null : <h3 id={`${id}-group-${i}`} className="emoji-heading">{g.name}</h3>}
              <div className="emoji-grid" role={searching ? 'group' : undefined} aria-label={searching ? 'Results' : undefined}>
                {g.emoji.map((e) => {
                  const at = cell++
                  return (
                    <button
                      key={e.char}
                      type="button"
                      className="emoji-btn"
                      aria-label={e.name}
                      title={e.name}
                      data-cell={at}
                      tabIndex={at === stop ? 0 : -1}
                      onFocus={() => setActive(at)}
                      // Keeps focus (and the caret) where it is while the pointer picks.
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={(ev) => pick(e, ev.detail > 0)}
                    >
                      <span aria-hidden="true">{e.char}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </div>,
    document.body,
  )
}
