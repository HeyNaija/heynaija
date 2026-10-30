'use client'

import { useEffect, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { MicOffIcon } from '@/app/ui/icons'
import { elapsedLabel } from '@/lib/space-mic'
import { personName, type Person } from '@/lib/spaces'

export type StagePerson = Person & { label: 'Host' | 'Co-host' | 'Speaker' }

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
}: {
  people: StagePerson[]
  meId: string
  speaking: string[]
  /** Member id to true when their microphone is live. */
  mics: Record<string, boolean>
  /** The member's own input level, 0..1. */
  level: number
}) {
  return (
    <ul className="space-stage" aria-label="People on stage">
      {people.map((p) => {
        const talking = speaking.includes(p.id) && mics[p.id] !== false
        const live = mics[p.id] === true
        const self = p.id === meId
        return (
          <li key={p.id} className={`space-tile ${talking ? 'is-speaking' : ''}`}>
            <span className="space-avatar">
              <Avatar handle={p.handle} size={72} />
            </span>
            <span className="space-tile-name">
              {personName(p)}
              {self ? ' (you)' : ''}
            </span>
            <span className="space-badges">
              {p.label !== 'Speaker' ? <span className="space-badge space-badge-role">{p.label}</span> : <span className="space-badge">Speaker</span>}
              {live ? null : (
                <span className="space-badge space-badge-muted">
                  <MicOffIcon size={12} /> Muted
                </span>
              )}
              {talking ? (
                <span className="space-badge space-badge-speaking" aria-hidden="true">
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
    <span className="space-meter" aria-hidden="true">
      <span className="space-meter-fill" style={{ transform: `scaleX(${level})` }} />
    </span>
  )
}

/** Time since the Space started, ticking each second. A timer role is not announced as it changes. */
export function Elapsed({ startedAt }: { startedAt: string | null }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!startedAt || now === null) return null
  return (
    <span role="timer" aria-label="Time live" className="space-elapsed">
      {elapsedLabel(startedAt, now)}
    </span>
  )
}
