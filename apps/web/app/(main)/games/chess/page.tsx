import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { ChessIcon } from '@/app/ui/icons'
import { LocalTime } from '@/app/ui/local-time'
import { PostsSkeleton } from '@/app/ui/post-item'
import { SubmitButton } from '@/app/ui/submit-button'
import { type ChessOverview, getChessOverview, getLiveChessGames, getViewer } from '@/lib/api'
import { connectLichess, disconnectLichess, refreshRatings } from './actions'
import { ChallengeForm } from './_components/challenge-form'
import { ChallengeList } from './_components/challenge-list'
import { LiveGames } from './_components/live-games'

export const metadata: Metadata = { title: 'Chess', robots: { index: false } }

/** What a `?notice=` says: the outcome of the last thing the member did here. */
const NOTICES: Record<string, { text: string; danger?: boolean }> = {
  linked: { text: 'Your Lichess account is connected.' },
  unlinked: { text: 'Your Lichess account is disconnected. HeyNaija no longer holds its key.' },
  accepted: { text: 'Challenge accepted. Your game is ready: open it below.' },
  link_declined: { text: 'Lichess was not connected: you said no on Lichess.', danger: true },
  link_expired: { text: 'That link to Lichess ran out or was not yours. Start again.', danger: true },
  link_failed: { text: 'Lichess could not be connected. Try again in a moment.', danger: true },
  already_linked: { text: 'That Lichess account is already connected to another HeyNaija member.', danger: true },
  not_available: { text: 'Connecting Lichess is not available here yet.', danger: true },
  reconnect: { text: 'Lichess no longer accepts your connection. Disconnect and connect Lichess again.', danger: true },
  lichess_busy: { text: 'Lichess is busy. Try again in a minute.', danger: true },
  lichess_unavailable: { text: 'Lichess did not answer. Try again in a moment.', danger: true },
  lichess_rejected: { text: 'Lichess would not make that game. Their Lichess connection may have lapsed.', danger: true },
  not_found: { text: 'That challenge is no longer open.', danger: true },
  not_linked: { text: 'Connect your Lichess account first.', danger: true },
  too_many: { text: 'That was a lot of requests in a short time. Try again later.', danger: true },
}

const SPEEDS = [
  ['blitz', 'Blitz'],
  ['rapid', 'Rapid'],
  ['classical', 'Classical'],
  ['correspondence', 'Correspondence'],
] as const

/** Chess on Lichess (docs/games/GAMES.md): connect your account, see your ratings, challenge members. */
export default function ChessPage({ searchParams }: PageProps<'/games/chess'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Games</p>
        <h1 className="page-title">Chess</h1>
        <p className="page-description">
          Play other members right here, on Lichess, the free and open chess site: Lichess runs the games, the ratings
          and fair play. Watch games being played, and talk about them in Chess Arena.
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Chess searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Chess({ searchParams }: Pick<PageProps<'/games/chess'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const [chess, live] = await Promise.all([getChessOverview(), getLiveChessGames()])
  if (!chess) notFound()
  const notice = typeof params.notice === 'string' ? NOTICES[params.notice] : undefined
  const opponent = typeof params.opponent === 'string' ? params.opponent.replace(/[^a-z0-9_]/gi, '').slice(0, 20) : undefined
  const now = Date.now()

  return (
    <>
      {notice ? (
        <p role={notice.danger ? 'alert' : 'status'} className={notice.danger ? 'notice notice-danger' : 'notice'}>
          {notice.text}
        </p>
      ) : null}
      <LichessCard chess={chess} now={now} />

      <section className="content-panel" aria-labelledby="chess-live">
        <h2 id="chess-live" className="section-title">Live now</h2>
        <LiveGames initial={live} />
      </section>

      <section className="content-panel" aria-labelledby="chess-incoming">
        <h2 id="chess-incoming" className="section-title">Challenges to you</h2>
        {chess.incoming.length ? (
          <ChallengeList challenges={chess.incoming} now={now} />
        ) : (
          <EmptyState icon={<ChessIcon size={28} />} title="No challenges waiting">
            When a member challenges you, it shows here and you are notified.
          </EmptyState>
        )}
      </section>

      {chess.account ? (
        <section className="content-panel" aria-labelledby="chess-challenge">
          <h2 id="chess-challenge" className="section-title">Challenge a member</h2>
          <div className="mt-4">
            <ChallengeForm timeControls={chess.timeControls} opponent={opponent} />
          </div>
          {chess.outgoing.length ? (
            <>
              <h3 className="mt-6 text-sm font-semibold">Waiting for an answer</h3>
              <ChallengeList challenges={chess.outgoing} now={now} />
            </>
          ) : null}
        </section>
      ) : null}

      {chess.recent.length ? (
        <section className="content-panel" aria-labelledby="chess-recent">
          <h2 id="chess-recent" className="section-title">Recent challenges</h2>
          <ChallengeList challenges={chess.recent} now={now} />
        </section>
      ) : null}
    </>
  )
}

function LichessCard({ chess, now }: { chess: ChessOverview; now: number }) {
  const account = chess.account
  return (
    <section className="content-panel" aria-labelledby="chess-lichess">
      <h2 id="chess-lichess" className="section-title">Your Lichess account</h2>
      {account ? (
        <>
          <p className="mt-2 text-sm">
            Connected as{' '}
            <a href={account.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-strong hover:underline">
              {account.username}
            </a>
          </p>
          <dl className="chess-ratings">
            {SPEEDS.map(([speed, name]) => {
              const r = account.ratings[speed]
              return (
                <div key={speed}>
                  <dt>{name}</dt>
                  <dd>{r ? `${r.rating}${r.provisional ? '?' : ''}` : 'Not played'}</dd>
                </div>
              )
            })}
          </dl>
          <p className="text-xs text-muted">
            Ratings from Lichess{account.ratingsRefreshedAt ? <>, updated <LocalTime at={account.ratingsRefreshedAt} now={now} /></> : ''}. A ? means
            the rating is provisional.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <form action={refreshRatings}>
              <SubmitButton className="btn btn-secondary btn-sm">Refresh ratings</SubmitButton>
            </form>
            <form action={disconnectLichess}>
              <SubmitButton
                className="btn btn-ghost btn-sm"
                confirmMessage="Disconnect your Lichess account? HeyNaija gives back its key, and challenges to you can no longer be accepted until you connect again."
              >
                Disconnect
              </SubmitButton>
            </form>
          </div>
        </>
      ) : chess.linkingAvailable ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Connect a Lichess account to challenge members and show your ratings on your profile. You will be asked on
            lichess.org; HeyNaija asks only to create and accept challenges and to play your games, and keeps that key
            locked. Your Lichess username is shown to other members.
          </p>
          <form action={connectLichess} className="mt-4">
            <SubmitButton className="btn btn-primary">Connect Lichess</SubmitButton>
          </form>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Connecting Lichess is not available here yet.</p>
      )}
    </section>
  )
}
