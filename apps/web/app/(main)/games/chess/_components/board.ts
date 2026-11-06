// The only file that imports chessground and chessops (both GPL-3.0-or-later; see
// /licence). chess-game.tsx loads it with import() when a game page opens, so no
// other page downloads them, which keeps HeyNaija light on cheap phones.
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Key } from 'chessground/types'
import { Chess, normalizeMove } from 'chessops/chess'
import { chessgroundDests } from 'chessops/compat'
import { makeFen } from 'chessops/fen'
import { makeSanAndPlay } from 'chessops/san'
import { parseSquare, parseUci } from 'chessops/util'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'

export type Side = 'white' | 'black'

/** The position after `moves` (UCI, as Lichess sends them), each move's SAN, and whose turn it is. */
export function replay(moves: string[]) {
  const pos = Chess.default()
  const san: string[] = []
  for (const uci of moves) {
    const move = parseUci(uci)
    if (!move) break
    san.push(makeSanAndPlay(pos, normalizeMove(pos, move)))
  }
  const last = moves.at(-1)
  return {
    pos,
    san,
    fen: makeFen(pos.toSetup()),
    turn: pos.turn as Side,
    check: pos.isCheck(),
    lastMove: last ? ([last.slice(0, 2), last.slice(2, 4)] as Key[]) : undefined,
  }
}

/**
 * The UCI Lichess wants for a move made on the board. A king dragged onto its own
 * rook (as the board allows for castling) becomes the king's two-square move.
 */
export function uciFor(moves: string[], from: Key, to: Key, promotion?: 'q' | 'r' | 'b' | 'n'): string {
  const { pos } = replay(moves)
  const fromSq = parseSquare(from)!
  const toSq = parseSquare(to)!
  const piece = pos.board.get(fromSq)
  let dest = to as string
  if (piece?.role === 'king' && pos.board.get(toSq)?.role === 'rook' && pos.board.get(toSq)?.color === piece.color) {
    dest = `${toSq > fromSq ? 'g' : 'c'}${from[1]}`
  }
  return `${from}${dest}${promotion ?? ''}`
}

/** Whether moving `from` to `to` is a pawn reaching the last rank, which needs a piece chosen. */
export function isPromotion(moves: string[], from: Key, to: Key): boolean {
  const { pos } = replay(moves)
  const piece = pos.board.get(parseSquare(from)!)
  return piece?.role === 'pawn' && (to[1] === '8' || to[1] === '1')
}

export type Board = {
  /** Shows the game as of `moves`; `canMove` lets the viewer move pieces of their colour on their turn. */
  show(moves: string[], canMove: boolean): void
  destroy(): void
}

export function mountBoard(el: HTMLElement, orientation: Side, mine: Side | null, onMove: (from: Key, to: Key) => void): Board {
  const ground: Api = Chessground(el, {
    orientation,
    coordinates: true,
    animation: { duration: 180 },
    highlight: { lastMove: true, check: true },
    movable: { free: false, color: undefined, showDests: true, events: { after: (from, to) => onMove(from, to) } },
    premovable: { enabled: false },
    draggable: { showGhost: true },
  })
  return {
    show(moves, canMove) {
      const { pos, fen, turn, check, lastMove } = replay(moves)
      const yours = canMove && mine === turn && !pos.isEnd()
      ground.set({
        fen,
        turnColor: turn,
        lastMove,
        check: check ? turn : false,
        movable: { color: yours ? mine! : undefined, dests: yours ? (chessgroundDests(pos) as Map<Key, Key[]>) : new Map() },
      })
    },
    destroy: () => ground.destroy(),
  }
}

