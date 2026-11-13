'use client'

import { useState } from 'react'

type Outcome = { hashMatches: boolean; numbersMatch: boolean }

/** "Check this round": the seed's hash and numbers worked out here, in this browser, and compared. */
export function RoundCheck({ round }: { round: { number: number; seedHash: string; seed: string; numbers: number[] } }) {
  const [outcome, setOutcome] = useState<Outcome | 'checking' | 'failed' | null>(null)

  const check = async () => {
    setOutcome('checking')
    try {
      // Only this page needs it, so it loads when asked.
      const { checkRound } = await import('./fair')
      setOutcome(await checkRound(round))
    } catch {
      setOutcome('failed')
    }
  }

  const fair = typeof outcome === 'object' && outcome?.hashMatches && outcome.numbersMatch
  return (
    <div className="mt-3">
      <button type="button" className="btn btn-primary" onClick={check} disabled={outcome === 'checking'}>
        Check this round
      </button>
      <p className="mt-2 text-sm" role="status">
        {outcome === 'checking' ? 'Checking…' : null}
        {outcome === 'failed' ? 'This browser could not run the check. Use the command below instead.' : null}
        {typeof outcome === 'object' && outcome ? (
          fair ? (
            <strong className="text-accent">Matches: the seed gives the published hash, and exactly these numbers in this order.</strong>
          ) : (
            <strong className="text-danger">
              Does not match: {outcome.hashMatches ? 'the hash matches' : 'the seed does not give the published hash'}, and{' '}
              {outcome.numbersMatch ? 'the numbers match' : 'the numbers are not the ones the seed gives'}.
            </strong>
          )
        ) : null}
      </p>
    </div>
  )
}
