'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { type IdeaFormState, sendIdea } from '@/app/idea-actions'
import type { IdeaKind, IdeaSummary } from '@/lib/api'
import { IDEA_TITLE_MAX, KIND_LABELS, OPEN_STATUSES, STATUS_LABELS } from '@/lib/ideas'

const POST_MAX = 300
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null
// As the API counts: an emoji or an accented letter is one.
const length = (text: string) => (segmenter ? [...segmenter.segment(text)].length : text.length)

/** Ideas already on the board with words like the title being typed, so the same one is not sent twice. */
function useSimilar(title: string): IdeaSummary[] {
  const [found, setFound] = useState<IdeaSummary[]>([])
  useEffect(() => {
    const q = title.trim()
    if (q.length < 3) {
      setFound([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/v1/ideas/similar?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : []))
        .then((ideas: IdeaSummary[]) => setFound(ideas))
        .catch(() => {})
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [title])
  return found
}

/**
 * Suggest an idea or report a problem. The title is the post's first line; the
 * details follow it. A problem also carries the page it was reported from and the
 * browser, which only the reporter and the board's moderators see.
 */
export function IdeaForm({ kind: first, from }: { kind: IdeaKind; from: string | null }) {
  const [state, action, pending] = useActionState<IdeaFormState, FormData>(sendIdea, {})
  const [kind, setKind] = useState<IdeaKind>(first)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [browser, setBrowser] = useState('')
  useEffect(() => setBrowser(navigator.userAgent), [])
  const similar = useSimilar(title)
  const left = POST_MAX - length(title.trim()) - (details.trim() ? length(details.trim()) + 2 : 0)

  return (
    <form action={action} className="content-panel flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="field-label">What are you sending?</legend>
        <div className="board-filter-group" role="presentation">
          {(['idea', 'problem'] as const).map((k) => (
            <label key={k} className="board-choice">
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {k === 'idea' ? 'An idea for HeyNaija' : 'A problem with HeyNaija'}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="idea-title" className="field-label">
          {kind === 'idea' ? 'Your idea, in a line' : 'What went wrong, in a line'}
        </label>
        <input
          id="idea-title"
          name="title"
          required
          autoComplete="off"
          maxLength={IDEA_TITLE_MAX * 4}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="field"
          aria-describedby="idea-title-count"
        />
        <p id="idea-title-count" className="field-hint">
          {length(title.trim())} of {IDEA_TITLE_MAX} characters
        </p>
        {similar.length ? (
          <section className="idea-similar" aria-labelledby="idea-similar-title">
            <h2 id="idea-similar-title" className="text-sm font-semibold">Already on the board</h2>
            <p className="field-hint">If one of these is yours, vote for it instead: votes show what matters most.</p>
            <ul>
              {similar.map((idea) => (
                <li key={idea.id}>
                  <Link href={`/p/${idea.id}`} className="font-semibold text-accent-strong hover:underline">
                    {idea.title}
                  </Link>
                  <span className="text-muted">
                    {' '}· {KIND_LABELS[idea.kind]} · {STATUS_LABELS[idea.status]} · {idea.votes === 1 ? '1 vote' : `${idea.votes} votes`}
                    {OPEN_STATUSES.includes(idea.status) ? null : ' · closed'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="idea-details" className="field-label">
          {kind === 'idea' ? 'Why it would help (optional)' : 'What you did, what you expected and what happened (optional)'}
        </label>
        <textarea
          id="idea-details"
          name="details"
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          className="field"
          aria-describedby="idea-details-count"
        />
        <p id="idea-details-count" className={`field-hint ${left < 0 ? 'text-danger' : ''}`}>
          {left < 0 ? `${-left} characters too many` : `${left} characters left`} for the title and details together
        </p>
      </div>

      {kind === 'problem' ? (
        <div className="idea-private">
          <p className="font-semibold">Sent with it, and seen only by you and Building HeyNaija’s moderators</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            <li>The page you came from: {from ?? 'none'}</li>
            <li>Your browser: {browser || 'unknown'}</li>
            <li>Which version of HeyNaija was running</li>
          </ul>
          <input type="hidden" name="page" value={from ?? ''} />
          <input type="hidden" name="browser" value={browser} />
        </div>
      ) : null}

      <p className="composer-privacy">
        Everything else is public, like any post, and goes to Building HeyNaija. Do not post security problems or anyone’s
        private details here: email <a href="mailto:contact@heynaija.ng" className="underline">contact@heynaija.ng</a> instead.
      </p>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
      <button type="submit" disabled={pending || left < 0 || !title.trim()} className="btn btn-primary self-start disabled:opacity-50">
        {pending ? 'Sending…' : kind === 'idea' ? 'Send idea' : 'Send problem report'}
      </button>
    </form>
  )
}
