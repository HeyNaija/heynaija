const segmenter = new Intl.Segmenter()

/** The grapheme boundaries of `value`, ends included. */
function boundaries(value: string): number[] {
  const at = [0]
  for (const { index, segment } of segmenter.segment(value)) at.push(index + segment.length)
  return at
}

/**
 * `text` put into `value` over the selection `start`..`end` (either way round), and
 * where the caret goes: just after it. A selection edge inside a character the box
 * already has (a flag, a skin tone, a ZWJ sequence) moves out to the whole character,
 * so nothing is split; a bare caret in one goes in front of it.
 */
export function insertAtSelection(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  const at = boundaries(value)
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const before = at.findLast((i) => i <= from) ?? 0
  const after = from === to ? before : (at.find((i) => i >= to) ?? value.length)
  return { value: value.slice(0, before) + text + value.slice(after), caret: before + text.length }
}
