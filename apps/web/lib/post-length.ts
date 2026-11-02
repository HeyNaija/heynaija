import type { TextPart } from './mentions'

// How long a post may be, and how much of a long one a list shows (apps/web/DESIGN.md,
// "Long posts"). Counted in graphemes, so an emoji or an accented letter is one
// character, as the person typing sees it.

/** The most characters a post may have: the API's POST_MAX_GRAPHEMES. */
export const POST_MAX = 1000

/**
 * A list shortens a post only past these, so nothing within the old
 * 300-character limit is ever shortened.
 */
export const SHOW_WHOLE_MAX = 400
export const SHOW_WHOLE_LINES = 10

/** How much of a shortened post a list shows. */
export const PREVIEW_MAX = 300
export const PREVIEW_LINES = 8

const segmenter = new Intl.Segmenter()
export const graphemes = (text: string) => [...segmenter.segment(text)].length
const lineBreaks = (text: string) => text.split('\n').length - 1
const linked = (part: TextPart) => Boolean(part.handle || part.tag || part.href)

/**
 * The start of a long post, for lists: about PREVIEW_MAX characters and at most
 * PREVIEW_LINES lines, ending at a space or line break so no word is split, with
 * an ellipsis. Mentions, hashtags and links are kept whole or left out, never
 * cut. A post within SHOW_WHOLE_MAX and SHOW_WHOLE_LINES comes back as it is.
 */
export function previewParts(parts: TextPart[]): { parts: TextPart[]; cut: boolean } {
  const whole = parts.map((part) => part.text).join('')
  if (graphemes(whole) <= SHOW_WHOLE_MAX && lineBreaks(whole) < SHOW_WHOLE_LINES) return { parts, cut: false }

  const out: TextPart[] = []
  let used = 0
  let lines = 1
  for (const part of parts) {
    if (linked(part)) {
      const size = graphemes(part.text)
      if (used + size > PREVIEW_MAX) break
      out.push(part)
      used += size
      continue
    }
    let taken = ''
    let stopped: 'length' | 'lines' | null = null
    for (const { segment } of segmenter.segment(part.text)) {
      if (segment.includes('\n') && lines >= PREVIEW_LINES) {
        stopped = 'lines'
        break
      }
      if (used >= PREVIEW_MAX) {
        stopped = 'length'
        break
      }
      if (segment.includes('\n')) lines++
      taken += segment
      used++
    }
    if (!stopped) {
      out.push(part)
      continue
    }
    // A line break is a clean end. Out of room mid-line, end at the last space or line
    // break instead, unless that would leave nothing of this part.
    const end = Math.max(taken.lastIndexOf(' '), taken.lastIndexOf('\n'))
    if (stopped === 'length' && end > 0) taken = taken.slice(0, end)
    if (taken.trim()) out.push({ text: taken })
    break
  }

  // Whatever came last, no space before the ellipsis.
  const last = out.at(-1)
  if (last && !linked(last)) out[out.length - 1] = { text: last.text.trimEnd() }
  out.push({ text: '…' })
  return { parts: out, cut: true }
}
