'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { castPollVote, type PollVoteState } from '@/app/actions'
import type { Poll } from '@/lib/api'
import { LocalTime } from './local-time'

const initial: PollVoteState = {}

export function PollCard({ postId, poll, member }: { postId: string; poll: Poll; member: boolean }) {
  const [state, action, pending] = useActionState(castPollVote, initial)
  const voting = member && !poll.closed && !poll.viewerVoted
  const inputType = poll.multiple ? 'checkbox' : 'radio'
  // In the reader's own time zone, like every other time on the page.
  const expiry = poll.expiresAt
    ? <span>{poll.closed ? 'Ended' : 'Ends'} <LocalTime at={poll.expiresAt} as="date" /></span>
    : <span>No expiry</span>

  const choices = poll.options.map((option) => {
    const percent = poll.totalVotes ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0
    const content = (
      <>
        <span className="poll-result-bar" style={{ width: `${Math.min(100, percent)}%` }} />
        {voting ? <input type={inputType} name="option" value={option.id} required={!poll.multiple} /> : null}
        <span className="poll-option-text">{option.text}</span>
        <span className="poll-option-count">{percent}% · {option.voteCount}</span>
        {option.viewerVoted ? <span className="sr-only">Your choice</span> : null}
      </>
    )
    return voting ? (
      <label key={option.id} className="poll-option">{content}</label>
    ) : (
      <div key={option.id} className={`poll-option${option.viewerVoted ? ' is-selected' : ''}`}>{content}</div>
    )
  })

  return (
    <section className="poll-card" aria-label={poll.multiple ? 'Multiple-choice poll' : 'Poll'}>
      {voting ? (
        <form action={action}>
          <input type="hidden" name="id" value={postId} />
          <fieldset disabled={pending}>
            <legend className="sr-only">{poll.multiple ? 'Choose one or more options' : 'Choose one option'}</legend>
            <div className="poll-options">{choices}</div>
          </fieldset>
          <div className="poll-submit-row">
            <span>{poll.multiple ? 'Choose one or more' : 'Choose one'}</span>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={pending}>
              {pending ? 'Voting…' : 'Vote'}
            </button>
          </div>
        </form>
      ) : <div className="poll-options">{choices}</div>}
      {state.error ? <p role="alert" className="poll-error">{state.error}</p> : null}
      <p className="poll-meta">
        <Link prefetch={false} href={`/p/${postId}/votes`}>
          {poll.totalVotes === 1 ? '1 public voter' : `${poll.totalVotes} public voters`}
        </Link>
        <span aria-hidden="true">·</span>
        {expiry}
        {!member && !poll.closed ? <><span aria-hidden="true">·</span><Link href="/login">Sign in to vote</Link></> : null}
      </p>
    </section>
  )
}
