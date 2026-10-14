import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { resolveReport, restorePost } from '@/app/actions'
import { EmptyState } from '@/app/ui/empty-state'
import { ShieldIcon } from '@/app/ui/icons'
import { card, PostsSkeleton } from '@/app/ui/post-item'
import { SubmitButton } from '@/app/ui/submit-button'
import { timeAgo } from '@/app/ui/time'
import { getModeration, type LogEntry, type QueueItem } from '@/lib/api'

export const metadata: Metadata = { title: 'Moderation' }

const REASONS: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate: 'Hate speech',
  scam: 'Scam',
  illegal: 'Illegal content',
  other: 'Other',
  appeal: 'Appeal',
}

const ACTIONS: Record<string, string> = {
  remove_post: 'removed a post',
  restore_post: 'restored a post',
  suspend_member: 'suspended',
  reinstate_member: 'reinstated',
  dismiss_report: 'dismissed a report',
}

export default function ModerationPage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="page-title">Moderation</h1>
      <Suspense fallback={<PostsSkeleton />}>
        <Moderation />
      </Suspense>
    </div>
  )
}

async function Moderation() {
  const data = await getModeration()
  // To anyone who is not a moderator this page does not exist.
  if (!data) notFound()
  const now = Date.now()

  return (
    <>
      <section aria-label="Open reports" className="flex flex-col gap-3">
        <h2 className="section-title px-1">
          Open reports <span className="font-normal text-muted">({data.queue.length})</span>
        </h2>
        {data.queue.length === 0 ? (
          <EmptyState icon={<ShieldIcon size={22} />} title="The queue is clear">
            New reports and appeals will show up here.
          </EmptyState>
        ) : (
          data.queue.map((item) => <Report key={item.id} item={item} now={now} />)
        )}
      </section>

      <section aria-label="Recent decisions" className={`${card} p-4`}>
        <h2 className="section-title">Recent decisions</h2>
        {data.log.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No decisions yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {data.log.map((entry) => (
              <Decision key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

const button = 'btn btn-secondary btn-sm'
const danger = 'btn btn-danger btn-sm'

function Report({ item, now }: { item: QueueItem; now: number }) {
  const isAppeal = item.reason === 'appeal'
  // Every button submits the same form; its value is the decision.
  return (
    <form action={resolveReport} className={`${card} flex flex-col gap-3 p-4`}>
      <input type="hidden" name="id" value={item.id} />

      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="chip">
          {REASONS[item.reason] ?? item.reason}
        </span>
        <span className="text-muted">
          {isAppeal ? 'from' : 'reported by'} @{item.reporterHandle} · {timeAgo(item.createdAt, now)}
          {item.reportCount > 1 ? ` · ${item.reportCount} reports` : ''}
        </span>
      </p>

      {item.post ? (
        <blockquote className="rounded-lg bg-panel p-4 text-sm">
          <Link href={`/u/${item.post.authorHandle}`} className="font-semibold hover:underline">
            @{item.post.authorHandle}
          </Link>
          {item.post.communityName ? <span className="text-muted"> in {item.post.communityName}</span> : null}
          <p className="mt-1 whitespace-pre-wrap break-words">{item.post.text}</p>
        </blockquote>
      ) : item.member ? (
        <p className="text-sm">
          Account:{' '}
          <Link href={`/u/${item.member.handle}`} className="font-semibold hover:underline">
            @{item.member.handle}
          </Link>
          {item.member.active ? '' : ' (suspended)'}
        </p>
      ) : null}

      {item.details ? (
        <p className="text-sm">
          <span className="text-muted">{isAppeal ? 'They say: ' : 'Reporter says: '}</span>
          {item.details}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="field-label">
          Note for the record <span className="font-normal text-muted">(optional)</span>
        </span>
        <input name="note" maxLength={500} className="field" />
      </label>

      <div className="flex flex-wrap gap-2">
        {isAppeal ? (
          <SubmitButton name="resolution" value="reinstate_member" className={button}>
            Reinstate account
          </SubmitButton>
        ) : (
          <>
            {item.post ? (
              <SubmitButton name="resolution" value="remove_post" className={danger}>
                Remove post
              </SubmitButton>
            ) : null}
            <SubmitButton
              name="resolution"
              value="suspend_member"
              className={danger}
              confirmMessage="Suspend this account? They will not be able to post until reinstated."
            >
              Suspend account
            </SubmitButton>
          </>
        )}
        <SubmitButton name="resolution" value="dismiss" className={button}>
          {isAppeal ? 'Reject appeal' : 'Dismiss'}
        </SubmitButton>
      </div>
    </form>
  )
}

function Decision({ entry, now }: { entry: LogEntry; now: number }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span>
        <span className="font-semibold">@{entry.actorHandle}</span> {ACTIONS[entry.action] ?? entry.action}
        {entry.memberHandle && entry.action !== 'dismiss_report' ? (
          <>
            {entry.action.endsWith('_post') ? ' by ' : ' '}
            <span className="font-medium">@{entry.memberHandle}</span>
          </>
        ) : null}
      </span>
      <span className="text-muted">{timeAgo(entry.createdAt, now)}</span>
      {entry.note ? <span className="w-full text-muted">“{entry.note}”</span> : null}
      {entry.action === 'remove_post' && entry.postId ? (
        <form action={restorePost} className="w-full">
          <input type="hidden" name="id" value={entry.postId} />
          <SubmitButton className="text-xs font-semibold text-accent-strong hover:underline">Restore this post</SubmitButton>
        </form>
      ) : null}
    </li>
  )
}
