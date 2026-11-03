'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { ChessTimeControl } from '@/lib/api'
import { type ChallengeFormState, sendChallenge } from '../actions'

const SPEED_NAMES = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Correspondence' } as const

const label = (tc: ChessTimeControl) =>
  tc.speed === 'correspondence' ? `${tc.days} ${tc.days === 1 ? 'day' : 'days'} a move` : `${tc.limit / 60}+${tc.increment}`

/**
 * Challenge a member who has linked Lichess. The handle field suggests such members
 * as you type (a native datalist, nothing to download); without JavaScript it is a
 * plain field, and the form still works.
 */
export function ChallengeForm({ timeControls, opponent }: { timeControls: ChessTimeControl[]; opponent?: string }) {
  const [state, action, pending] = useActionState<ChallengeFormState, FormData>(sendChallenge, {})
  const [query, setQuery] = useState(opponent ?? '')
  const [options, setOptions] = useState<{ handle: string; name: string }[]>([])
  const ask = useRef<AbortController | null>(null)

  useEffect(() => {
    const q = query.trim().replace(/^@/, '')
    if (!q) return
    const timer = setTimeout(async () => {
      ask.current?.abort()
      ask.current = new AbortController()
      const res = await fetch(`/api/v1/games/chess/opponents?q=${encodeURIComponent(q)}`, { signal: ask.current.signal }).catch(() => null)
      if (!res?.ok) return
      const { members } = (await res.json()) as { members: { handle: string; displayName: string | null; lichess: string }[] }
      setOptions(members.map((m) => ({ handle: m.handle, name: `${m.displayName ?? m.handle} · Lichess ${m.lichess}` })))
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  const groups = (['blitz', 'rapid', 'classical', 'correspondence'] as const)
    .map((speed) => ({ speed, list: timeControls.filter((tc) => tc.speed === speed) }))
    .filter((g) => g.list.length)

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Who</span>
        <input
          className="field"
          name="handle"
          list="chess-opponents"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Their handle"
          defaultValue={opponent}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={21}
          required
        />
        <datalist id="chess-opponents">
          {options.map((o) => (
            <option key={o.handle} value={o.handle}>
              {o.name}
            </option>
          ))}
        </datalist>
        <span className="field-hint">Only members who have connected a Lichess account can be challenged.</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Time</span>
          <select className="field" name="timeControl" defaultValue="10+5">
            {groups.map(({ speed, list }) => (
              <optgroup key={speed} label={SPEED_NAMES[speed]}>
                {list.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {SPEED_NAMES[speed]} {label(tc)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Game</span>
          <select className="field" name="rated" defaultValue="rated">
            <option value="rated">Rated</option>
            <option value="casual">Casual</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">You play</span>
          <select className="field" name="color" defaultValue="random">
            <option value="random">Either colour</option>
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
        </label>
      </div>

      <label className="settings-check">
        <input type="checkbox" name="openThread" defaultChecked />
        <span>Open a public thread in Chess Arena when the game starts, so members can watch and talk about it</span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Sending…' : 'Send challenge'}
        </button>
        <p role="status" className="text-sm text-muted empty:hidden">
          {state.sentTo && !pending ? `Challenge sent to @${state.sentTo}. They have been notified.` : ''}
        </p>
      </div>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
    </form>
  )
}
