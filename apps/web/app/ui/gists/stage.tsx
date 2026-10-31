'use client'

import { useEffect, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { MicOffIcon } from '@/app/ui/icons'
import { elapsedLabel } from '@/lib/gist-mic'
import { personName, type Person } from '@/lib/gists'

/** `label` is the role word; a meeting tile has none for an ordinary participant. */
export type StagePerson = Person & { label?: 'Host' | 'Co-host' | 'Speaker' }

/**
 * Who is on stage. State is never colour alone: a speaking tile has a ring and
 * the word "Speaking", a silent microphone has an icon and the word "Muted", and
 * the role is a word. Under reduced motion the ring is static (see globals.css).
 */
export function StageGrid({
  people,
  meId,
  speaking,
  mics,
  level,
  heading = 'People on stage',
}: {
  people: StagePerson[]
  meId: string
  speaking: string[]
  /** Member id to true when their microphone is live. */
  mics: Record<string, boolean>
  /** The member's own input level, 0..1. */
  level: number
  /** The list's accessible name. */
  heading?: string
}) {
  return (
    <ul className="gist-stage" aria-label={heading}>
      {people.map((p) => {
        const talking = speaking.includes(p.id) && mics[p.id] !== false
        const live = mics[p.id] === true
        const self = p.id === meId
        return (
          <li key={p.id} className={`gist-tile ${talking ? 'is-speaking' : ''}`}>
            <span className="gist-avatar">
              <Avatar handle={p.handle} size={72} />
            </span>
            <span className="gist-tile-name">
              {personName(p)}
              {self ? ' (you)' : ''}
            </span>
            <span className="gist-badges">
              {p.label === undefined ? null : p.label !== 'Speaker' ? <span className="gist-badge gist-badge-role">{p.label}</span> : <span className="gist-badge">Speaker</span>}
              {live ? null : (
                <span className="gist-badge gist-badge-muted">
                  <MicOffIcon size={12} /> Muted
                </span>
              )}
              {talking ? (
                <span className="gist-badge gist-badge-speaking" aria-hidden="true">
                  Speaking
                </span>
              ) : null}
            </span>
            {self && live ? <LevelMeter level={level} /> : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A bar for the member's own input level. Purely visual: it changes many times a second, so it is hidden from
 * assistive technology (the settings sheet says the bar should move) and has no transition of its own.
 */
export function LevelMeter({ level }: { level: number }) {
  return (
    <span className="gist-meter" aria-hidden="true">
      <span className="gist-meter-fill" style={{ transform: `scaleX(${level})` }} />
    </span>
  )
}

/** Time since the Gist started, ticking each second. A timer role is not announced as it changes. */
export function Elapsed({ startedAt }: { startedAt: string | null }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!startedAt || now === null) return null
  return (
    <span role="timer" aria-label="Time live" className="gist-elapsed">
      {elapsedLabel(startedAt, now)}
    </span>
  )
}
