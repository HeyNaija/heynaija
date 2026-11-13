'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KenoPlay as KenoPlayView, KenoTicket } from '@/lib/api'
import { plural, ticketResult } from './ticket'

// Keno, free to play (docs/adr/0028, phase 4): pick numbers, play a ticket with
// one of today's free tokens, count down to the shared draw and see it come out.

const MAX_PICKS = 10
/** After a draw's time, wait up to this long before asking, so every page does not ask in the same instant. */
const SPREAD_MS = 3_000
/** If the draw is not in yet, ask again after this long. */
const RETRY_MS = 5_000
/** One number comes out every this long, unless the member prefers less motion. */
const REVEAL_STEP_MS = 160

const ERRORS: Record<string, string> = {
  invalid: 'Pick 1 to 10 different numbers from 1 to 80.',
  rate_limited: 'That was a lot of tickets in a short time. Wait a moment.',
  failed: 'The ticket could not be played. Try again in a moment.',
}

const randomPicks = (count: number): number[] => {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1)
  const picks: number[] = []
  const random = new Uint32Array(count)
  crypto.getRandomValues(random)
  for (let i = 0; i < count; i++) picks.push(pool.splice(random[i]! % pool.length, 1)[0]!)
  return picks.sort((a, b) => a - b)
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}


export function KenoPlay({ initial }: { initial: KenoPlayView }) {
  const [play, setPlay] = useState(initial)
  const [picks, setPicks] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // How many of the last draw's numbers are showing: all of them for a draw already out when the page opened.
  const [shown, setShown] = useState(initial.last?.numbers?.length ?? 0)
  const [announce, setAnnounce] = useState('')
  // The server's clock less this one's, so the countdown is the server's.
  const offset = useRef(Date.parse(initial.serverTime) - Date.now())
  const [now, setNow] = useState(() => Date.now() + offset.current)

  const load = useCallback(async (): Promise<KenoPlayView | null> => {
    const res = await fetch('/api/v1/games/keno/round', { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) return null
    const next = (await res.json()) as KenoPlayView
    offset.current = Date.parse(next.serverTime) - Date.now()
    return next
  }, [])

  // The countdown, once a second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1000)
    return () => clearInterval(timer)
  }, [])

  // At the draw's time, ask for it, spread over a few seconds; again if it is not out yet.
  const drawsAt = Date.parse(play.open.drawsAt)
  const lastNumber = play.last?.number ?? 0
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let stopped = false
    const ask = async () => {
      const next = await load()
      if (stopped) return
      if (next && (next.last?.number ?? 0) > lastNumber) {
        setShown(0)
        setPlay(next)
      } else {
        timer = setTimeout(ask, RETRY_MS)
      }
    }
    const wait = Math.max(0, drawsAt - (Date.now() + offset.current)) + Math.random() * SPREAD_MS
    timer = setTimeout(ask, wait)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [drawsAt, lastNumber, load])

  // A new draw comes out one number at a time, then the member's results are read out.
  const drawn = play.last?.numbers ?? []
  useEffect(() => {
    if (shown >= drawn.length) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => setShown(reduce ? drawn.length : shown + 1), reduce ? 0 : REVEAL_STEP_MS)
    return () => clearTimeout(timer)
  }, [shown, drawn.length])
  const revealed = shown >= drawn.length
  useEffect(() => {
    if (!revealed || !play.last) return
    const mine = play.lastTickets.map(ticketResult)
    setAnnounce(`Round ${play.last.number} is drawn.${mine.length ? ` ${mine.join('. ')}.` : ''}`)
  }, [revealed, play.last, play.lastTickets])

  const toggle = (n: number) => {
    setError(null)
    setNotice(null)
    setPicks((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length < MAX_PICKS ? [...p, n].sort((a, b) => a - b) : p))
  }

  const submit = async () => {
    if (!picks.length || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = await fetch('/api/v1/games/keno/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ numbers: picks }),
    }).catch(() => null)
    if (res?.ok) {
      const ticket = (await res.json()) as KenoTicket
      setPicks([])
      setNotice(`Ticket played for Round #${ticket.round}.`)
      const next = await load()
      if (next) setPlay((p) => ({ ...next, last: p.last?.number === next.last?.number ? p.last : next.last }))
    } else {
      const body = res ? ((await res.json().catch(() => null)) as { code?: string; message?: string | { code?: string; message?: string } } | null) : null
      const code = res?.status === 429 ? 'rate_limited' : typeof body?.message === 'object' ? body.message.code : body?.code
      const message = typeof body?.message === 'object' ? body.message.message : undefined
      setError(code === 'no_tokens' && message ? message : ERRORS[code ?? 'failed'] ?? ERRORS.failed!)
    }
    setBusy(false)
  }

  const closesIn = Date.parse(play.open.closesAt) - now
  const drawsIn = drawsAt - now
  const { tokens } = play
  const lastDrawn = new Set(drawn.slice(0, shown))

  return (
    <>
      <section className="content-panel" aria-labelledby="keno-next">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="keno-next" className="section-title">
            Round #{play.open.number}
          </h2>
          <p className="text-sm text-muted" aria-live="off">
            {drawsIn > 0 ? (
              <>
                Next draw in <strong className="keno-clock">{clock(drawsIn)}</strong>
              </>
            ) : (
              'Drawing now…'
            )}
          </p>
        </div>
        <p className="mt-1 text-sm text-muted">
          {closesIn > 0 ? `Tickets close ${clock(closesIn)} from now, 15 seconds before the draw.` : 'Tickets now go into the round after this one.'}{' '}
          <span className="keno-hash" title={play.open.seedHash}>
            Fairness hash: <code>{play.open.seedHash.slice(0, 12)}…</code>
          </span>{' '}
          <Link href={`/games/keno/rounds/${play.open.number}`} className="underline">
            What is this?
          </Link>
        </p>

        <div className="keno-picker" role="group" aria-label="Pick 1 to 10 numbers">
          {Array.from({ length: 80 }, (_, i) => i + 1).map((n) => {
            const on = picks.includes(n)
            return (
              <button key={n} type="button" className="keno-num" aria-pressed={on} disabled={!on && picks.length >= MAX_PICKS} onClick={() => toggle(n)}>
                {n}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" disabled={!picks.length || busy || tokens.left < 1} onClick={submit}>
            {picks.length ? `Play ${plural(picks.length, 'number')} · 1 token` : 'Pick numbers to play'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setPicks(randomPicks(picks.length || 5))}>
            Quick pick
          </button>
          <button type="button" className="btn btn-ghost" disabled={!picks.length} onClick={() => setPicks([])}>
            Clear
          </button>
        </div>
        <p className="mt-2 text-sm" aria-live="polite">
          <span className={tokens.left ? 'text-muted' : 'font-semibold'}>
            {tokens.left} of {tokens.daily} tokens left today
          </span>
          {tokens.left ? '' : '. More at midnight.'}
          {picks.length ? <span className="text-muted"> · {picks.length} of 10 picked</span> : null}
        </p>
        {error ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
        {play.openTickets.length ? <TicketList title={`Your tickets for Round #${play.open.number}`} tickets={play.openTickets} drawn={null} /> : null}
      </section>

      <section className="content-panel" aria-labelledby="keno-last">
        <h2 id="keno-last" className="section-title">
          {play.last ? `Last draw: Round #${play.last.number}` : 'Last draw'}
        </h2>
        {play.last ? (
          <>
            <ol className="keno-drawn" aria-label={`The 20 numbers drawn in Round ${play.last.number}`}>
              {drawn.map((n, i) => (
                <li key={n} className="keno-ball" data-shown={i < shown} data-hit={play.lastTickets.some((t) => t.numbers.includes(n)) || undefined}>
                  {n}
                </li>
              ))}
            </ol>
            {play.last.late ? <p className="mt-2 text-sm text-muted">Drawn late: the draw was missed at its time and made as soon as it could be.</p> : null}
            {revealed && play.lastTickets.length ? <TicketList title="Your tickets in it" tickets={play.lastTickets} drawn={lastDrawn} /> : null}
            <p className="mt-2 text-sm">
              <Link href={`/games/keno/rounds/${play.last.number}`} className="underline">
                Check this draw was fair
              </Link>
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">No draws yet. The first comes out when the countdown ends.</p>
        )}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </section>
    </>
  )
}

function TicketList({ title, tickets, drawn }: { title: string; tickets: KenoTicket[]; drawn: Set<number> | null }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="keno-tickets">
        {tickets.map((t) => (
          <li key={t.id}>
            <TicketNumbers numbers={t.numbers} drawn={drawn} />
            <span className="text-sm text-muted">{ticketResult(t)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A ticket's numbers, the drawn ones marked (in words for screen readers too). */
function TicketNumbers({ numbers, drawn }: { numbers: number[]; drawn: Set<number> | null }) {
  return (
    <span className="keno-ticket-numbers">
      {numbers.map((n) => {
        const hit = drawn?.has(n)
        return (
          <span key={n} className="keno-chip" data-hit={hit || undefined}>
            {n}
            {hit ? <span className="sr-only"> (drawn)</span> : null}
          </span>
        )
      })}
    </span>
  )
}

