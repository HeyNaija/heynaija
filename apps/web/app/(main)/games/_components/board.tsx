import Link from 'next/link'
import { Avatar } from '@/app/ui/avatar'
import type { GameBoard, GameBoardRow } from '@/lib/api'

const MONTH = new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "November 2026" for "2026-11"; "All time" for "all". */
export const periodName = (period: string) => (period === 'all' ? 'All time' : MONTH.format(new Date(`${period}-15T00:00:00Z`)))

export const BOARD_NAMES = { score: 'Game Score', chess: 'Chess', keno: 'Keno' } as const

const unit = (board: Pick<GameBoard, 'unit'>, n: number) => `${n.toLocaleString('en-NG')} ${board.unit === 'xp' ? 'XP' : n === 1 ? 'point' : 'points'}`

function Line({ row, board }: { row: GameBoardRow; board: Pick<GameBoard, 'unit'> }) {
  return (
    <li className="keno-board-row" data-you={row.you || undefined}>
      <span className="keno-rank">{row.rank}</span>
      <Link href={`/u/${row.handle}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
        <Avatar handle={row.handle} src={row.avatar} size={28} />
        <span className="truncate">
          {row.displayName ?? `@${row.handle}`}
          {row.you ? <span className="text-muted"> (you)</span> : null}
        </span>
      </Link>
      <span className="keno-points">{unit(board, row.value)}</span>
    </li>
  )
}

/** A board's rows, and the viewer's own below them if they are further down. */
export function BoardRows({ board }: { board: GameBoard }) {
  const youShown = board.rows.some((r) => r.you)
  return (
    <ol className="keno-board">
      {board.rows.map((r) => (
        <Line key={r.handle} row={r} board={board} />
      ))}
      {board.you && !youShown ? (
        <>
          <li className="keno-board-gap" aria-hidden="true">…</li>
          <Line row={board.you} board={board} />
        </>
      ) : null}
    </ol>
  )
}
