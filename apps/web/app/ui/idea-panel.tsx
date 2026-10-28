import Link from 'next/link'
import type { IdeaDetail } from '@/lib/api'
import { OPEN_STATUSES, STATUS_LABELS } from '@/lib/ideas'
import { IdeaKindChip, IdeaStatusChip } from './idea-chips'
import { IdeaModeration } from './idea-moderation'
import { IdeaVote } from './idea-vote'

const day = (at: string) => new Date(at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })

/** Above an idea's post: its status and votes, what happened to it so far, and, for moderators, the controls. */
export function IdeaPanel({ idea, member }: { idea: IdeaDetail; member: boolean }) {
  return (
    <section className="content-panel idea-panel" aria-labelledby="idea-title">
      <div className="flex items-start gap-4">
        <IdeaVote id={idea.id} voted={idea.viewerVoted} votes={idea.votes} open={OPEN_STATUSES.includes(idea.status)} member={member} />
        <div className="min-w-0 flex-1">
          <p className="idea-meta">
            <IdeaKindChip kind={idea.kind} />
            <IdeaStatusChip status={idea.status} />
            <Link href="/ideas" className="hover:underline">On the ideas board</Link>
          </p>
          <h1 id="idea-title" className="idea-heading">{idea.title}</h1>
          {/* Why it is not happening is said up front; other notes are in the timeline below. */}
          {idea.status === 'not_now' && idea.statusReason ? <p className="idea-reason">{idea.statusReason}</p> : null}
          {idea.duplicateOf ? (
            <p className="idea-reason">
              The same as <Link href={`/p/${idea.duplicateOf.id}`} className="font-semibold text-accent-strong hover:underline">{idea.duplicateOf.title}</Link>, where its votes went.
            </p>
          ) : null}
        </div>
      </div>

      <h2 className="sr-only">What has happened to it</h2>
      <ol className="idea-timeline">
        {idea.timeline.map((step, i) => (
          <li key={`${step.at}-${i}`}>
            <span className="font-semibold text-ink">{i === 0 ? (idea.kind === 'idea' ? 'Suggested' : 'Reported') : STATUS_LABELS[step.status]}</span>
            <span> · {day(step.at)}</span>
            {i > 0 && step.reason ? <span>: {step.reason}</span> : null}
          </li>
        ))}
      </ol>

      {idea.problem ? (
        <div className="idea-private">
          <p className="font-semibold">Only the reporter and Building HeyNaija’s moderators see this</p>
          <dl className="mt-1 text-muted">
            <dt className="inline font-semibold">Page: </dt>
            <dd className="inline break-all">{idea.problem.page ?? 'not given'}</dd>
            <br />
            <dt className="inline font-semibold">Browser: </dt>
            <dd className="inline break-all">{idea.problem.browser ?? 'not given'}</dd>
            <br />
            <dt className="inline font-semibold">Version: </dt>
            <dd className="inline">{idea.problem.appVersion ?? 'not given'}</dd>
          </dl>
        </div>
      ) : null}

      {idea.viewerCanModerate ? <IdeaModeration key={idea.status} id={idea.id} status={idea.status} /> : null}
    </section>
  )
}
