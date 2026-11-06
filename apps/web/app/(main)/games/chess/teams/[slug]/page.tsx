import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { ChessIcon } from '@/app/ui/icons'
import { PostsSkeleton } from '@/app/ui/post-item'
import { SubmitButton } from '@/app/ui/submit-button'
import { getChessTeam, getViewer } from '@/lib/api'
import { CompetitionSection, lagosInput } from '../../../competitions/_bits'
import { allowTournaments, linkTeam, unlinkTeam } from './actions'
import { TournamentForm } from './tournament-form'

export const metadata: Metadata = { title: 'Community chess', robots: { index: false } }

/** What a `?notice=` says, after linking or coming back from Lichess. */
const NOTICES: Record<string, { text: string; danger?: boolean }> = {
  team_linked: { text: 'The Lichess team is linked to this community.' },
  team_unlinked: { text: 'The Lichess team is unlinked. Tournaments already made still finish here.' },
  linked: { text: 'Lichess is connected, and HeyNaija may make tournaments for you.' },
  link_declined: { text: 'Nothing changed: you said no on Lichess.', danger: true },
  link_expired: { text: 'That link to Lichess ran out. Start again.', danger: true },
  link_failed: { text: 'Lichess could not be connected. Try again in a moment.', danger: true },
  already_linked: { text: 'That Lichess account is already connected to another HeyNaija member.', danger: true },
  too_many: { text: 'That was a lot of requests in a short time. Try again later.', danger: true },
}

/**
 * A community's chess on Lichess (docs/adr/0018, phase 6): its linked Lichess
 * team, and its Arena and Swiss tournaments. A moderator of the community who
 * leads the team on Lichess links it and makes the tournaments.
 */
export default function CommunityChessPage({ params, searchParams }: PageProps<'/games/chess/teams/[slug]'>) {
  return (
    <div className="page-stack">
      <Suspense fallback={<PostsSkeleton />}>
        <CommunityChess params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function CommunityChess({ params, searchParams }: Pick<PageProps<'/games/chess/teams/[slug]'>, 'params' | 'searchParams'>) {
  const [{ slug }, query, viewer] = await Promise.all([params, searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games || !/^[a-z0-9-]{1,60}$/.test(slug)) notFound()
  const view = await getChessTeam(slug)
  if (!view) notFound()
  const notice = typeof query.notice === 'string' ? NOTICES[query.notice] : undefined
  const error = typeof query.error === 'string' ? query.error.slice(0, 300) : null
  const { community, team, you } = view
  // The earliest start the form offers: ten minutes from now, in Lagos.
  const earliest = lagosInput(new Date(Date.now() + 11 * 60_000))

  return (
    <>
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/chess" className="hover:underline">Chess</Link>
        </p>
        <h1 className="page-title">Chess for {community.name}</h1>
        <p className="page-description">
          Tournaments for the community’s team on Lichess. Games are played on lichess.org; HeyNaija shows the members
          who play, the standings and the results, and The Arbiter posts the results in{' '}
          <Link href={`/c/${community.slug}`} className="underline">{community.name}</Link>.
        </p>
      </header>

      {notice ? (
        <p role={notice.danger ? 'alert' : 'status'} className={notice.danger ? 'notice notice-danger' : 'notice'}>
          {notice.text}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      ) : null}

      <section className="content-panel" aria-labelledby="team-heading">
        <h2 id="team-heading" className="section-title">Lichess team</h2>
        {team ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0">
              <a href={team.url} className="font-semibold underline" target="_blank" rel="noopener noreferrer">
                {team.name}
              </a>
              <span className="text-sm text-muted"> · {team.nbMembers.toLocaleString('en-NG')} on Lichess</span>
            </p>
            {you.canUnlink ? (
              <form action={unlinkTeam}>
                <input type="hidden" name="slug" value={community.slug} />
                <SubmitButton className="btn btn-secondary" confirmMessage="Unlink this Lichess team? Tournaments already made still finish here.">
                  Unlink
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No Lichess team is linked to this community yet.</p>
        )}
        {you.communityModerator && !you.lichess ? (
          <p className="mt-3 text-sm">
            To link a team, first <Link href="/games/chess" className="underline">connect your Lichess account</Link>.
          </p>
        ) : null}
        {you.canLink ? (
          <form action={linkTeam} className="mt-4 flex flex-col gap-2">
            <input type="hidden" name="slug" value={community.slug} />
            <label className="flex flex-col gap-1.5">
              <span className="field-label">{team ? 'Link a different team' : 'Link a team'}</span>
              <input name="team" className="field" required maxLength={200} placeholder="lichess.org/team/your-team" />
              <span className="text-xs text-muted">
                Paste the team’s address on Lichess. You must be one of its leaders there, signed in as {you.lichess}.
              </span>
            </label>
            <div>
              <SubmitButton className="btn btn-secondary">Link team</SubmitButton>
            </div>
          </form>
        ) : null}
      </section>

      {you.communityModerator && team ? (
        <section className="content-panel" aria-labelledby="new-tournament">
          <h2 id="new-tournament" className="section-title">New tournament</h2>
          {you.canCreate ? (
            <div className="mt-4">
              <TournamentForm slug={community.slug} controls={view.controls} swissRounds={view.swissRounds} earliest={earliest} />
            </div>
          ) : (
            <form action={allowTournaments} className="mt-2 flex flex-col items-start gap-3">
              <input type="hidden" name="slug" value={community.slug} />
              <p className="text-sm text-muted">
                Lichess makes the tournament in your name, so it asks you once to let HeyNaija make tournaments for you.
                HeyNaija asks this only of moderators who run tournaments.
              </p>
              <SubmitButton className="btn btn-primary">{you.lichess ? 'Allow tournaments on Lichess' : 'Connect Lichess and allow tournaments'}</SubmitButton>
            </form>
          )}
        </section>
      ) : null}

      {view.tournaments.current.length ? <CompetitionSection title="Coming up and live" items={view.tournaments.current} /> : null}
      {view.tournaments.recent.length ? <CompetitionSection title="Recent tournaments" items={view.tournaments.recent} /> : null}
      {!view.tournaments.current.length && !view.tournaments.recent.length ? (
        <section className="content-panel">
          <EmptyState icon={<ChessIcon size={28} />} title="No tournaments yet">
            {team ? 'When the moderators make one, it shows here.' : 'Once a Lichess team is linked, its tournaments show here.'}
          </EmptyState>
        </section>
      ) : null}
    </>
  )
}
