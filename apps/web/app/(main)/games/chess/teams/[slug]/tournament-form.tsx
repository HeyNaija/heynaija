'use client'

import { useActionState, useState } from 'react'
import { SubmitButton } from '@/app/ui/submit-button'
import type { ChessTeam } from '@/lib/api'
import { createTournament, type TournamentFormState } from './actions'

const SPEED: Record<string, string> = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' }

/**
 * Making a tournament for the community's Lichess team. Only what Lichess accepts
 * is offered: the clocks HeyNaija allows, and for an Arena the lengths Lichess
 * allows for that clock. The start is a Lagos time.
 */
export function TournamentForm({ slug, controls, swissRounds, earliest }: { slug: string; controls: ChessTeam['controls']; swissRounds: ChessTeam['swissRounds']; earliest: string }) {
  const [state, action] = useActionState<TournamentFormState, FormData>(createTournament, {})
  const [kind, setKind] = useState<'arena' | 'swiss'>('arena')
  const [control, setControl] = useState(controls[0]?.id ?? '')
  const lengths = controls.find((c) => c.id === control)?.arenaMinutes ?? []
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Name</span>
        <input name="name" className="field" required minLength={2} maxLength={30} placeholder="Friday Night Blitz" />
        <span className="text-xs text-muted">Up to 30 characters. Lichess adds “Arena” or “Swiss” to it.</span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="field-label">Kind</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="kind" value="arena" checked={kind === 'arena'} onChange={() => setKind('arena')} className="mt-1" />
          <span>
            <span className="font-semibold">Arena</span>: play as many games as you can before time runs out. Join and leave any time.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="kind" value="swiss" checked={kind === 'swiss'} onChange={() => setKind('swiss')} className="mt-1" />
          <span>
            <span className="font-semibold">Swiss</span>: a set number of rounds, each against someone on a similar score.
          </span>
        </label>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Time control</span>
        <select name="timeControl" className="field" value={control} onChange={(e) => setControl(e.target.value)}>
          {controls.map((c) => (
            <option key={c.id} value={c.id}>
              {SPEED[c.speed] ?? c.speed} {c.id}
            </option>
          ))}
        </select>
      </label>
      {kind === 'arena' ? (
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Length</span>
          <select key={control} name="minutes" className="field" defaultValue={lengths.includes(60) ? 60 : lengths[0]}>
            {lengths.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Rounds</span>
          <input name="rounds" type="number" className="field" min={swissRounds.min} max={swissRounds.max} defaultValue={5} required />
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Starts (Lagos time)</span>
        <input name="startsAt" type="datetime-local" className="field" min={earliest} required />
        <span className="text-xs text-muted">At least 10 minutes from now, so people can join.</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="rated" value="yes" defaultChecked />
        Rated: the games change Lichess ratings
      </label>
      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
      <div>
        <SubmitButton className="btn btn-primary">Make the tournament on Lichess</SubmitButton>
      </div>
    </form>
  )
}
