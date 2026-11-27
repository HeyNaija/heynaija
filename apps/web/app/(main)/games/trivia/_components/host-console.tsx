'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LocalTime } from '@/app/ui/local-time'
import type { TriviaHostQuestion, TriviaHostView, TriviaRound } from '@/lib/api'
import { type FileQuestion, triviaFileName, writeTriviaFile } from '@/lib/trivia-file'
import { TRIVIA_STATUS } from './bits'
import { triviaCall } from './call'
import { saveJsonFile } from './save-file'

const RETRY_MAX_MS = 30_000

/**
 * The host's console (docs/adr/0028, phase 7): put the round on the schedule, open
 * each question, end early, accept spellings the checker missed, cancel a bad
 * question, and publish the results. It wakes on the same long-poll players use.
 */
export function HostConsole({ initial }: { initial: TriviaHostView }) {
  const [round, setRound] = useState(initial)
  const [offset, setOffset] = useState(() => Date.parse(initial.serverTime) - Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState<string | null>(null)
  const latest = useRef(round)
  latest.current = round

  const reload = useCallback(async () => {
    const res = await triviaCall<TriviaHostView>(`/rounds/${latest.current.id}/host`, 'GET')
    if (res.ok) {
      setRound(res.body)
      setOffset(Date.parse(res.body.serverTime) - Date.now())
    }
  }, [])

  // Wakes whenever the round changes, or a question appears or closes.
  useEffect(() => {
    let stopped = false
    let failures = 0
    let controller: AbortController | null = null
    let version = latest.current.version
    const over = () => latest.current.status === 'published' || latest.current.status === 'cancelled'
    const loop = async () => {
      while (!stopped && !over()) {
        if (document.visibilityState !== 'visible') return
        controller = new AbortController()
        const res = await fetch(`/api/v1/games/trivia/rounds/${latest.current.id}?after=${version}`, { cache: 'no-store', signal: controller.signal }).catch(() => null)
        if (stopped) return
        if (res?.ok) {
          failures = 0
          const view = (await res.json()) as TriviaRound
          version = view.version
          await reload()
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
  }, [reload])

  const running = round.questions.find((q) => q.opensAt && !q.judged && !q.voided)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [running])
  // Answers do not wake the long-poll (players learn nothing until time is up), so the host's count is read every few seconds.
  const runningId = running?.id
  useEffect(() => {
    if (!runningId) return
    const timer = setInterval(() => void reload(), 3000)
    return () => clearInterval(timer)
  }, [runningId, reload])

  const act = async (key: string, path: string, body?: object) => {
    setBusy(key)
    setError(null)
    setConfirming(null)
    const res = await triviaCall(path, 'POST', body)
    setBusy(null)
    if (!res.ok) setError(res.message)
    await reload()
  }

  const id = round.id
  const next = round.questions.find((q) => !q.opensAt && !q.voided)
  const asked = round.questions.filter((q) => q.opensAt || q.judged).length
  const serverNow = now + offset
  const editable = (round.status === 'draft' || round.status === 'scheduled') && round.questions.every((q) => !q.opensAt)

  /** The round's questions as a file to import into another round; accepted spellings included. */
  const download = () => {
    const questions = round.questions.map((q): FileQuestion =>
      q.kind === 'choice'
        ? { kind: 'choice', prompt: q.prompt, choices: q.choices ?? [], correctChoice: q.correctChoice ?? 0, explanation: q.explanation ?? '' }
        : { kind: 'typed', prompt: q.prompt, accepted: q.accepted ?? [], explanation: q.explanation ?? '' },
    )
    const name = triviaFileName(round.title)
    saveJsonFile(name, writeTriviaFile(round.title, questions))
    setDownloaded(
      round.questions.some((q) => q.image)
        ? `Downloaded ${name}. Pictures are not in the file. Add them again after you import it.`
        : `Downloaded ${name}. Import it from the form when you host another round.`,
    )
  }

  const confirm = (key: string, label: string, run: () => void, tone: 'btn-secondary' | 'btn-primary' = 'btn-secondary') =>
    confirming === key ? (
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={run}>Yes, {label.toLowerCase()}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(null)}>Keep it</button>
      </span>
    ) : (
      <button type="button" className={`btn ${tone} btn-sm`} disabled={busy !== null} onClick={() => setConfirming(key)}>{label}</button>
    )

  return (
    <div className="flex flex-col gap-4">
      <section className="content-panel flex flex-col gap-3" aria-labelledby="console-state">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="console-state" className="section-title">{TRIVIA_STATUS[round.status]}</h2>
          <span className="text-sm text-muted">
            · <LocalTime at={round.startsAt} as="posted" /> · {round.secondsPerQuestion} s a question · {asked} of {round.questions.length} asked
            {round.community ? ` · ${round.community.name}` : ' · Game Night'}
          </span>
        </div>

        {running ? <RunningLine q={running} serverNow={serverNow} /> : null}

        <div className="flex flex-wrap gap-2">
          {round.status === 'draft' ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void act('publish', `/rounds/${id}/publish`)}>
                Put it on the schedule
              </button>
              {confirm('cancel', 'Delete draft', () => void act('cancel', `/rounds/${id}/cancel`))}
            </>
          ) : null}
          {(round.status === 'scheduled' || round.status === 'live') && next && !running ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void act('open', `/rounds/${id}/open`)}>
              {asked === 0 ? 'Start: open question 1' : `Open question ${next.position}`}
            </button>
          ) : null}
          {editable ? <Link href={`/games/trivia/rounds/${id}/edit`} className="btn btn-secondary btn-sm">Edit</Link> : null}
          {round.status === 'scheduled' ? confirm('cancel', 'Call it off', () => void act('cancel', `/rounds/${id}/cancel`)) : null}
          {round.status === 'live' ? confirm('end', 'End the round', () => void act('end', `/rounds/${id}/end`)) : null}
          {round.status === 'reviewing'
            ? confirm('results', 'Publish the results', () => void act('results', `/rounds/${id}/results`), 'btn-primary')
            : null}
          {round.status !== 'draft' ? <Link href={`/games/trivia/rounds/${id}`} className="btn btn-secondary btn-sm">Players’ view</Link> : null}
          {round.threadPostId ? <Link href={`/p/${round.threadPostId}`} className="btn btn-secondary btn-sm">The thread</Link> : null}
          <button type="button" className="btn btn-secondary btn-sm" onClick={download}>Download questions</button>
        </div>

        {round.status === 'draft' ? (
          <p className="text-sm text-muted">Only you can see this draft. Putting it on the schedule has The Arbiter post it, with a link to play.</p>
        ) : round.status === 'scheduled' ? (
          <p className="text-sm text-muted">Open the first question when you are ready; players see a 3-second countdown, then the question.</p>
        ) : round.status === 'live' && round.autoAdvance ? (
          <p className="text-sm text-muted">The round goes on by itself: each question opens 8 seconds after the last answer is shown.</p>
        ) : round.status === 'reviewing' && round.publishesAt ? (
          <p className="text-sm text-muted">
            Check the typed answers below: accept any spelling that should count, or cancel a bad question. The results publish
            themselves <LocalTime at={round.publishesAt} as="posted" /> if you have not.
          </p>
        ) : null}
        {downloaded ? <p className="text-sm text-muted" role="status">{downloaded}</p> : null}
        {error ? (
          <p className="text-sm text-danger" role="alert">{error}</p>
        ) : null}
      </section>

      <ol className="flex flex-col gap-3" aria-label="Questions">
        {round.questions.map((q) => (
          <QuestionRow
            key={q.id}
            q={q}
            serverNow={serverNow}
            canChange={round.status === 'live' || round.status === 'reviewing'}
            busy={busy}
            onVoid={() => void act(`void-${q.id}`, `/rounds/${id}/questions/${q.id}/void`)}
            onAccept={(normalised) => void act(`accept-${q.id}-${normalised}`, `/rounds/${id}/questions/${q.id}/accept`, { answer: normalised })}
          />
        ))}
      </ol>
    </div>
  )
}

function RunningLine({ q, serverNow }: { q: TriviaHostQuestion; serverNow: number }) {
  const opensIn = Date.parse(q.opensAt!) - serverNow
  const closesIn = Date.parse(q.closesAt!) - serverNow
  return (
    <p className="trivia-big" role="status">
      Question {q.position}:{' '}
      {opensIn > 0 ? `appears in ${Math.ceil(opensIn / 1000)} s` : closesIn > 0 ? `${Math.ceil(closesIn / 1000)} s left` : 'time is up, checking…'}
    </p>
  )
}

function QuestionRow({
  q,
  serverNow,
  canChange,
  busy,
  onVoid,
  onAccept,
}: {
  q: TriviaHostQuestion
  serverNow: number
  canChange: boolean
  busy: string | null
  onVoid: () => void
  onAccept: (normalised: string) => void
}) {
  const [sure, setSure] = useState(false)
  const state = q.voided
    ? 'Cancelled'
    : q.judged
      ? `${q.rightCount} of ${q.answered} right`
      : q.opensAt
        ? Date.parse(q.opensAt) > serverNow
          ? 'Counting down'
          : `Open · ${q.answered} answered`
        : 'Not asked yet'
  const answer = q.kind === 'choice' ? (q.choices?.[q.correctChoice ?? -1] ?? '') : (q.accepted ?? []).join(' · ')
  return (
    <li className="content-panel flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Q{q.position}</span>
        <span className="chip">{state}</span>
        <span className="text-xs text-muted">{q.kind === 'choice' ? 'Choices' : 'Typed'}</span>
      </div>
      <p className="text-[15px]">{q.prompt}</p>
      {q.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- already resized
        <img className="trivia-picture-thumb" src={`${q.image.src}/640.webp`} alt={q.image.alt} width={q.image.width ?? undefined} height={q.image.height ?? undefined} loading="lazy" />
      ) : null}
      {q.kind === 'choice' ? (
        <p className="text-sm text-muted">
          {(q.choices ?? []).map((c, i) => (
            <span key={i} className={i === q.correctChoice ? 'font-semibold text-[var(--ink)]' : undefined}>
              {i ? ' · ' : ''}
              {c}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-sm text-muted">Accepted: <span className="text-[var(--ink)]">{answer}</span></p>
      )}
      {q.wrong.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted">Wrong answers, as the checker read them</p>
          <ul className="flex flex-col">
            {q.wrong.map((w) => (
              <li key={w.normalised} className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">“{w.sample}”</span>
                <span className="text-muted">
                  {w.count}
                  {w.fast ? ` · ${w.fast} within 0.6 s` : ''}
                </span>
                {canChange && !q.voided ? (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => onAccept(w.normalised)}>
                    Accept
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {canChange && !q.voided && (q.opensAt || q.judged) ? (
        sure ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            Nobody scores from a cancelled question.
            <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => { setSure(false); onVoid() }}>
              Yes, cancel Q{q.position}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSure(false)}>Keep it</button>
          </span>
        ) : (
          <span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => setSure(true)}>
              Cancel this question
            </button>
          </span>
        )
      ) : null}
    </li>
  )
}
