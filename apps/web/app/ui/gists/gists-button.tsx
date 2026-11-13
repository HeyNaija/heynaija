'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { CloseIcon, LiveIcon } from '@/app/ui/icons'
import { controlsFor, gistBarStatus, gistsButtonLabel, isInGist, liveMeta, noneLiveText, otherLive } from '@/lib/gists'
import { useGist } from './gist-provider'
import { refreshLiveGists, useLiveGists } from './live-gists'

/**
 * The Gists button in the top bar, which says at a glance what is on: a green bubble
 * while the member is in a Gist (the selected link's fill), and a red dot while others
 * are live (the Live now dot). Clicking it opens the Gists panel: the Gist they are in,
 * the ones live now, and Start a Gist for a member who may take the stage.
 */
export function GistsButton({ mayTakeStage }: { mayTakeStage: boolean }) {
  const gist = useGist()
  const live = useLiveGists()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const room = gist.room && isInGist(gist.room.phase) ? gist.room : null
  const others = otherLive(live, room?.id ?? null)

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`icon-btn gists-button${room ? ' is-in' : ''}`}
        aria-label={gistsButtonLabel(room !== null, others.length)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          refreshLiveGists()
          setOpen(true)
        }}
      >
        <LiveIcon size={22} />
        {others.length > 0 ? <span className="gists-button-dot" aria-hidden="true" /> : null}
      </button>
      <GistsPanel open={open} anchor={button} onClose={() => setOpen(false)} mayTakeStage={mayTakeStage} />
    </>
  )
}

/**
 * A popover under the button on wider screens and a sheet from the bottom on phones, on
 * the native <dialog> as the room's sheets are: focus stays inside, Esc and a click
 * outside close it, and focus goes back to the button.
 */
function GistsPanel({ open, anchor, onClose, mayTakeStage }: { open: boolean; anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void; mayTakeStage: boolean }) {
  const gist = useGist()
  const live = useLiveGists()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const room = gist.room && isInGist(gist.room.phase) ? gist.room : null
  const others = otherLive(live, room?.id ?? null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      // Under the button, right edges in line; the stylesheet uses this only from 640px up.
      const at = anchor.current?.getBoundingClientRect()
      if (at) {
        dialog.style.setProperty('--gists-panel-top', `${Math.round(at.bottom + 8)}px`)
        dialog.style.setProperty('--gists-panel-right', `${Math.max(12, Math.round(document.documentElement.clientWidth - at.right))}px`)
      }
      dialog.showModal()
    }
    if (!open && dialog.open) dialog.close()
  }, [open, anchor])

  return (
    <dialog
      ref={ref}
      className="gist-sheet gists-panel"
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the dimmed area outside the card closes it.
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      {open ? (
        <div className="gist-sheet-body">
          <div className="gist-sheet-head gists-panel-head">
            <div>
              <h2 id={titleId} className="section-title">
                Gists
              </h2>
              <p className="text-sm text-muted">Live audio rooms. Not recorded.</p>
            </div>
            <button type="button" className="icon-btn gist-sheet-close" aria-label="Close Gists" onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          </div>

          {room ? (
            <section aria-labelledby={`${titleId}-in`}>
              <h3 id={`${titleId}-in`} className="gist-subhead">
                You are in
              </h3>
              <Link href={`/gists/${room.id}`} className="gists-row" onClick={onClose}>
                <span className="gist-live-dot" aria-hidden="true" />
                <span className="gists-row-text">
                  <span className="gists-row-title">{room.view.title}</span>
                  <span className="gists-row-meta">
                    {gistBarStatus({
                      phase: room.phase,
                      hearing: room.hearing,
                      mayUseMic: controlsFor({ ...room.view, mayTakeStage: room.mayTakeStage }).mic,
                      micOn: room.micOn,
                      micBusy: room.micBusy,
                    })}
                  </span>
                </span>
              </Link>
            </section>
          ) : null}

          <section aria-labelledby={`${titleId}-live`}>
            <h3 id={`${titleId}-live`} className="gist-subhead">
              Live now
            </h3>
            {others.length === 0 ? (
              <p className="gists-none">{noneLiveText(room !== null)}</p>
            ) : (
              <ul className="gists-list">
                {others.map((item) => (
                  <li key={item.id}>
                    <Link href={`/gists/${item.id}`} className="gists-row" onClick={onClose}>
                      <span className="gist-live-dot" aria-hidden="true" />
                      <span className="gists-row-text">
                        <span className="gists-row-title">{item.title}</span>
                        <span className="gists-row-meta">{liveMeta(item)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {mayTakeStage ? (
            <Link href="/gists/new" className="btn btn-primary btn-block gist-btn mt-4" onClick={onClose}>
              <LiveIcon size={18} />
              Start a Gist
            </Link>
          ) : null}
        </div>
      ) : null}
    </dialog>
  )
}
