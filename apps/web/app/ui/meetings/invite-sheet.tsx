'use client'

import { useEffect, useId, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { apiCall } from '@/app/ui/gists/api'
import { Sheet } from '@/app/ui/gists/sheet'
import { personName, type Person } from '@/lib/gists'
import { INVITE_SEARCH_DEBOUNCE_MS, meetingFailure, type MeetingView } from '@/lib/meetings'

/**
 * The host's Invite sheet. It searches only members the API says can be invited: those who pass
 * the same `canCall` check as a call (with the host), in no block with anyone already in the
 * meeting, and not already in it. The list is the API's answer, never filtered here, and a
 * member who is not on it cannot be found by typing their name.
 */
export function InviteSheet({
  open,
  onClose,
  meetingId,
  seatsLeft,
  onInvited,
  announce,
}: {
  open: boolean
  onClose: () => void
  meetingId: string
  seatsLeft: number
  onInvited: (view: MeetingView) => void
  announce: (text: string) => void
}) {
  const fieldId = useId()
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let stale = false
    const timer = setTimeout(async () => {
      const res = await apiCall<{ people: Person[] }>('GET', `/v1/meetings/${meetingId}/invitable?q=${encodeURIComponent(query.trim())}`)
      if (stale) return
      if (res.ok) {
        setPeople(res.data.people)
        setError(null)
      } else {
        setPeople([])
        setError(meetingFailure(res.status, res.code))
      }
    }, query ? INVITE_SEARCH_DEBOUNCE_MS : 0)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [open, query, meetingId])

  async function invite(person: Person) {
    setBusy(person.id)
    setError(null)
    const res = await apiCall<MeetingView>('POST', `/v1/meetings/${meetingId}/invite`, { memberId: person.id })
    setBusy(null)
    if (!res.ok) {
      setError(meetingFailure(res.status, res.code))
      return
    }
    setPeople((list) => list?.filter((p) => p.id !== person.id) ?? null)
    announce(`${personName(person)} invited.`)
    onInvited(res.data)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Invite people">
      <p className="text-sm text-muted">
        You can invite {seatsLeft} more. Only members who can join a call with you are listed. Invitations last 5 minutes.
      </p>
      <label htmlFor={fieldId} className="sr-only">
        Search members
      </label>
      {/* 16px text in the field (the .field class) so phones do not zoom in. */}
      <input id={fieldId} type="search" className="field mt-3" value={query} maxLength={40} placeholder="Search by name or handle" autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
      <div role="status" aria-live="polite" className="sr-only">
        {people === null ? '' : `${people.length} ${people.length === 1 ? 'person' : 'people'} found.`}
      </div>
      {error ? (
        <p role="alert" className="notice notice-danger mt-3">
          {error}
        </p>
      ) : null}
      {people === null ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : people.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{query ? 'Nobody you can invite matches that.' : 'Nobody to invite right now.'}</p>
      ) : (
        <ul className="gist-people">
          {people.map((p) => (
            <li key={p.id} className="gist-person">
              <Avatar handle={p.handle} size={32} />
              <span className="gist-person-name">
                {personName(p)}
                {p.displayName ? <span className="text-muted"> @{p.handle}</span> : null}
              </span>
              <button type="button" className="btn btn-secondary gist-btn" disabled={busy !== null || seatsLeft === 0} onClick={() => void invite(p)}>
                Invite<span className="sr-only"> {personName(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
