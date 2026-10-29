'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { setIdeaVote, toggleIdeaVote } from '@/app/idea-actions'
import { UpvoteIcon } from './icons'
import { remember, useMine, withChoice } from './my-activity'

/**
 * A vote for an idea, separate from likes: one each. It changes at once, as a
 * like does, and everywhere the idea is on screen. Closed ideas take no new
 * votes, but a vote can still be taken back. Visitors are offered sign-in.
 */
export function IdeaVote({
  id,
  voted: drawn,
  votes: drawnVotes,
  open,
  member,
}: {
  id: string
  voted: boolean
  votes: number
  /** Under review, planned or in progress. */
  open: boolean
  member: boolean
}) {
  const voted = useMine(id)?.voted ?? drawn
  const votes = withChoice(drawnVotes, drawn, voted)
  const [pending, startTransition] = useTransition()
  const count = votes === 1 ? '1 vote' : `${votes} votes`
  const face = (
    <>
      <UpvoteIcon size={16} />
      <span className="tabular-nums">{votes}</span>
    </>
  )

  if (!member) {
    return (
      <Link href="/login" className="idea-vote" aria-label={`Sign in to vote (${count})`}>
        {face}
      </Link>
    )
  }
  if (!open && !voted) {
    return (
      <span className="idea-vote is-closed" aria-label={`Closed to votes (${count})`}>
        {face}
      </span>
    )
  }
  return (
    <form
      action={setIdeaVote}
      onSubmit={(e) => {
        e.preventDefault()
        if (pending) return
        const on = !voted
        remember(id, { voted: on })
        startTransition(async () => {
          const result = await toggleIdeaVote(id, on).catch(() => ({ ok: false }))
          if (!result.ok) remember(id, { voted: !on })
        })
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="on" value={voted ? '0' : '1'} />
      <button
        type="submit"
        className="idea-vote"
        aria-pressed={voted}
        aria-label={voted ? `Take back your vote (${count})` : `Vote for this (${count})`}
      >
        {face}
      </button>
    </form>
  )
}
