import { EmptyState } from '@/app/ui/empty-state'
import { BubbleIcon, GamesIcon, TrophyIcon } from '@/app/ui/icons'

// The parts of the games homepage that have no data until seasons, scoring and
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

export function LeaderboardPreview() {
  return (
    <section className="content-panel" aria-labelledby="games-leaderboard">
      <h2 id="games-leaderboard" className="section-title">Season leaderboard</h2>
      <EmptyState icon={<TrophyIcon size={28} />} title="No standings yet">
        Leaderboards appear once members have played in a season.
      </EmptyState>
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
