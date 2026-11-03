'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Key } from 'chessground/types'
import { Avatar } from '@/app/ui/avatar'
import type { ChessGame, ChessPlayer } from '@/lib/api'
import type { Board } from './board'

type BoardModule = typeof import('./board')

const SPEED_NAMES = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Correspondence' } as const
const HOW: Record<string, string> = { mate: 'by checkmate', resign: 'by resignation', outoftime: 'on time', timeout: 'as the other player left' }
/** After a failed request the page waits a little longer each time, up to this. */
const RETRY_MAX_MS = 30_000

const nameOf = (p: ChessPlayer) => p.displayName ?? `@${p.handle}`

function resultText(g: ChessGame): string {
  if (g.status === 'aborted') return 'Game aborted'
  if (g.status === 'noStart') return 'Game cancelled: the first move was not made in time'
  if (g.winner) return `${nameOf(g[g.winner])} won ${HOW[g.status] ?? ''}`.trim()
  if (g.status === 'stalemate') return 'Drawn by stalemate'
  return 'Drawn'
}

/** m:ss, with tenths under ten seconds; h:mm:ss for long clocks. */
function formatClock(ms: number): string {
  const total = Math.max(0, ms)
  if (total < 10_000) return `0:0${(total / 1000).toFixed(1)}`
  const s = Math.floor(total / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * A game, played or watched (docs/adr/0018). The board code is fetched only now,
 * on this page. The page asks the API for the next change and the API answers as
 * soon as there is one (or after about 25 seconds with none): no stream to hold
 * open, so it works through every proxy on the way.
 */
export function ChessGameView({ initial }: { initial: ChessGame }) {
  const [game, setGame] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [promotion, setPromotion] = useState<{ from: Key; to: Key } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [san, setSan] = useState<string[]>([])
  const [said, setSaid] = useState('')
  const el = useRef<HTMLDivElement>(null)
  const board = useRef<Board | null>(null)
  const lib = useRef<BoardModule | null>(null)
  const latest = useRef(game)
  latest.current = game

  const turn: 'white' | 'black' = game.moves.length % 2 === 0 ? 'white' : 'black'
  const yourTurn = !game.finished && game.you === turn

  // Sends an action; on refusal the board goes back to what Lichess has.
  const act = useCallback(async (path: string, body?: object) => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/v1/games/chess/games/${latest.current.id}/${path}`, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null)
    setBusy(false)
    if (res?.ok) return true
    const answer = (await res?.json().catch(() => null)) as { message?: string } | null
    setError(answer?.message ?? (res?.status === 429 ? 'That was a lot of moves at once. Wait a moment.' : 'That did not go through. Try again.'))
    board.current?.show(latest.current.moves, true)
    return false
  }, [])

  const sendMove = useCallback(
    async (from: Key, to: Key, piece?: 'q' | 'r' | 'b' | 'n') => {
      if (!lib.current) return
      await act('move', { uci: lib.current.uciFor(latest.current.moves, from, to, piece) })
    },
    [act],
  )

  // The board: fetched and drawn once, then redrawn from the game.
  useEffect(() => {
    let cancelled = false
    void import('./board').then((mod) => {
      if (cancelled || !el.current) return
      lib.current = mod
      board.current = mod.mountBoard(el.current, initial.you ?? 'white', initial.you, (from, to) => {
        if (mod.isPromotion(latest.current.moves, from, to)) setPromotion({ from, to })
        else void sendMove(from, to)
      })
      board.current.show(latest.current.moves, true)
      setSan(mod.replay(latest.current.moves).san)
    })
    return () => {
      cancelled = true
      board.current?.destroy()
      board.current = null
    }
  }, [initial.you, sendMove])

  useEffect(() => {
    board.current?.show(game.moves, true)
    if (lib.current) setSan(lib.current.replay(game.moves).san)
  }, [game.moves])

  // What changed, said for screen readers: the latest move, or the result.
  useEffect(() => {
    if (game.finished) setSaid(`${resultText(game)}.`)
    else if (san.length) setSaid(`${san.length % 2 ? nameOf(game.white) : nameOf(game.black)} played ${san.at(-1)}.`)
  }, [san, game])

  // Waits for each change, for as long as the game goes on and the page is in view.
  useEffect(() => {
    let stopped = false
    let failures = 0
    let controller: AbortController | null = null
    const loop = async () => {
      while (!stopped && !latest.current.finished) {
        if (document.visibilityState !== 'visible') return
        controller = new AbortController()
        const res = await fetch(`/api/v1/games/chess/games/${latest.current.id}?after=${latest.current.version}`, { cache: 'no-store', signal: controller.signal }).catch(() => null)
        if (stopped) return
        if (res?.ok) {
          failures = 0
          const next = (await res.json()) as ChessGame
          if (next.version !== latest.current.version) setGame(next)
          continue
        }
        if (res?.status === 404) return
        failures += 1
        await new Promise((done) => setTimeout(done, Math.min(1000 * 2 ** failures, RETRY_MAX_MS)))
      }
    }
    void loop()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loop()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // The running clock counts down here between the API's answers.
  useEffect(() => {
    if (game.finished || !game.clock) return
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [game.finished, game.clock])

  const clockOf = (side: 'white' | 'black') => {
    const ms = side === 'white' ? game.whiteMs : game.blackMs
    if (ms == null) return null
    const running = !game.finished && turn === side && game.moves.length >= 2 && game.clockAt
    return running ? ms - (now - new Date(game.clockAt!).getTime()) : ms
  }

  const top = game.you === 'black' ? 'white' : 'black'
  const bottom = top === 'white' ? 'black' : 'white'
  const playerRow = (side: 'white' | 'black') => {
    const p = game[side]
    const clock = clockOf(side)
    const change = game.ratingsAfter?.[side]
    return (
      <div className={`chess-player ${!game.finished && turn === side ? 'is-turn' : ''}`}>
        <Link href={`/u/${p.handle}`} className="flex min-w-0 items-center gap-2 hover:underline">
          <Avatar handle={p.handle} src={p.avatar} size={28} />
          <span className="min-w-0 truncate text-sm font-semibold">{nameOf(p)}</span>
        </Link>
        <span className="text-xs text-muted">
          {change?.after != null && change.before != null && change.after !== change.before
            ? `${change.before} → ${change.after}`
            : p.rating != null
              ? `${p.rating}${p.provisional ? '?' : ''}`
              : ''}
        </span>
        {clock != null ? (
          <span className="chess-clock" aria-label={`${nameOf(p)}'s clock`}>
            {formatClock(clock)}
          </span>
        ) : null}
      </div>
    )
  }

  const opponentOffers = game.drawOffer && game.you && game.drawOffer !== game.you
  const youOffered = game.drawOffer && game.drawOffer === game.you

  return (
    <div className="chess-game">
      <p className="text-sm text-muted">
        {game.rated ? 'Rated' : 'Casual'} {SPEED_NAMES[game.speed]} {game.time}
        {game.days ? ` · correspondence: ${game.days} ${game.days === 1 ? 'day' : 'days'} a move` : ''}
      </p>
      {playerRow(top)}
      <div className="chess-board-wrap">
        <div ref={el} className="chess-board" aria-label="Chess board" />
      </div>
      {playerRow(bottom)}

      <p className="chess-status" aria-live="off">
        {game.finished ? resultText(game) : yourTurn ? 'Your move' : game.you ? `Waiting for ${nameOf(game[turn])}` : `${nameOf(game[turn])} to move`}
      </p>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>

      {promotion ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose the piece to promote to">
          <span className="text-sm">Promote to</span>
          {(['q', 'r', 'b', 'n'] as const).map((piece) => (
            <button
              key={piece}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const move = promotion
                setPromotion(null)
                void sendMove(move.from, move.to, piece)
              }}
            >
              {{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[piece]}
            </button>
          ))}
        </div>
      ) : null}

      {game.you && !game.finished ? (
        <div className="flex flex-wrap gap-2">
          {opponentOffers ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act('draw', { answer: 'accept' })}>
                Accept draw
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void act('draw', { answer: 'decline' })}>
                Decline draw
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || Boolean(youOffered)} onClick={() => void act('draw', { answer: 'offer' })}>
              {youOffered ? 'Draw offered' : 'Offer a draw'}
            </button>
          )}
          {game.moves.length < 2 ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void act('abort')}>
              Abort
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                if (confirm('Resign this game? It counts as a loss.')) void act('resign')
              }}
            >
              Resign
            </button>
          )}
        </div>
      ) : null}
      <p role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>

      {san.length ? (
        <ol className="chess-moves" aria-label="Moves">
          {Array.from({ length: Math.ceil(san.length / 2) }, (_, i) => (
            <li key={i}>
              <span className="text-muted">{i + 1}.</span> {san[i * 2]} {san[i * 2 + 1] ?? ''}
            </li>
          ))}
        </ol>
      ) : null}

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {game.threadPostId ? (
          <Link href={`/p/${game.threadPostId}`} className="font-semibold text-accent-strong hover:underline">
            {game.finished ? 'Talk about it in Chess Arena' : 'The thread in Chess Arena'}
          </Link>
        ) : null}
        <a href={game.lichessUrl} target="_blank" rel="noopener noreferrer" className="text-accent-strong hover:underline">
          On lichess.org
        </a>
      </p>
    </div>
  )
}
