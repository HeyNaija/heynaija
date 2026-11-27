'use client'

import Link from 'next/link'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { LocalTime } from '@/app/ui/local-time'
import type { TriviaReveal, TriviaRound as Round } from '@/lib/api'
import { nameOf, ordinal, QuestionPicture, secondsLabel, Standings } from './bits'
import { triviaCall } from './call'

/** After a failed request the page waits a little longer each time, up to this. */
const RETRY_MAX_MS = 30_000

/**
 * A round as a player sees it (docs/adr/0028, phase 7). The page asks the API for
 * the next change and the API answers when there is one: a question about to
 * appear, appearing, closing, or the round moving on. Times are counted on the
 * server's clock, so every screen shows a question at the same moment.
 */
export function TriviaRound({ initial }: { initial: Round }) {
  const [round, setRound] = useState(initial)
  // The server's clock minus this browser's, from the last answer.
  const [offset, setOffset] = useState(() => Date.parse(initial.serverTime) - Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [said, setSaid] = useState('')
  const latest = useRef(round)
  latest.current = round

  const take = (next: Round) => {
    setOffset(Date.parse(next.serverTime) - Date.now())
    if (next.version !== latest.current.version || next.current?.prompt !== latest.current.current?.prompt) setRound(next)
  }

  // Waits for each change, for as long as the round goes on and the page is in view.
  useEffect(() => {
    let stopped = false
    let failures = 0
    let controller: AbortController | null = null
    const over = () => latest.current.status === 'published' || latest.current.status === 'cancelled'
    // The Arbiter's results post is written a moment after the results: once they are out, look again a few times for it.
    let lookedForPost = 0
    const loop = async () => {
      while (!stopped) {
        if (over()) {
          if (latest.current.status !== 'published' || latest.current.resultPostId || lookedForPost >= 3) return
          lookedForPost += 1
          await new Promise((done) => setTimeout(done, 2000))
          const res = await fetch(`/api/v1/games/trivia/rounds/${latest.current.id}`, { cache: 'no-store' }).catch(() => null)
          if (stopped) return
          if (res?.ok) take((await res.json()) as Round)
          continue
        }
        if (document.visibilityState !== 'visible') return
        controller = new AbortController()
        // `has`: the open question on screen, so one that opened while this request was on its way comes back at once.
        const showing = latest.current.current?.prompt ? latest.current.current.id : ''
        const res = await fetch(`/api/v1/games/trivia/rounds/${latest.current.id}?after=${latest.current.version}&has=${encodeURIComponent(showing)}`, {
          cache: 'no-store',
          signal: controller.signal,
        }).catch(() => null)
        if (stopped) return
        if (res?.ok) {
          failures = 0
          take((await res.json()) as Round)
          continue
        }
        if (res?.status === 404) return
        failures += 1
        await new Promise((done) => setTimeout(done, Math.min(1000 * 2 ** failures, RETRY_MAX_MS)))
      }
    }
    void loop()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loop()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The countdown and the time left run here between the API's answers.
  const current = round.current
  useEffect(() => {
    if (!current) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [current])

  // What changed, said for screen readers.
  useEffect(() => {
    if (current?.prompt) setSaid(`Question ${current.position}: ${current.prompt}`)
    else if (round.last && !current) setSaid(`The answer: ${round.last.answer}.`)
  }, [current, round.last])

  const serverNow = now + offset
  const opensIn = current ? Date.parse(current.opensAt) - serverNow : 0
  const closesIn = current ? Date.parse(current.closesAt) - serverNow : 0
  // The text arrives with the next answer from the API once the question opens; until then, the countdown.
  const open = current && current.prompt && opensIn <= 0 && closesIn > 0

  const setAnswer = (answer: { choice: number | null; text: string | null; ms: number }) =>
    setRound((r) => (r.current ? { ...r, current: { ...r.current, yourAnswer: answer } } : r))

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite">{said}</p>
      {!round.you.canAnswer ? (
        <p className="content-panel text-sm">
          {round.you.host ? 'You are hosting this round' : 'As a Trivia host you can see this round’s answers'}, so you watch it here
          without answering.{' '}
          <Link href={`/games/trivia/rounds/${round.id}/host`} className="font-semibold underline">
            {round.you.host ? 'Open your console' : 'Open the host’s console'}
          </Link>
        </p>
      ) : null}

      <section className="content-panel trivia-stage" aria-labelledby="trivia-now">
        <h2 id="trivia-now" className="sr-only">Now</h2>
        {round.status === 'cancelled' ? (
          <p className="text-sm">This round was called off. Nobody scores anything from it.</p>
        ) : round.status === 'scheduled' || round.status === 'draft' ? (
          <div className="flex flex-col gap-1">
            <p className="trivia-big">Starts <LocalTime at={round.startsAt} as="posted" /></p>
            <p className="text-sm text-muted">
              {round.questions} {round.questions === 1 ? 'question' : 'questions'}, {round.secondsPerQuestion} seconds each, hosted by{' '}
              {nameOf(round.host)}. Keep this page open: each question appears here when the host opens it.
            </p>
          </div>
        ) : current && !open && opensIn > 0 ? (
          <div className="flex flex-col items-center gap-1 py-4 text-center">
            <p className="text-sm text-muted">Question {current.position} of {round.questions}</p>
            <p className="trivia-countdown" aria-hidden="true">{Math.ceil(opensIn / 1000)}</p>
            <p className="text-sm text-muted">Get ready…</p>
          </div>
        ) : current && open ? (
          <Question key={current.id} round={round} closesIn={closesIn} onAnswered={setAnswer} />
        ) : current ? (
          <p className="py-4 text-center text-sm text-muted">{closesIn <= 0 ? 'Time is up. Checking the answers…' : 'Here it comes…'}</p>
        ) : round.status === 'live' ? (
          <p className="text-sm text-muted">
            {round.last ? 'Waiting for the host to open the next question.' : 'The round has started. Waiting for the host to open the first question.'}
          </p>
        ) : round.status === 'reviewing' ? (
          <p className="text-sm text-muted">
            That was the last question. The host is checking typed answers; the results are out within 15 minutes.
          </p>
        ) : (
          <p className="text-sm">
            The results are out.
            {round.yourStanding ? ` You came ${ordinal(round.yourStanding.rank)} with ${round.yourStanding.points} points.` : ''}
            {round.resultPostId ? (
              <>
                {' '}
                <Link href={`/p/${round.resultPostId}`} className="underline">The Arbiter’s post</Link>
              </>
            ) : null}
          </p>
        )}
      </section>

      {round.last && !(current && open) ? <RevealPanel reveal={round.last} total={round.questions} plays={round.you.canAnswer} /> : null}

      {round.status !== 'scheduled' && round.status !== 'draft' && round.status !== 'cancelled' ? (
        <Standings rows={round.standings} you={round.yourStanding} final={round.final} />
      ) : null}

      <p className="px-1 text-sm text-muted">
        {round.threadPostId ? (
          <>
            <Link href={`/p/${round.threadPostId}`} className="underline">Talk about it in the thread</Link> ·{' '}
          </>
        ) : null}
        <Link href="/games/trivia" className="underline">All rounds</Link>
      </p>
    </div>
  )
}

/** The question while it is open: tap a choice, or type, once. */
function Question({ round, closesIn, onAnswered }: { round: Round; closesIn: number; onAnswered: (a: { choice: number | null; text: string | null; ms: number }) => void }) {
  const q = round.current!
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mine = q.yourAnswer
  const locked = Boolean(mine) || !round.you.canAnswer || busy
  const left = Math.max(0, closesIn)
  const share = Math.min(1, left / (round.secondsPerQuestion * 1000))

  const send = async (given: { choice?: number; text?: string }) => {
    if (locked) return
    setBusy(true)
    setError(null)
    const res = await triviaCall<{ ms: number }>(`/rounds/${round.id}/questions/${q.id}/answer`, 'POST', given)
    setBusy(false)
    if (res.ok) onAnswered({ choice: given.choice ?? null, text: given.text ?? null, ms: res.body.ms })
    else setError(res.message)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) void send({ text: text.trim() })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 text-sm text-muted">
        <span>Question {q.position} of {round.questions}</span>
        <span className="trivia-left" aria-label={`${Math.ceil(left / 1000)} seconds left`}>{Math.ceil(left / 1000)} s</span>
      </div>
      <div className="trivia-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${share})` }} />
      </div>
      <p className="trivia-prompt">{q.prompt}</p>
      {q.image ? <QuestionPicture picture={q.image} live /> : null}
      {q.kind === 'choice' ? (
        <div className="trivia-choices" role="group" aria-label="Choices">
          {q.choices!.map((c) => (
            <button
              key={c.id}
              type="button"
              className="trivia-choice"
              aria-pressed={mine?.choice === c.id}
              disabled={locked && mine?.choice !== c.id}
              onClick={() => void send({ choice: c.id })}
            >
              {c.text}
            </button>
          ))}
        </div>
      ) : mine ? (
        <p className="trivia-typed">{mine.text}</p>
      ) : !round.you.canAnswer ? null : (
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="trivia-answer">Your answer</label>
          <input
            id="trivia-answer"
            className="field flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={80}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={locked}
            placeholder="Type your answer"
          />
          <button type="submit" className="btn btn-primary" disabled={locked || !text.trim()}>Answer</button>
        </form>
      )}
      {mine ? (
        <p className="text-sm text-muted" role="status">
          Answered in {secondsLabel(mine.ms)}. You see whether it was right when time is up.
        </p>
      ) : !round.you.canAnswer ? (
        <p className="text-sm text-muted">You watch without answering.</p>
      ) : null}
      {error ? (
        <p className="text-sm text-danger" role="alert">{error}</p>
      ) : null}
    </div>
  )
}

/** The last question with its answer, how many got it, and who was quickest. */
function RevealPanel({ reveal, total, plays }: { reveal: TriviaReveal; total: number; plays: boolean }) {
  const you = reveal.you
  return (
    <section className="content-panel" aria-labelledby="trivia-reveal">
      <p className="text-sm text-muted">Question {reveal.position} of {total}</p>
      <h2 id="trivia-reveal" className="trivia-prompt mt-1">{reveal.prompt}</h2>
      {reveal.image ? <div className="mt-3"><QuestionPicture picture={reveal.image} /></div> : null}
      {reveal.voided ? (
        <p className="mt-2 text-sm">The host cancelled this question. Nobody scores from it.</p>
      ) : (
        <>
          {reveal.choices ? (
            <ul className="trivia-choices mt-3" aria-label="Answers given">
              {reveal.choices.map((c) => (
                <li key={c.id} className="trivia-choice is-shown" data-right={c.right || undefined} data-yours={you?.choice === c.id || undefined}>
                  <span>{c.text}</span>
                  <span className="text-xs text-muted">{c.count} {c.right ? '· right' : ''}{you?.choice === c.id ? ' · yours' : ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm">
              Answer: <strong>{reveal.answer}</strong>
              {reveal.alsoAccepted.length ? <span className="text-muted"> (also accepted: {reveal.alsoAccepted.slice(0, 3).join(', ')})</span> : null}
            </p>
          )}
          {reveal.explanation ? <p className="mt-2 text-sm text-muted">{reveal.explanation}</p> : null}
          <p className="mt-2 text-sm">
            {you ? (
              you.correct ? (
                <strong>
                  Right{you.place && you.place <= 3 ? `, and ${ordinal(you.place)}` : ''}: +{you.points} points
                </strong>
              ) : (
                <span>Not this time{you.text ? `: you answered “${you.text}”` : ''}.</span>
              )
            ) : plays ? (
              <span className="text-muted">You did not answer this one.</span>
            ) : null}{' '}
            <span className="text-muted">
              {reveal.rightCount} of {reveal.answered} got it right.
            </span>
          </p>
          {reveal.firsts.length ? (
            <ol className="mt-2 flex flex-col gap-1 text-sm">
              {reveal.firsts.map((f, i) => (
                <li key={f.handle}>
                  {ordinal(i + 1)}: <Link href={`/u/${f.handle}`} className="hover:underline">{nameOf(f)}</Link>{' '}
                  <span className="text-muted">{secondsLabel(f.ms)}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </section>
  )
}
