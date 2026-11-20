/**
 * Where an arrow key moves the focus in the picker's grid, which is one tab stop. The
 * cells are numbered through every section in turn; each section lays its cells out
 * `columns` to a row, so its last row may be short. Up and down keep the column, or
 * land on the last cell of a short row, and carry on into the next section (empty
 * ones skipped). Home and End go to the ends of the row, with Control of the grid.
 * Null: no cells, or a key the grid does not use.
 */
export function moveInGrid({ key, at, sections, columns, ctrl = false }: { key: string; at: number; sections: number[]; columns: number; ctrl?: boolean }): number | null {
  const total = sections.reduce((sum, n) => sum + n, 0)
  if (total === 0 || columns < 1) return null
  const starts = sections.map((_, i) => sections.slice(0, i).reduce((sum, n) => sum + n, 0))
  const section = sections.findIndex((n, i) => at >= starts[i]! && at < starts[i]! + n)
  if (section < 0) return null
  const length = sections[section]!
  const start = starts[section]!
  const offset = at - start
  const row = Math.floor(offset / columns)
  const column = offset % columns
  const lastRow = Math.floor((length - 1) / columns)

  switch (key) {
    case 'ArrowRight':
      return Math.min(at + 1, total - 1)
    case 'ArrowLeft':
      return Math.max(at - 1, 0)
    case 'ArrowDown': {
      if (row < lastRow) return start + Math.min(offset + columns, length - 1)
      const next = sections.findIndex((n, i) => i > section && n > 0)
      return next < 0 ? at : starts[next]! + Math.min(column, sections[next]! - 1)
    }
    case 'ArrowUp': {
      if (row > 0) return at - columns
      const before = sections.findLastIndex((n, i) => i < section && n > 0)
      if (before < 0) return at
      const lastRowStart = Math.floor((sections[before]! - 1) / columns) * columns
      return starts[before]! + Math.min(lastRowStart + column, sections[before]! - 1)
    }
    case 'Home':
      return ctrl ? 0 : start + row * columns
    case 'End':
      return ctrl ? total - 1 : start + Math.min(row * columns + columns - 1, length - 1)
    default:
      return null
  }
}
