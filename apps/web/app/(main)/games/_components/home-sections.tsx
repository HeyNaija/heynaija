import Link from 'next/link'
import { EmptyState } from '@/app/ui/empty-state'
import { TrophyIcon } from '@/app/ui/icons'
import type { GameBoard } from '@/lib/api'
import { periodName } from './board'

// The games homepage's score card (docs/games/GAMES.md, docs/adr/0028 phase 5). Only
// real numbers: where there is nothing yet, each says so plainly.

/** Your Game Score this season, your place, and your all-time XP. */
export function ScoreCard({ season, allTime }: { season: GameBoard | null; allTime: GameBoard | null }) {
  const you = season?.you
  return (
    <section className="content-panel" aria-labelledby="games-score">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="games-score" className="section-title">Your Game Score</h2>
        <span className="text-sm">
          <Link href="/games/leaderboard" className="underline">Leaderboard</Link> ·{' '}
          <Link href="/games/scoring" className="underline">How scoring works</Link>
        </span>
      </div>
      {you || allTime?.you ? (
        <div className="game-score">
          <span>
            <strong>{(you?.value ?? 0).toLocaleString('en-NG')} XP</strong> <span className="text-sm text-muted">in {season ? periodName(season.period) : 'this season'}</span>
          </span>
          {you ? <span className="text-sm">#{you.rank} this season</span> : <span className="text-sm text-muted">No XP this season yet</span>}
          <span className="text-sm text-muted">{(allTime?.you?.value ?? 0).toLocaleString('en-NG')} XP all time</span>
        </div>
      ) : (
        <EmptyState icon={<TrophyIcon size={28} />} title="No Game Score yet">
          Your score grows with every game you finish, every Keno round you play and every competition you place in, season
          by season.
        </EmptyState>
      )}
    </section>
  )
}
