import Link from 'next/link'
import { Avatar } from '@/app/ui/avatar'
import { EmptyState } from '@/app/ui/empty-state'
import { BubbleIcon, GamesIcon, TrophyIcon } from '@/app/ui/icons'
import type { KenoBoard } from '@/lib/api'

// The parts of the games homepage; most have no data until seasons, scoring and
// competitions are built (docs/games/GAMES.md, build order 5). Only real
// numbers: until then each one says plainly that there is nothing yet.

export function ScoreCard() {
  return (
    <section className="content-panel" aria-labelledby="games-score">
      <h2 id="games-score" className="section-title">Your Game Score</h2>
      <EmptyState icon={<TrophyIcon size={28} />} title="No Game Score yet">
        Your score will grow with every game you play and every competition you place in, season by season. It starts when the first game opens.
      </EmptyState>
    </section>
  )
}

/** This month's Keno standings, the top few (docs/adr/0018, phase 4). The whole season board comes in phase 5. */
export function LeaderboardPreview({ keno }: { keno: KenoBoard | null }) {
  return (
    <section className="content-panel" aria-labelledby="games-leaderboard">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="games-leaderboard" className="section-title">Keno this month</h2>
        <Link href="/games/keno/leaderboard" className="text-sm underline">Full leaderboard</Link>
      </div>
      {keno?.rows.length ? (
        <ol className="keno-board">
          {keno.rows.map((r) => (
            <li key={r.handle} className="keno-board-row" data-you={r.you || undefined}>
              <span className="keno-rank">{r.rank}</span>
              <Link href={`/u/${r.handle}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                <Avatar handle={r.handle} src={r.avatar} size={28} />
                <span className="truncate">{r.displayName ?? `@${r.handle}`}</span>
              </Link>
              <span className="keno-points">{r.points.toLocaleString('en-NG')}</span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={<TrophyIcon size={28} />} title="No standings yet">
          Nobody has scored in Keno this month yet. <Link href="/games/keno" className="underline">Play a ticket</Link> to be first.
        </EmptyState>
      )}
    </section>
  )
}

export function CompetitionStrip() {
  return (
    <section className="content-panel" aria-labelledby="games-competitions">
      <h2 id="games-competitions" className="section-title">Competitions</h2>
      <EmptyState icon={<GamesIcon size={28} />} title="No competitions yet">
        Upcoming and live competitions will be listed here.
      </EmptyState>
    </section>
  )
}

export function RecentGamePosts() {
  return (
    <section className="content-panel" aria-labelledby="games-posts">
      <h2 id="games-posts" className="section-title">From the games</h2>
      <EmptyState icon={<BubbleIcon size={28} />} title="No game posts yet">
        Results and notable wins will be posted here, as ordinary posts anyone can reply to.
      </EmptyState>
    </section>
  )
}
