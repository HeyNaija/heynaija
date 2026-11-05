import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { EmptyState } from '@/app/ui/empty-state'
import { TrophyIcon } from '@/app/ui/icons'
import { LocalTime } from '@/app/ui/local-time'
import { PostsSkeleton } from '@/app/ui/post-item'
import { SubmitButton } from '@/app/ui/submit-button'
import { type Competition, type CompetitionStanding, getCompetition, getViewer } from '@/lib/api'
import { competitionAction } from '../actions'
import { clockLabel, ELIGIBILITY, gameLabel, scoreLabel, STATUS, When } from '../_bits'

export const metadata: Metadata = { title: 'Competition', robots: { index: false } }

/** One competition: its rules, entering, and the standings (docs/adr/0018, phases 5 and 6). */
export default function CompetitionPage({ params, searchParams }: PageProps<'/games/competitions/[id]'>) {
  return (
    <div className="page-stack">
      <Suspense fallback={<PostsSkeleton />}>
        <CompetitionView params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function CompetitionView({ params, searchParams }: Pick<PageProps<'/games/competitions/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query, viewer] = await Promise.all([params, searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games || !/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCompetition(id)
  if (!c) notFound()
  const error = typeof query.error === 'string' ? query.error.slice(0, 200) : null
  const editable = c.status === 'draft' || (c.status === 'open' && Date.parse(c.entryOpensAt) > Date.now())
  const shown = c.standings.some((s) => s.you)
  const notice = query.notice === 'lichess_kept' ? 'Cancelled here. Lichess did not end it, so it may still run there.' : null
  return (
    <>
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/competitions" className="hover:underline">Competitions</Link>
        </p>
        <h1 className="page-title">{c.name}</h1>
        <p className="page-description">
          <span className="chip">{STATUS[c.status]}</span> {gameLabel(c)} · <When c={c} />
        </p>
      </header>

      {notice ? <p className="notice" role="status">{notice}</p> : null}

      {c.chess ? <TournamentRules c={c} t={c.chess} error={error} /> : (
      <section className="content-panel" aria-labelledby="competition-rules">
        <h2 id="competition-rules" className="section-title">How it works</h2>
        <dl className="keno-proof">
          <dt>Scoring</dt>
          <dd>{c.formatText} Ties share a place.</dd>
          <dt>Who can enter</dt>
          <dd>
            {ELIGIBILITY[c.eligibility]}
            {c.community ? (
              <>
                : <Link href={`/c/${c.community.slug}`} className="underline">{c.community.name}</Link>
              </>
            ) : null}
            .
          </dd>
          <dt>Entry</dt>
          <dd>
            Opens <LocalTime at={c.entryOpensAt} as="posted" />, closes <LocalTime at={c.entryClosesAt} as="posted" />. You can
            withdraw until entry closes.
          </dd>
          <dt>Game Score</dt>
          <dd>
            Everyone who plays in it gets XP for taking part, and more for a top-ten place. <Link href="/games/scoring" className="underline">How scoring works</Link>
          </dd>
        </dl>
        {error ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <form action={competitionAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          {c.you.canEnter ? (
            <SubmitButton className="btn btn-primary" name="action" value="enter">Enter</SubmitButton>
          ) : null}
          {c.you.canWithdraw ? (
            <SubmitButton className="btn btn-secondary" name="action" value="withdraw" confirmMessage="Withdraw from this competition? Points you scored in it go too.">
              Withdraw
            </SubmitButton>
          ) : null}
          {c.you.entered ? <span className="text-sm font-semibold">You’re in.</span> : null}
          {!c.you.entered && !c.you.canEnter && c.you.reason && c.status !== 'finished' && c.status !== 'cancelled' ? (
            <span className="text-sm text-muted">{c.you.reason}</span>
          ) : null}
          {c.you.entered && c.status !== 'finished' ? (
            <Link href="/games/keno" className="btn btn-secondary">Play Keno</Link>
          ) : null}
        </form>
        {c.you.moderator && c.status !== 'finished' && c.status !== 'cancelled' ? (
          <form action={competitionAction} className="mt-3 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
            <input type="hidden" name="id" value={c.id} />
            {c.status === 'draft' ? <SubmitButton className="btn btn-primary" name="action" value="publish">Publish</SubmitButton> : null}
            {editable ? <Link href={`/games/competitions/${c.id}/edit`} className="btn btn-secondary">Change</Link> : null}
            <SubmitButton className="btn btn-danger" name="action" value="cancel" confirmMessage="Cancel this competition? It cannot be undone.">
              Cancel competition
            </SubmitButton>
          </form>
        ) : null}
      </section>
      )}

      <section className="content-panel" aria-labelledby="competition-standings">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <h2 id="competition-standings" className="section-title">{c.status === 'finished' ? 'Final standings' : 'Standings'}</h2>
          <span className="text-sm text-muted">
            {c.chess
              ? `${c.entrants} from HeyNaija${c.chess.players !== null ? ` · ${c.chess.players} on Lichess` : ''}`
              : `${c.entrants} ${c.entrants === 1 ? 'entrant' : 'entrants'}`}
          </span>
        </div>
        {c.chess && c.status !== 'finished' && c.status !== 'cancelled' ? (
          <p className="mt-1 text-sm text-muted">Read from Lichess every couple of minutes. Lichess decides the results.</p>
        ) : null}
        {c.resultPostId ? (
          <p className="mt-1 text-sm">
            <Link href={`/p/${c.resultPostId}`} className="underline">The Arbiter’s result post</Link>
          </p>
        ) : null}
        {c.standings.length ? (
          <ol className="keno-board">
            {c.standings.map((s) => (
              <StandingLine key={s.handle} s={s} format={c.format} />
            ))}
            {c.yourStanding && !shown ? (
              <>
                <li className="keno-board-gap" aria-hidden="true">…</li>
                <StandingLine s={c.yourStanding} format={c.format} />
              </>
            ) : null}
          </ol>
        ) : (
          c.chess ? (
            <EmptyState icon={<TrophyIcon size={28} />} title="No HeyNaija members have played yet">
              Members of the community who have connected Lichess show here once they play in it.
            </EmptyState>
          ) : (
            <EmptyState icon={<TrophyIcon size={28} />} title="Nobody has entered yet">
              {c.you.canEnter ? 'Be the first.' : 'Entrants will be listed here.'}
            </EmptyState>
          )
        )}
      </section>
    </>
  )
}

/** A Lichess tournament's rules, and where to join and play it (on lichess.org). */
function TournamentRules({ c, t, error }: { c: Competition; t: NonNullable<Competition['chess']>; error: string | null }) {
  const open = c.status !== 'finished' && c.status !== 'cancelled'
  return (
    <section className="content-panel" aria-labelledby="competition-rules">
      <h2 id="competition-rules" className="section-title">How it works</h2>
      <dl className="keno-proof">
        <dt>Format</dt>
        <dd>{c.formatText}</dd>
        <dt>Games</dt>
        <dd>
          {clockLabel(t.clock)}, {t.rated ? 'rated' : 'casual'}, {t.kind === 'arena' ? `for ${t.minutes} minutes` : `${t.rounds} rounds`}. Played on
          lichess.org.
        </dd>
        <dt>Who can play</dt>
        <dd>
          Members of the Lichess team{t.teamName ? ` ${t.teamName}` : ''}. HeyNaija members of{' '}
          {c.community ? <Link href={`/c/${c.community.slug}`} className="underline">{c.community.name}</Link> : 'the community'} who have connected
          Lichess show in the standings here, in Lichess’s order.
        </dd>
        <dt>Game Score</dt>
        <dd>
          XP for taking part, and more for a top-ten place among HeyNaija members. <Link href="/games/scoring" className="underline">How scoring works</Link>
        </dd>
        {t.unfinished ? (
          <>
            <dt>Note</dt>
            <dd>Lichess had not finished it a day after it was due to end, so it was finished from the last standings read.</dd>
          </>
        ) : null}
      </dl>
      {error ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a href={t.url} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
          {open ? 'Join on Lichess' : 'See it on Lichess'}
        </a>
        {open ? (
          <a href={t.teamUrl} className="btn btn-secondary" target="_blank" rel="noopener noreferrer">
            Join the team
          </a>
        ) : null}
      </div>
      {c.you.canCancel ? (
        <form action={competitionAction} className="mt-3 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
          <input type="hidden" name="id" value={c.id} />
          <SubmitButton className="btn btn-danger" name="action" value="cancel_tournament" confirmMessage="Cancel this tournament? It ends on Lichess too, and cannot be undone.">
            Cancel tournament
          </SubmitButton>
        </form>
      ) : null}
    </section>
  )
}

function StandingLine({ s, format }: { s: CompetitionStanding; format: string }) {
  return (
    <li className="keno-board-row" data-you={s.you || undefined}>
      <span className="keno-rank">{s.place ?? '–'}</span>
      <Link href={`/u/${s.handle}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
        <Avatar handle={s.handle} src={s.avatar} size={28} />
        <span className="min-w-0">
          <span className="block truncate">
            {s.displayName ?? `@${s.handle}`}
            {s.you ? <span className="text-muted"> (you)</span> : null}
          </span>
          {s.lichess ? (
            <span className="block truncate text-xs text-muted">
              {s.lichess.rank !== null ? `#${s.lichess.rank} on Lichess` : 'On Lichess'}
              {s.lichess.username ? ` · ${s.lichess.username}` : ''}
            </span>
          ) : null}
        </span>
      </Link>
      <span className="keno-points">{s.score === null ? <span className="text-sm font-normal text-muted">not played yet</span> : scoreLabel(format, s.score)}</span>
    </li>
  )
}
