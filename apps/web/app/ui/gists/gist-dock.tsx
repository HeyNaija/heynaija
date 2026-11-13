'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef } from 'react'
import { CloseIcon, LeaveIcon, MicIcon, MicOffIcon, PlayIcon } from '@/app/ui/icons'
import { controlsFor, gistBarStatus, gistDock } from '@/lib/gists'
import { useGist } from './gist-provider'

/**
 * The Gist the member is in, over every page but its own: they went to read something
 * else, and the sound goes on. Its title and, in words, what their microphone is doing;
 * the title leads back to the room, the microphone can be switched from here, a paused
 * Gist can be played again, and Leave leaves. If the Gist ends or drops while they are
 * away, the bar says so until they close it.
 */
export function GistDock() {
  const gist = useGist()
  const pathname = usePathname()
  const link = useRef<HTMLAnchorElement>(null)
  const room = gist.room
  const shows = gistDock({ roomId: room?.id ?? null, phase: room?.phase ?? null, pathname, notice: room?.notice ?? null })
  if (!room || shows === 'none') return null

  if (shows === 'notice') {
    return (
      <section className="gist-dock square-card" aria-label="Gists">
        <p className="gist-dock-copy gist-dock-note">{room.notice}</p>
        <button type="button" className="icon-btn gist-dock-btn" aria-label="Close" onClick={gist.dismissNotice}>
          <CloseIcon size={20} />
        </button>
      </section>
    )
  }

  const mayUseMic = controlsFor({ ...room.view, mayTakeStage: room.mayTakeStage }).mic
  const status = gistBarStatus({ phase: room.phase, hearing: room.hearing, mayUseMic, micOn: room.micOn, micBusy: room.micBusy })

  return (
    <section className="gist-dock square-card" aria-label="The Gist you are in">
      <Link ref={link} href={`/gists/${room.id}`} className="gist-dock-link">
        <span className="gist-live-dot" aria-hidden="true" />
        <span className="gist-dock-copy">
          <span className="sr-only">Back to the Gist: </span>
          <span className="gist-dock-title">{room.view.title}</span>
          <span className="gist-dock-status">{status}</span>
        </span>
      </Link>
      {/* Paused from the system's media controls, or the browser held the sound back: the way to hear it again. */}
      {!room.hearing || room.blocked ? (
        <button
          type="button"
          className="icon-btn gist-dock-btn gist-dock-play"
          aria-label="Play the Gist"
          onClick={() => {
            // The button goes away once it plays: focus moves to the Gist, not to nothing.
            link.current?.focus()
            void gist.hear()
          }}
        >
          <PlayIcon size={20} />
        </button>
      ) : null}
      {mayUseMic ? (
        <button
          type="button"
          className={`icon-btn gist-dock-btn${room.micOn ? ' is-on' : ''}`}
          // One fixed name; the pressed state says on or off, as on the room's own button.
          aria-label="Microphone"
          aria-pressed={room.micOn}
          disabled={room.micBusy || room.phase !== 'live'}
          onClick={() => void gist.toggleMic()}
        >
          {room.micOn ? <MicIcon size={20} /> : <MicOffIcon size={20} />}
        </button>
      ) : null}
      <button type="button" className="btn btn-sm gist-dock-leave" onClick={() => void gist.leave()}>
        <LeaveIcon size={18} />
        Leave
      </button>
      {/* Why the microphone did not start is written in the room; away from it, here. */}
      {room.micProblem ? (
        <p role="alert" className="gist-dock-problem">
          {room.micProblem.message}
        </p>
      ) : null}
    </section>
  )
}
