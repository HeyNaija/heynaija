'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { triviaCall } from './call'
import { blankQuestion, type QuestionDraft, type RoundDraft } from './round-draft'

// A host writes a round (docs/adr/0028, phase 7): its title, when, where The
// Arbiter posts it, and its questions. The API checks everything again.

const MAX_QUESTIONS = 30

export function RoundForm({ defaults, communities }: { defaults: RoundDraft; communities: { slug: string; name: string }[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState(defaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof RoundDraft>(key: K, value: RoundDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const setQuestion = (i: number, change: Partial<QuestionDraft>) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...change } : q)) }))
  const move = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const qs = [...d.questions]
      const j = i + by
      if (j < 0 || j >= qs.length) return d
      ;[qs[i], qs[j]] = [qs[j]!, qs[i]!]
      return { ...d, questions: qs }
    })
  const remove = (i: number) => setDraft((d) => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = {
      title: draft.title,
      community: draft.community || null,
      startsAt: `${draft.startsAt}:00+01:00`,
      secondsPerQuestion: draft.secondsPerQuestion,
      autoAdvance: draft.autoAdvance,
      questions: draft.questions.map((q) => {
        if (q.kind === 'typed') {
          return { kind: 'typed', prompt: q.prompt, accepted: q.accepted.split('\n').map((a) => a.trim()).filter(Boolean), explanation: q.explanation || null }
        }
        // Empty choice boxes are left out, and the right one keeps its place among those left.
        const kept = q.choices.map((text, i) => ({ text: text.trim(), i })).filter((c) => c.text)
        return {
          kind: 'choice',
          prompt: q.prompt,
          choices: kept.map((c) => c.text),
          correctChoice: kept.findIndex((c) => c.i === q.correctChoice),
          explanation: q.explanation || null,
        }
      }),
    }
    const res = draft.id ? await triviaCall(`/rounds/${draft.id}`, 'PUT', body) : await triviaCall<{ id: string }>('/rounds', 'POST', body)
    if (!res.ok) {
      setBusy(false)
      setError(res.message)
      return
    }
    const id = draft.id ?? (res.body as { id: string }).id
    router.push(`/games/trivia/rounds/${id}/host`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Title</span>
        <input className="field" required minLength={3} maxLength={80} value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Anime Trivia Night" />
      </label>
      <div className="competition-times">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Starts (Lagos time)</span>
          <input type="datetime-local" className="field" required value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Seconds a question</span>
          <input
            type="number"
            className="field"
            required
            min={10}
            max={60}
            value={draft.secondsPerQuestion}
            onChange={(e) => set('secondsPerQuestion', Number(e.target.value))}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Posted in</span>
        <select className="field" value={draft.community} onChange={(e) => set('community', e.target.value)}>
          <option value="">Game Night</option>
          {communities.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <span className="field-hint">The Arbiter posts the round’s thread, each answer and the results there.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={draft.autoAdvance} onChange={(e) => set('autoAdvance', e.target.checked)} />
        <span>
          Go on by itself: after each answer is shown, the next question opens 8 seconds later. Otherwise you open each one.
        </span>
      </label>

      <ol className="flex flex-col gap-3">
        {draft.questions.map((q, i) => (
          <li key={i} className="trivia-edit">
            <fieldset className="flex flex-col gap-3">
              <legend className="field-label">Question {i + 1}</legend>
              <div className="flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={`Question ${i + 1}: how it is answered`}>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={q.kind === 'choice'} onChange={() => setQuestion(i, { kind: 'choice' })} /> Choices
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={q.kind === 'typed'} onChange={() => setQuestion(i, { kind: 'typed' })} /> Typed answer
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="sr-only">Question {i + 1}</span>
                <textarea className="field" rows={2} required maxLength={300} value={q.prompt} onChange={(e) => setQuestion(i, { prompt: e.target.value })} placeholder="Who wrote the first name in the Death Note?" />
              </label>
              {q.kind === 'choice' ? (
                <div className="flex flex-col gap-2">
                  <span className="field-hint">Two to four choices. Pick the right one.</span>
                  {q.choices.map((c, k) => (
                    <div key={k} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`right-${i}`}
                        aria-label={`Choice ${k + 1} is right`}
                        checked={q.correctChoice === k}
                        onChange={() => setQuestion(i, { correctChoice: k })}
                      />
                      <input
                        className="field flex-1"
                        maxLength={80}
                        required={k < 2}
                        value={c}
                        aria-label={`Choice ${k + 1}`}
                        onChange={(e) => setQuestion(i, { choices: q.choices.map((x, m) => (m === k ? e.target.value : x)) })}
                        placeholder={k < 2 ? `Choice ${k + 1}` : `Choice ${k + 1} (optional)`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className="field-hint">Accepted answers, one a line. Capitals, accents, spaces and small typos in longer answers are forgiven already.</span>
                  <textarea className="field" rows={3} required value={q.accepted} onChange={(e) => setQuestion(i, { accepted: e.target.value })} placeholder={'Attack on Titan\nShingeki no Kyojin'} />
                </label>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="field-hint">A note shown with the answer (optional)</span>
                <input className="field" maxLength={300} value={q.explanation} onChange={(e) => setQuestion(i, { explanation: e.target.value })} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>Move up</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => move(i, 1)} disabled={i === draft.questions.length - 1}>Move down</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(i)} disabled={draft.questions.length === 1}>Remove</button>
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" disabled={draft.questions.length >= MAX_QUESTIONS} onClick={() => set('questions', [...draft.questions, blankQuestion('choice')])}>
          Add a choices question
        </button>
        <button type="button" className="btn btn-secondary" disabled={draft.questions.length >= MAX_QUESTIONS} onClick={() => set('questions', [...draft.questions, blankQuestion('typed')])}>
          Add a typed question
        </button>
      </div>
      <p className="text-xs text-muted">
        Saving keeps it as a draft only you see. Put it on the schedule from your console: The Arbiter then posts it. A round
        cannot change once its first question has opened.
      </p>
      {error ? (
        <p className="text-sm text-danger" role="alert">{error}</p>
      ) : null}
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>{draft.id ? 'Save changes' : 'Save draft'}</button>
      </div>
    </form>
  )
}
