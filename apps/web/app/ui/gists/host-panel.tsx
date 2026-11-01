'use client'

import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { LockIcon } from '@/app/ui/icons'
import { Sheet } from './sheet'
import { listenerLabel, personName, type Person, type GistRole, type GistView, type SpeakRequest, controlsFor } from '@/lib/gists'
import { gistCall } from './api'

/** A button that must be tapped twice, for the moves that cannot be undone from here (remove, end). */
function ConfirmButton({ label, confirmLabel, onConfirm, disabled, name }: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean; name?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={armed ? confirmLabel : name ? `${label} ${name}` : undefined}
      className={`btn gist-btn ${armed ? 'btn-danger' : 'btn-secondary'}`}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}

type Props = {
  listenersOpen: boolean
  onListenersClose: () => void
  view: GistView
  role: GistRole
  requests: SpeakRequest[]
  /** Re-reads the room now; called after every action. */
  refresh: () => Promise<void> | void
  announce: (message: string) => void
}

export function HostPanel({ view, role, requests, refresh, announce, listenersOpen, onListenersClose }: Props) {
  const controls = controlsFor({ status: view.status, requestsOpen: view.requestsOpen, viewer: { role, requestedToSpeak: false } })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [listeners, setListeners] = useState<Person[] | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function run(done: string, call: Promise<{ ok: boolean; message?: string }>) {
    setBusy(true)
    setProblem(null)
    const res = await call
    if (!alive.current) return
    setBusy(false)
    if (res.ok) announce(done)
    else setProblem(res.message ?? 'That did not work. Try again.')
    await refresh()
    if (listenersOpen) void loadListeners()
  }

  useEffect(() => {
    if (listenersOpen) void loadListeners()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenersOpen])

  async function loadListeners() {
    const res = await gistCall<{ items: Person[] }>('GET', `/${view.id}/listeners`)
    if (alive.current && res.ok) setListeners(res.data.items)
  }

  const act = {
    approve: (p: Person) => run(`${personName(p)} can speak.`, gistCall('PUT', `/${view.id}/speakers/${p.id}`)),
    demote: (p: Person) => run(`${personName(p)} is a listener again.`, gistCall('DELETE', `/${view.id}/speakers/${p.id}`)),
    mute: (p: Person) => run(`${personName(p)} is muted.`, gistCall('POST', `/${view.id}/members/${p.id}/mute`)),
    remove: (p: Person) => run(`${personName(p)} was removed.`, gistCall('DELETE', `/${view.id}/members/${p.id}`)),
    cohost: (p: Person) => run(`${personName(p)} is a co-host.`, gistCall('PUT', `/${view.id}/cohosts/${p.id}`)),
  }

  return (
    <section className="square-card gist-section" aria-labelledby="gist-host-heading">
      <h2 id="gist-host-heading" className="section-title">
        {role === 'host' ? 'Host controls' : 'Co-host controls'}
      </h2>
      {problem ? (
        <p role="alert" className="notice notice-danger mt-3">
          {problem}
        </p>
      ) : null}

      <h3 className="gist-subhead">Requests to speak ({requests.length})</h3>
      {requests.length === 0 ? (
        <p className="text-sm text-muted">{view.requestsOpen ? 'Nobody is asking to speak.' : 'Requests are switched off.'}</p>
      ) : (
        <ol className="gist-people">
          {requests.map((p) => (
            <li key={p.id} className="gist-person">
              <Avatar handle={p.handle} size={36} />
              <span className="gist-person-name">
                {personName(p)}
                <span className="text-muted"> @{p.handle}</span>
              </span>
              <button type="button" disabled={busy} className="btn btn-primary gist-btn" onClick={() => act.approve(p)}>
                Let speak<span className="sr-only"> {personName(p)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {view.speakers.length > 0 ? (
        <>
          <h3 className="gist-subhead">On stage</h3>
          <ul className="gist-people">
            {view.speakers.map((p) => (
              <li key={p.id} className="gist-person">
                <Avatar handle={p.handle} size={36} />
                <span className="gist-person-name">
                  {personName(p)}
                  <span className="text-muted"> {p.role === 'cohost' ? 'Co-host' : 'Speaker'}</span>
                </span>
                <span className="gist-actions">
                  {p.role === 'speaker' ? (
                    <button type="button" disabled={busy} className="btn btn-secondary gist-btn" onClick={() => act.mute(p)}>
                      Mute<span className="sr-only"> {personName(p)}</span>
                    </button>
                  ) : null}
                  {p.role === 'speaker' && controls.appointCohost ? (
                    <button type="button" disabled={busy} className="btn btn-secondary gist-btn" onClick={() => act.cohost(p)}>
                      Make co-host<span className="sr-only"> {personName(p)}</span>
                    </button>
                  ) : null}
                  {p.role === 'speaker' || role === 'host' ? (
                    <button type="button" disabled={busy} className="btn btn-secondary gist-btn" onClick={() => act.demote(p)}>
                      To listeners<span className="sr-only">: {personName(p)}</span>
                    </button>
                  ) : null}
                  {p.role === 'speaker' || role === 'host' ? (
                    <ConfirmButton
                      label="Remove"
                      name={personName(p)}
                      confirmLabel={`Tap again to remove ${personName(p)}`}
                      disabled={busy}
                      onConfirm={() => act.remove(p)}
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {controls.settings ? (
        <>
          <h3 className="gist-subhead">Room</h3>
          <div className="gist-actions">
            <button
              type="button"
              disabled={busy}
              aria-pressed={view.locked}
              className="btn btn-secondary gist-btn"
              onClick={() => run(view.locked ? 'The room is unlocked.' : 'The room is locked. No new listeners can join.', gistCall('PATCH', `/${view.id}`, { locked: !view.locked }))}
            >
              <LockIcon size={18} />
              {view.locked ? 'Unlock the room' : 'Lock the room'}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={view.requestsOpen}
              className="btn btn-secondary gist-btn"
              onClick={() => run(view.requestsOpen ? 'Requests to speak are off.' : 'Requests to speak are on.', gistCall('PATCH', `/${view.id}`, { requestsOpen: !view.requestsOpen }))}
            >
              {view.requestsOpen ? 'Turn requests off' : 'Turn requests on'}
            </button>
            <ConfirmButton
              label="End the Gist"
              confirmLabel="Tap again to end it for everyone"
              disabled={busy}
              onConfirm={() => run('The Gist has ended.', gistCall('POST', `/${view.id}/end`))}
            />
          </div>
        </>
      ) : null}

      <Sheet open={listenersOpen} onClose={onListenersClose} title="Listeners">
        <p className="text-sm text-muted">
          {listenerLabel(view.listenerCount)}. Only hosts and co-hosts can see who is listening.
        </p>
      {listeners === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : listeners.length === 0 ? (
          <p className="text-sm text-muted">Nobody is listening yet.</p>
        ) : (
          <ul className="gist-people">
            {listeners.map((p) => (
              <li key={p.id} className="gist-person">
                <Avatar handle={p.handle} size={36} />
                <span className="gist-person-name">{personName(p)}</span>
                <span className="gist-actions">
                  <button type="button" disabled={busy} className="btn btn-secondary gist-btn" onClick={() => act.approve(p)}>
                    Invite to speak<span className="sr-only">: {personName(p)}</span>
                  </button>
                  <ConfirmButton label="Remove" name={personName(p)} confirmLabel={`Tap again to remove ${personName(p)}`} disabled={busy} onConfirm={() => act.remove(p)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </section>
  )
}
