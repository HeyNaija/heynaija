import Link from 'next/link'
import { EmptyState } from '@/app/ui/empty-state'
import { BubbleIcon, GamesIcon, TrophyIcon } from '@/app/ui/icons'
import { PostList } from '@/app/ui/post-item'
import type { CompetitionCard, GameBoard, GameBoardKind, Post } from '@/lib/api'
import { CompetitionSection } from '../competitions/_bits'
import { BOARD_NAMES, BoardRows, periodName } from './board'

// The games homepage's sections (docs/games/GAMES.md, docs/adr/0018 phase 5). Only
// real numbers: where there is nothing yet, each says so plainly.

/** Your Game Score this season, your place, and your all-time XP. */
export function ScoreCard({ season, allTime }: { season: GameBoard | null; allTime: GameBoard | null }) {
  const you = season?.you
  return (
    <section className="content-panel" aria-labelledby="games-score">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="games-score" className="section-title">Your Game Score</h2>
        <Link href="/games/scoring" className="text-sm underline">How scoring works</Link>
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

/** The top five this season, a tab per board. */
export function LeaderboardPreview({ board }: { board: GameBoard | null }) {
  const current: GameBoardKind = board?.board ?? 'score'
  return (
    <section className="content-panel" aria-labelledby="games-leaderboard">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="games-leaderboard" className="section-title">
          Season leaderboard{board ? ` · ${periodName(board.period)}` : ''}
        </h2>
        <Link href={`/games/leaderboard${current === 'score' ? '' : `?board=${current}`}`} className="text-sm underline">
          Full leaderboards
        </Link>
      </div>
      <nav className="feed-tabs keno-tabs" aria-label="Board">
        {(['score', 'chess', 'keno'] as const).map((b) => (
          <Link key={b} href={b === 'score' ? '/games' : `/games?board=${b}`} className="feed-tab" aria-current={current === b ? 'page' : undefined} scroll={false}>
            {BOARD_NAMES[b]}
          </Link>
        ))}
      </nav>
      {board?.rows.length ? (
        <BoardRows board={board} />
      ) : (
        <EmptyState icon={<TrophyIcon size={28} />} title="No standings yet">
          Nobody has scored this season yet. Play a game to be first.
        </EmptyState>
      )}
    </section>
  )
}

export function CompetitionStrip({ items }: { items: CompetitionCard[] }) {
  if (items.length) return <CompetitionSection title="Competitions" items={items.slice(0, 5)} />
  return (
    <section className="content-panel" aria-labelledby="games-competitions">
      <h2 id="games-competitions" className="section-title">Competitions</h2>
      <EmptyState icon={<GamesIcon size={28} />} title="No competitions yet">
        Upcoming and live competitions will be listed here.
      </EmptyState>
    </section>
  )
}

/** The latest posts by The Arbiter: game threads in Chess Arena and results in Game Night. */
export function RecentGamePosts({ posts, viewerId, now }: { posts: Post[]; viewerId: string; now: number }) {
  return (
    <section aria-labelledby="games-posts" className="flex flex-col gap-3">
      <div className="section-heading">
        <h2 id="games-posts" className="section-title">From the games</h2>
        <span className="text-xs">
          <Link href="/c/game-night" className="underline">Game Night</Link> · <Link href="/c/chess-arena" className="underline">Chess Arena</Link>
        </span>
      </div>
      {posts.length ? (
        <PostList posts={posts} viewerId={viewerId} now={now} empty={{ title: '' }} />
      ) : (
        <div className="content-panel">
          <EmptyState icon={<BubbleIcon size={28} />} title="No game posts yet">
            Game threads and competition results will be posted here, as ordinary posts anyone can reply to.
          </EmptyState>
        </div>
      )}
    </section>
  )
}
