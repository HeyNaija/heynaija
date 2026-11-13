import Link from 'next/link'
import { EmptyState } from '@/app/ui/empty-state'
import { BubbleIcon, TrophyIcon } from '@/app/ui/icons'
import { PostList } from '@/app/ui/post-item'
import { type CompetitionCard, type GameBoardKind, getCommunityPosts, getCompetitions, getPost, type Post } from '@/lib/api'
import { CompetitionSection } from '../competitions/_bits'
import { BoardView } from './board-view'
import type { GameTab } from './game-tabs'

// A game's Leaderboard, Competitions and Posts tabs (docs/games/GAMES.md). Only real
// numbers: where there is nothing yet, each says so plainly.

/** What a game's page tells the shared tabs about it. */
export type GameInfo = {
  slug: GameBoardKind
  name: string
  /** The community where its game posts are started, if it has one of its own (Chess Arena). */
  community?: { slug: string; name: string }
  /** What the Competitions tab says when there are none. */
  noCompetitions: string
}

type Params = Record<string, string | string[] | undefined>

export function GameSection({ game, tab, params, viewerId }: { game: GameInfo; tab: Exclude<GameTab, 'play'>; params: Params; viewerId: string }) {
  if (tab === 'leaderboard') return <BoardView board={game.slug} params={params} path={`/games/${game.slug}`} fixed={{ tab: 'leaderboard' }} />
  if (tab === 'competitions') return <GameCompetitions game={game} />
  return <GamePosts game={game} viewerId={viewerId} />
}

async function GameCompetitions({ game }: { game: GameInfo }) {
  const list = await getCompetitions()
  const mine = (items: CompetitionCard[] | undefined) => (items ?? []).filter((c) => c.game === game.slug)
  const [drafts, current, recent] = [mine(list?.drafts), mine(list?.current), mine(list?.recent)]
  return (
    <>
      {drafts.length ? <CompetitionSection title="Drafts (moderators only)" items={drafts} /> : null}
      {current.length ? (
        <CompetitionSection title="Live and coming up" items={current} />
      ) : (
        <section className="content-panel">
          <EmptyState icon={<TrophyIcon size={28} />} title={`No ${game.name} competitions coming up`}>
            {game.noCompetitions}
          </EmptyState>
        </section>
      )}
      {recent.length ? <CompetitionSection title="Recently finished" items={recent} /> : null}
      <p className="px-1 text-sm">
        <Link href="/games/competitions" className="underline">All competitions</Link> ·{' '}
        <Link href="/games/scoring" className="underline">How games scoring works</Link>
      </p>
    </>
  )
}

/**
 * The game's posts, newest first: those in its own community, and The Arbiter's
 * results for its recent competitions, wherever they were posted.
 */
async function GamePosts({ game, viewerId }: { game: GameInfo; viewerId: string }) {
  const [own, competitions] = await Promise.all([game.community ? getCommunityPosts(game.community.slug).catch(() => null) : null, getCompetitions()])
  const resultIds = (competitions?.recent ?? []).filter((c) => c.game === game.slug && c.resultPostId).map((c) => c.resultPostId as string)
  const results = await Promise.all(resultIds.map((id) => getPost(id).catch(() => null)))
  const byId = new Map<string, Post>()
  for (const p of [...(own?.posts ?? []), ...results]) if (p) byId.set(p.id, p)
  const posts = [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20)
  return (
    <section aria-labelledby="game-posts" className="flex flex-col gap-3">
      <div className="section-heading">
        <h2 id="game-posts" className="section-title">{game.name} posts</h2>
        <span className="text-xs">
          {game.community ? (
            <>
              <Link href={`/c/${game.community.slug}`} className="underline">{game.community.name}</Link> ·{' '}
            </>
          ) : null}
          <Link href="/c/game-night" className="underline">Game Night</Link>
        </span>
      </div>
      {posts.length ? (
        <PostList posts={posts} viewerId={viewerId} now={Date.now()} empty={{ title: '' }} />
      ) : (
        <div className="content-panel">
          <EmptyState icon={<BubbleIcon size={28} />} title={`No ${game.name} posts yet`}>
            Game threads and competition results are posted here, as ordinary posts anyone can reply to.
          </EmptyState>
        </div>
      )}
    </section>
  )
}
