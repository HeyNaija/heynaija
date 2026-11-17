'use client'

import { useActionState } from 'react'
import { decideKekeNews, type FormState } from '@/app/actions'
import type { KekeNewsDraft } from '@/lib/api'
import { SubmitButton } from './submit-button'

const STATUS: Record<KekeNewsDraft['status'], string> = {
  waiting: 'Waiting for a decision. Nothing is posted unless it is approved by 08:00.',
  approved: 'Approved: it will be posted at 08:00. You can still change it until then.',
  skipped: 'Skipped: nothing will be posted today. You can still approve it until 08:00.',
  missed: 'Nobody approved it by 08:00, so nothing was posted today.',
  published: 'Posted in Naija Today.',
  too_few: 'No news today: fewer than three stories were carried by three or more outlets.',
  failed: 'No news today: the model did not answer, so Keke could not draft it. The reason is in the API’s log.',
  over_budget: 'No news today: Keke has reached this month’s spending cap (Keke this month, below).',
}

/**
 * Keke's news for today on /mod (ADR 0030): each story's sentence, which can be
 * edited, its outlets and link, a box to keep or remove it, and Approve or Skip
 * today. One plain form, so it works before JavaScript has loaded.
 */
export function KekeNewsPanel({ draft }: { draft: KekeNewsDraft | null }) {
  const [state, action] = useActionState<FormState, FormData>(decideKekeNews, {})
  if (!draft) {
    return <p className="mt-2 text-sm text-muted">No draft yet today. Keke drafts the news at 05:30, Nigerian time.</p>
  }
  return (
    <form action={action} className="mt-2 flex flex-col gap-4">
      <input type="hidden" name="day" value={draft.day} />
      <input type="hidden" name="count" value={draft.stories.length} />
      <p className="text-sm text-muted">
        {STATUS[draft.status]} From {draft.items} headlines by {draft.outlets} outlets.
        {draft.decidedAt ? ' A site moderator has decided on it.' : ''}
      </p>
      {draft.stories.length > 0 ? (
        <ol className="flex flex-col gap-4">
          {draft.stories.map((story, i) => (
            <li key={i} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name={`keep_${i}`} defaultChecked disabled={!draft.open} />
                Story {i + 1}: keep
              </label>
              <label htmlFor={`keke-news-${i}`} className="sr-only">
                Sentence for story {i + 1}
              </label>
              <textarea id={`keke-news-${i}`} name={`sentence_${i}`} defaultValue={story.sentence} rows={2} maxLength={280} readOnly={!draft.open} className="field" />
              <p className="text-xs text-muted">
                Carried by {story.outlets.map((o) => o.name).join(', ')}.{' '}
                <a href={story.link} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-accent-strong hover:underline">
                  The link posted with it
                </a>
              </p>
              <ul className="text-xs text-muted">
                {story.outlets.map((o) => (
                  <li key={o.id}>
                    {o.name}: <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">{o.title}</a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
      {draft.open ? (
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="decision" value="approve" className="btn btn-primary btn-sm">Approve</SubmitButton>
          <SubmitButton name="decision" value="skip" className="btn btn-secondary btn-sm">Skip today</SubmitButton>
        </div>
      ) : null}
      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
    </form>
  )
}
