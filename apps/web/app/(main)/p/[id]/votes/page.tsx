import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { getPollVoters, getPost } from '@/lib/api'

export const metadata: Metadata = { title: 'Poll voters' }

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ cursor?: string }>
}

export default function PollVotersPage(props: Props) {
  return (
    <Suspense fallback={<div className="square-card" aria-busy="true">Loading public votes…</div>}>
      <PollVotersView {...props} />
    </Suspense>
  )
}

async function PollVotersView({
  params,
  searchParams,
}: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const [post, page] = await Promise.all([
    getPost(id),
    getPollVoters(id, typeof query.cursor === 'string' ? query.cursor : undefined).catch(() => null),
  ])
  if (!post?.poll || !page) notFound()
  const poll = post.poll
  const options = new Map(poll.options.map((option) => [option.id, option.text]))

  return (
    <div className="page-stack">
      <div>
        <Link prefetch={false} href={`/p/${id}`} className="text-sm font-medium text-muted hover:text-ink hover:underline">
          Back to the poll
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Public poll votes</h1>
        <p className="mt-2 text-muted">{post.text}</p>
      </div>

      {page.voters.length ? (
        <ul className="square-card divide-y divide-line" aria-label="Poll voters">
          {page.voters.map((vote) => (
            <li key={vote.member.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <Link prefetch={false} href={`/u/${vote.member.handle}`} className="shrink-0 rounded-full">
                <Avatar handle={vote.member.handle} src={vote.member.avatar} size={36} />
              </Link>
              <div className="min-w-0">
                <Link prefetch={false} href={`/u/${vote.member.handle}`} className="font-semibold hover:underline">
                  {vote.member.displayName ?? `@${vote.member.handle}`}
                </Link>
                {vote.member.displayName ? <p className="text-xs text-muted">@{vote.member.handle}</p> : null}
                <p className="mt-1 text-sm text-muted">
                  {vote.optionIds.map((optionId) => options.get(optionId)).filter(Boolean).join(', ')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="square-card text-sm text-muted">No one has voted yet.</div>
      )}

      {page.cursor ? (
        <Link prefetch={false} href={`/p/${id}/votes?cursor=${encodeURIComponent(page.cursor)}`} className="btn btn-secondary self-start">
          More voters
        </Link>
      ) : null}
    </div>
  )
}
