import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { IdeaKindChip, IdeaStatusChip } from '@/app/ui/idea-chips'
import { IdeaVote } from '@/app/ui/idea-vote'
import { IdeaIcon } from '@/app/ui/icons'
import { LocalTime } from '@/app/ui/local-time'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getIdeas, getViewer, type IdeaGroup, type IdeaKind } from '@/lib/api'
import { type BoardChoice, boardHref, GROUP_LABELS, OPEN_STATUSES } from '@/lib/ideas'

export const metadata: Metadata = {
  title: 'Ideas and problems',
  description: 'Suggest what HeyNaija should do next or report what is not working, vote for what matters to you, and follow each from review to release.',
}

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined)

/** The board (ADR 0015): open, shipped and closed ideas and problems, by votes or newest. */
export default function IdeasPage({ searchParams }: PageProps<'/ideas'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Building HeyNaija</p>
        <h1 className="page-title">Ideas and problems</h1>
        <p className="page-description">
          Suggest what HeyNaija should do next, or tell us what is not working. Vote for what matters to you, and follow
          each one from review to release. Everything here is public, like any post.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/ideas/new" className="btn btn-primary">Suggest an idea</Link>
          <Link href="/ideas/new?kind=problem" className="btn btn-secondary">Report a problem</Link>
        </div>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Board searchParams={searchParams} />
      </Suspense>
      <section className="content-panel" aria-labelledby="board-how">
        <h2 id="board-how" className="section-title">How the board works</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Each idea or problem is a post in <Link href="/c/building-heynaija" className="font-semibold text-accent-strong hover:underline">Building HeyNaija</Link>,
            so anyone can reply to it. Votes are separate from likes: one each, and you can take yours back.
          </li>
          <li>
            Building HeyNaija’s moderators move each one from Under review to Planned, In progress and Shipped, or close it
            as Not now or as a Duplicate, saying why in public. A duplicate’s votes move to the idea it repeats.
          </li>
          <li>Whoever sent it, and everyone who voted for it, is told when its status changes.</li>
          <li>
            A problem report also carries the page it came from, your browser and the app’s version. Only you and the board’s
            moderators see those.
          </li>
        </ul>
      </section>
    </div>
  )
}

async function Board({ searchParams }: Pick<PageProps<'/ideas'>, 'searchParams'>) {
  const params = await searchParams
  const group: IdeaGroup = one(params.group) === 'shipped' ? 'shipped' : one(params.group) === 'closed' ? 'closed' : 'open'
  const kind: IdeaKind | 'all' = one(params.kind) === 'idea' ? 'idea' : one(params.kind) === 'problem' ? 'problem' : 'all'
  const sort = one(params.sort) === 'new' ? 'new' : 'top'
  const cursor = Number(one(params.cursor)) || undefined
  const choice: BoardChoice = { group, kind, sort }
  const [{ ideas, cursor: next }, viewer] = await Promise.all([
    getIdeas({ group, kind: kind === 'all' ? undefined : kind, sort, cursor }),
    getViewer(),
  ])
  const member = viewer.state === 'member'
  const now = Date.now()

  return (
    <section aria-labelledby="board-list" className="flex flex-col gap-4">
      <h2 id="board-list" className="sr-only">
        {GROUP_LABELS[group]} {kind === 'all' ? 'ideas and problems' : kind === 'idea' ? 'ideas' : 'problems'}, {sort === 'top' ? 'most votes first' : 'newest first'}
      </h2>
      <nav aria-label="Board" className="feed-tabs">
        {(['open', 'shipped', 'closed'] as const).map((g) => (
          <Link key={g} href={boardHref({ ...choice, group: g })} aria-current={g === group ? 'page' : undefined} className="feed-tab">
            {GROUP_LABELS[g]}
          </Link>
        ))}
      </nav>
      <div className="board-filters">
        <nav aria-label="Kind" className="board-filter-group">
          {(['all', 'idea', 'problem'] as const).map((k) => (
            <Link key={k} href={boardHref({ ...choice, kind: k })} aria-current={k === kind ? 'page' : undefined} className="board-filter">
              {k === 'all' ? 'All' : k === 'idea' ? 'Ideas' : 'Problems'}
            </Link>
          ))}
        </nav>
        <nav aria-label="Order" className="board-filter-group">
          {(['top', 'new'] as const).map((s) => (
            <Link key={s} href={boardHref({ ...choice, sort: s })} aria-current={s === sort ? 'page' : undefined} className="board-filter">
              {s === 'top' ? 'Most votes' : 'Newest'}
            </Link>
          ))}
        </nav>
      </div>

      {ideas.length ? (
        <ul className="idea-list">
          {ideas.map((idea) => (
            <li key={idea.id} className="idea-row">
              <IdeaVote id={idea.id} voted={idea.viewerVoted} votes={idea.votes} open={OPEN_STATUSES.includes(idea.status)} member={member} />
              <div className="min-w-0 flex-1">
                <Link href={`/p/${idea.id}`} className="idea-title">
                  {idea.title}
                </Link>
                <p className="idea-meta">
                  <IdeaKindChip kind={idea.kind} />
                  <IdeaStatusChip status={idea.status} />
                  <span>@{idea.author.handle}</span>
                  <span aria-hidden="true">·</span>
                  <span>{idea.replyCount === 1 ? '1 reply' : `${idea.replyCount} replies`}</span>
                  <span aria-hidden="true">·</span>
                  <LocalTime at={idea.createdAt} now={now} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="content-panel">
          <EmptyState icon={<IdeaIcon size={22} />} title={cursor ? 'No more here' : group === 'open' ? 'Nothing open yet' : group === 'shipped' ? 'Nothing shipped yet' : 'Nothing closed yet'}>
            {group === 'open' ? 'Be the first to suggest an idea or report a problem.' : null}
          </EmptyState>
        </div>
      )}
      {next ? (
        <Link href={boardHref(choice, next)} className="btn btn-secondary btn-block">
          More
        </Link>
      ) : null}
    </section>
  )
}
