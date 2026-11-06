import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getGameScoring, getViewer } from '@/lib/api'
import { xpLines } from '@/lib/game-scoring'
import { periodName } from '../_components/board'

// Behind the games flag until launch, like the rest of Games (docs/adr/0018, phase 5).
export const metadata: Metadata = { title: 'How games scoring works', robots: { index: false } }

/** Every scoring rule in Games, stated plainly, with the numbers the API scores by. */
export default function ScoringPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games" className="hover:underline">Games</Link>
        </p>
        <h1 className="page-title">How games scoring works</h1>
        <p className="page-description">
          Your Game Score is the XP you earn across every game, season by season. These are all the rules, the same for
          everyone. Nothing here costs money or pays out.
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Rules />
      </Suspense>
    </div>
  )
}

async function Rules() {
  const viewer = await getViewer()
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const rules = await getGameScoring()
  if (!rules) notFound()
  return (
    <>
      <section className="content-panel" aria-labelledby="scoring-seasons">
        <h2 id="scoring-seasons" className="section-title">Seasons</h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
          <p>
            A season is a calendar month, Lagos time: this one is {periodName(rules.season)}. Each season’s leaderboards start
            empty on the 1st at midnight. Your all-time totals keep counting and never reset.
          </p>
        </div>
      </section>

      <section className="content-panel" aria-labelledby="scoring-xp">
        <h2 id="scoring-xp" className="section-title">Game Score XP</h2>
        {xpLines(rules.xp).map((group) => (
          <div key={group.game} className="mt-3">
            <h3 className="text-sm font-semibold">{group.game}</h3>
            <table className="keno-table">
              <tbody>
                {group.lines.map(([what, worth]) => (
                  <tr key={what}>
                    <td>{what}</td>
                    <td className="whitespace-nowrap text-right font-semibold">{worth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="mt-3 text-sm text-muted">
          Chess games count rated or casual alike; Lichess decides who won. XP is added the moment a game ends, a Keno round is
          drawn or a competition finishes.
        </p>
      </section>

      <section className="content-panel" aria-labelledby="scoring-boards">
        <h2 id="scoring-boards" className="section-title">Leaderboards</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
          <li><strong className="text-[var(--ink)]">Game Score</strong> ranks by XP from every game.</li>
          <li><strong className="text-[var(--ink)]">Chess</strong> ranks by XP from chess. Ratings stay on Lichess and on your profile.</li>
          <li>
            <strong className="text-[var(--ink)]">Keno</strong> ranks by Keno points, from the{' '}
            <Link href="/games/keno" className="underline">points table</Link> (version {rules.keno.tableVersion}).
          </li>
          <li>Ties share a place. You can narrow any board to the people you follow, or to a community you joined.</li>
          <li>
            Members you have blocked or who blocked you, and members you muted, are left out, as they are from your feeds.
            Suspended members do not appear on any board.
          </li>
        </ul>
      </section>

      <section className="content-panel" aria-labelledby="scoring-competitions">
        <h2 id="scoring-competitions" className="section-title">Competitions</h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
          <p>
            Site moderators run Keno competitions. Each has an entry window and a play window, and is open to everyone, to
            one community, or by invitation: {rules.formats.keno?.keno_points?.toLowerCase()} Places are by score, ties
            sharing a place; only members who played get one.
          </p>
          <p>
            Chess competitions are tournaments on Lichess, Arena or Swiss, made by a community’s moderators for its Lichess
            team. You play them on lichess.org. HeyNaija members of the community who have connected Lichess are placed in
            Lichess’s order, so Lichess’s tiebreaks decide who is ahead, and only those members count for places and XP.
            Games played in a tournament give no XP of their own.
          </p>
          <p>
            When a competition ends, The Arbiter posts the top ten in Game Night, or in the competition’s own community, and
            the XP above is added.
          </p>
        </div>
      </section>

      <section className="content-panel" aria-labelledby="scoring-money">
        <h2 id="scoring-money" className="section-title">No money, ever</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          XP, points and Keno tokens cannot be bought, sold, sent to anyone or swapped for anything. They count for the
          leaderboards and nothing else.
        </p>
      </section>
    </>
  )
}
