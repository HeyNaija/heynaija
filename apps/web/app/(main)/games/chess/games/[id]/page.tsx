import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getChessGame, getViewer } from '@/lib/api'
import { ChessGameView } from '../../_components/chess-game'

export const metadata: Metadata = { title: 'Chess game', robots: { index: false } }

/** One game, played or watched (docs/adr/0028, phase 3). */
export default function ChessGamePage(props: PageProps<'/games/chess/games/[id]'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Chess</p>
        <h1 className="page-title">Game</h1>
      </header>
      {/* The board needs JavaScript; this says so where the streamed page never arrives. */}
      <noscript>
        <p className="notice">The chess board needs JavaScript. Turn it on in your browser, then reload this page.</p>
      </noscript>
      <Suspense fallback={<PostsSkeleton />}>
        <Game {...props} />
      </Suspense>
    </div>
  )
}

async function Game({ params }: Pick<PageProps<'/games/chess/games/[id]'>, 'params'>) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const game = await getChessGame(id)
  if (!game) notFound()
  const players = `${game.white.displayName ?? `@${game.white.handle}`} and ${game.black.displayName ?? `@${game.black.handle}`}`
  return (
    <section className="content-panel" aria-label={`${players}'s game`}>
      <ChessGameView initial={game} />
      {game.threadPostId && !game.finished ? (
        <p className="mt-4 text-xs text-muted">
          Spectators’ replies in the thread are hidden from {players} until the game ends. This is a courtesy, not anti-cheat:
          anyone can watch the game on lichess.org.
        </p>
      ) : null}
    </section>
  )
}
