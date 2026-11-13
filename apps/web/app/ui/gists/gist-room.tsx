'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { FlagIcon, GearIcon, HandIcon, HeadphonesIcon, LeaveIcon, LockIcon, MicIcon, MicOffIcon, PeopleIcon, PlayIcon, SignalIcon } from '@/app/ui/icons'
import { weakQuality } from '@/lib/gist-connection'
import { createSpeakingAnnouncer, smoothLevel } from '@/lib/gist-mic'
import type { Phase } from '@/lib/gist-session'
import { controlsFor, dataUseHint, listenerLabel, personName, type GistView } from '@/lib/gists'
import { gistCall } from './api'
import { ConnectionPanel } from './connection-panel'
import { useGist, type HeldGist } from './gist-provider'
import { HostPanel } from './host-panel'
import { MicPanel } from './mic-panel'
import { ReportGist } from './report-gist'
import { Sheet } from './sheet'
import { Elapsed, StageGrid, type StagePerson } from './stage'

/** Set once a speaker has seen the earphones tip, so it is not shown on every Gist. */
const EARPHONES_TIP_KEY = 'hn-gist-earphones-tip'

/** What the room shows for a Gist the member has not joined (or has left): nothing live. */
type Live = Pick<HeldGist, 'problem' | 'blocked' | 'speaking' | 'requests' | 'mics' | 'quality' | 'noiseRemoval' | 'micOn' | 'micBusy' | 'micProblem' | 'hearing'>
const IDLE: Live = {
  problem: null,
  blocked: false,
  speaking: [],
  requests: [],
  mics: {},
  quality: {},
  noiseRemoval: null,
  micOn: false,
  micBusy: false,
  micProblem: null,
  hearing: true,
}

/**
 * A Gist's page. The Gist the member is in is held by GistProvider, above the pages, so
 * it keeps playing when they move on; this draws it. A Gist they are not in is drawn
 * from the server's view, with Join.
 *
 * `mayTakeStage` is `gistStage` from /v1/me: false for a member who may only listen.
 */
export function GistRoom({ initial, meId, mayTakeStage }: { initial: GistView; meId: string; mayTakeStage: boolean }) {
  const router = useRouter()
  const gist = useGist()
  const id = initial.id
  const held = gist.room?.id === id ? gist.room : null
  const s: Live = held ?? IDLE
  const view = held?.view ?? initial
  const [leaving, setLeaving] = useState(false)
  const phase: Phase = held?.phase ?? (initial.status === 'ended' ? 'ended' : 'prejoin')
  const { problem, blocked, speaking, requests, mics, quality, noiseRemoval, micOn, micProblem, hearing } = s
  const [hint, setHint] = useState(() => dataUseHint(undefined))
  const [tipSeen, setTipSeen] = useState(true)
  const [level, setLevel] = useState(0)
  const [listenersOpen, setListenersOpen] = useState(false)
  const [micSheet, setMicSheet] = useState(false)
  const [reportSheet, setReportSheet] = useState(false)
  const [connectionSheet, setConnectionSheet] = useState(false)
  const [speakingNote, setSpeakingNote] = useState('')
  const [requestProblem, setRequestProblem] = useState<string | null>(null)

  const announcer = useRef(createSpeakingAnnouncer())
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const homeRef = useRef<HTMLAnchorElement>(null)
  const requestRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wantFocus = useRef<'request' | 'cancel' | null>(null)
  const shownPhase = useRef(phase)

  const role = view.viewer.role
  const controls = controlsFor({ ...view, mayTakeStage })
  const polling = phase === 'live' || phase === 'reconnecting'
  // A modal sheet opens only when asked. A moderator's list lives in the host panel, which exists only while
  // live, so joining, leaving or a role change must not leave it half-open to appear by itself.
  useEffect(() => {
    setListenersOpen(false)
  }, [polling, role])

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection
    setHint(dataUseHint(connection))
  }, [])

  // Back on the Gist's own page, which says for itself what happened: the bar's note is done with.
  const notice = held?.notice
  useEffect(() => {
    if (notice) gist.dismissNotice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice])

  // Next keeps a page you leave mounted but hidden, and shows it as it was when you come Back.
  // Effects run again when it is shown, so a Leave from here leaves no "Leaving…" behind.
  useEffect(() => setLeaving(false), [])

  // Focus never falls to nothing: when the button that was tapped goes away (Join,
  // Try again), it moves to the room's title once live, or to what to do next.
  useEffect(() => {
    // Only on a change: the phase the page opened with (an ended Gist, say) takes no focus.
    if (shownPhase.current === phase) return
    shownPhase.current = phase
    if (document.activeElement && document.activeElement !== document.body) return
    if (phase === 'live') titleRef.current?.focus()
    else (retryRef.current ?? homeRef.current)?.focus()
  }, [phase])

  // Request to speak and Cancel request replace each other: focus follows to the new one.
  useEffect(() => {
    const target = wantFocus.current === 'cancel' ? cancelRef.current : wantFocus.current === 'request' ? requestRef.current : null
    if (!target) return
    target.focus()
    wantFocus.current = null
  }, [controls.request, controls.cancelRequest])

  // Straight from the tap: the provider starts the sound inside it.
  const join = () => void gist.join(view, mayTakeStage)

  function leave() {
    setLeaving(true)
    router.push('/')
    void gist.leave()
  }

  // ---- controls ----------------------------------------------------------------------

  const readConnection = () => gist.audio()?.sample() ?? Promise.resolve(null)

  function seeTip() {
    setTipSeen(true)
    try {
      localStorage.setItem(EARPHONES_TIP_KEY, '1')
    } catch {
      // No storage: it shows again next time.
    }
  }

  function toggleMic() {
    if (!micOn) seeTip()
    void gist.toggleMic()
  }

  // Whether the member has seen the earphones tip on this browser.
  useEffect(() => {
    try {
      setTipSeen(localStorage.getItem(EARPHONES_TIP_KEY) === '1')
    } catch {
      // No storage: the tip shows.
      setTipSeen(false)
    }
  }, [])

  // The input level on the member's own tile and in the settings sheet.
  useEffect(() => {
    if (!micOn) {
      setLevel(0)
      return
    }
    let value = 0
    let shown = 0
    // Follows the track itself (a device change swaps it), and sleeps while the tab is hidden.
    const stop = gist.audio()?.watchLevel((raw) => {
      value = smoothLevel(value, raw)
      if (Math.abs(value - shown) > 0.03 || value === 0) {
        shown = value
        setLevel(value)
      }
    })
    return () => stop?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn, gist.micKey])

  // Who started speaking, for screen readers: new speakers only, throttled, never the member themselves.
  useEffect(() => {
    const nameOf = (who: string) => {
      const p = who === view.host.id ? view.host : view.speakers.find((x) => x.id === who)
      return p ? personName(p) : null
    }
    const note = announcer.current.next(Date.now(), speaking.filter((who) => who !== meId), nameOf)
    if (!note) return
    setSpeakingNote(note)
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setSpeakingNote(''), 2500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking])

  async function speakRequest(on: boolean) {
    setRequestProblem(null)
    const res = await gistCall(on ? 'PUT' : 'DELETE', `/${id}/speak-request`)
    if (!res.ok) setRequestProblem(res.message ?? 'That did not work. Try again.')
    else {
      wantFocus.current = on ? 'cancel' : 'request'
      gist.announce(on ? 'Request sent. The host will see it.' : 'Request withdrawn.')
    }
    await gist.refreshAfterAction()
  }

  // ---- drawing -----------------------------------------------------------------------

  const people: StagePerson[] = [
    { ...view.host, label: 'Host' },
    ...view.speakers.map((s): StagePerson => ({ ...s, label: s.role === 'cohost' ? 'Co-host' : 'Speaker' })),
  ]
  const moderator = role === 'host' || role === 'cohost'
  const ended = view.status === 'ended' || phase === 'ended'

  return (
    <div className="page-stack gist-room">
      {/* Who started speaking, throttled. Everything else is said by the provider's region, on any page. */}
      <div role="status" aria-live="polite" className="sr-only">
        {speakingNote}
      </div>

      <header className="square-card gist-section gist-head">
        <div className="gist-head-row">
          <p className="gist-live">
            {ended ? null : <span className="gist-live-dot" aria-hidden="true" />}
            <span>{ended ? 'Ended' : 'Live'}</span>
            {!ended ? <Elapsed startedAt={view.startedAt} /> : null}
          </p>
          {view.locked ? (
            <span className="gist-badge">
              <LockIcon size={12} /> Room locked
            </span>
          ) : null}
        </div>
        <h1 ref={titleRef} tabIndex={-1} className="page-title mt-2">
          {view.title}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Hosted by{' '}
          <Link href={`/u/${view.host.handle}`} className="font-semibold text-ink hover:underline">
            {personName(view.host)}
          </Link>
          {view.community ? (
            <>
              {' in '}
              <Link href={`/c/${view.community.slug}`} className="hover:underline">
                {view.community.name}
              </Link>
            </>
          ) : null}
        </p>
        {!ended ? (
          <div className="gist-actions mt-3">
            <button
              type="button"
              className="btn btn-secondary gist-btn gist-count"
              aria-haspopup="dialog"
              // A host or co-host's list is in the host panel, which appears once they have joined.
              disabled={moderator && !polling}
              onClick={() => setListenersOpen(true)}
            >
              <PeopleIcon size={18} />
              {listenerLabel(view.listenerCount)}
            </button>
            {polling ? (
              <button type="button" className="btn btn-secondary gist-btn" aria-haspopup="dialog" onClick={() => setConnectionSheet(true)}>
                <SignalIcon size={18} />
                Connection
              </button>
            ) : null}
            {/* Anyone in the room may report it, except its host (docs/adr/0017). */}
            {polling && role !== 'host' ? (
              <button type="button" className="btn btn-secondary gist-btn" aria-haspopup="dialog" onClick={() => setReportSheet(true)}>
                <FlagIcon size={18} />
                Report
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {leaving ? (
        <p className="square-card gist-section text-sm" role="status">
          Leaving…
        </p>
      ) : null}

      {phase === 'prejoin' && !leaving ? (
        <section className="square-card gist-section" aria-labelledby="gist-join-heading">
          <h2 id="gist-join-heading" className="section-title">
            Ready to listen?
          </h2>
          <p className="mt-2 text-sm">
            <strong>Keep this screen open.</strong> If your phone locks or you switch to another app, the sound can stop. It keeps playing while you move around HeyNaija. Audio only: no camera, and no recording.
          </p>
          <p className="mt-2 text-sm text-muted">{hint}</p>
          <p className="mt-2 text-sm text-muted">The sound starts when you tap Join.{mayTakeStage ? ' You only need your microphone if the host lets you speak.' : ''}</p>
          <button type="button" className="btn btn-primary btn-lg gist-btn mt-4" onClick={join}>
            Join the Gist
          </button>
        </section>
      ) : null}

      {phase === 'connecting' ? (
        <p className="square-card gist-section text-sm" role="status">
          Connecting… keep this screen open.
        </p>
      ) : null}

      {phase === 'failed' ? (
        <section className="square-card gist-section">
          <p role="alert" className="notice notice-danger">
            {problem ?? 'Could not join the Gist.'}
          </p>
          <button ref={retryRef} type="button" className="btn btn-primary gist-btn mt-4" onClick={join}>
            Try again
          </button>
        </section>
      ) : null}

      {phase === 'full' || phase === 'locked' ? (
        <section className="square-card gist-section" role="alert">
          <h2 className="section-title">{phase === 'full' ? 'This Gist is full' : 'This Gist is locked'}</h2>
          <p className="mt-2 text-sm text-muted">
            {phase === 'full' ? 'It has all the listeners it can take. Spots open up as people leave.' : 'The host has locked the room, so no new listeners can join.'}
          </p>
          <div className="gist-actions mt-4">
            <button ref={retryRef} type="button" className="btn btn-primary gist-btn" onClick={join}>
              Try again
            </button>
            <Link href="/" className="btn btn-secondary gist-btn">
              Back to Home
            </Link>
          </div>
        </section>
      ) : null}

      {phase === 'elsewhere' ? (
        <section className="square-card gist-section" role="alert">
          <h2 className="section-title">This Gist is open in another tab or device</h2>
          <p className="mt-2 text-sm text-muted">You can only listen in one place at a time. The sound is playing there. To move it here, tap the button.</p>
          <button ref={retryRef} type="button" className="btn btn-primary gist-btn mt-4" onClick={join}>
            Use it here
          </button>
        </section>
      ) : null}

      {phase === 'gone' ? (
        <section className="square-card gist-section" role="alert">
          <h2 className="section-title">You are no longer in this Gist</h2>
          <Link ref={homeRef} href="/" className="btn btn-primary gist-btn mt-4">
            Back to Home
          </Link>
        </section>
      ) : null}

      {phase === 'ended' ? (
        <section className="square-card gist-section" role="status">
          <h2 className="section-title">This Gist has ended</h2>
          <p className="mt-2 text-sm text-muted">
            {view.peakListeners > 0 ? `Up to ${listenerLabel(view.peakListeners)} listened. ` : ''}Thanks for being part of it. Gists are not recorded.
          </p>
          <Link ref={homeRef} href="/" className="btn btn-primary gist-btn mt-4">
            Back to Home
          </Link>
        </section>
      ) : null}

      {polling && !leaving ? (
        <>
          {phase === 'reconnecting' ? (
            <p role="status" className="notice">
              Reconnecting… keep this screen open. The sound comes back on its own.
            </p>
          ) : (
            <p className="px-1 text-sm text-muted">
              <strong className="text-ink">Keep this screen open.</strong> {hint}
            </p>
          )}
          {problem || requestProblem ? (
            <p role="alert" className="notice notice-danger">
              {problem ?? requestProblem}
            </p>
          ) : null}
          {/* The member's own network, as the server sees it: said before they blame the speaker or the app. */}
          {phase === 'live' && weakQuality(quality[meId]) ? (
            <div role="status" className="notice gist-tip">
              <SignalIcon size={18} />
              <p>Your connection is weak, so the sound may break up{controls.mic ? ' and others may not hear you clearly' : ''}.</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConnectionSheet(true)}>
                Details
              </button>
            </div>
          ) : null}

          <section className="square-card gist-section" aria-labelledby="gist-stage-heading">
            <h2 id="gist-stage-heading" className="section-title">
              On stage
            </h2>
            <StageGrid people={people} meId={meId} speaking={speaking} mics={mics} quality={quality} level={level} />
          </section>

          {moderator && role ? (
            <HostPanel
              view={view}
              role={role}
              requests={requests}
              refresh={gist.refreshAfterAction}
              announce={gist.announce}
              listenersOpen={listenersOpen}
              onListenersClose={() => setListenersOpen(false)}
            />
          ) : null}

          {micProblem && !micSheet ? (
            <p role="alert" className="notice notice-danger">
              {micProblem.message}
            </p>
          ) : null}
          {gist.fellBack && controls.mic && !micSheet ? <p className="notice">The microphone you chose is not plugged in. Using the default one.</p> : null}
          {/* A web page cannot send sound to the earpiece as a phone call does, so a loudspeaker echoes into the microphone. */}
          {controls.mic && !micOn && !tipSeen ? (
            <div className="notice gist-tip">
              <HeadphonesIcon size={18} />
              <p>Use earphones when you speak. Without them, the Gist can echo back through your microphone. Wired ones sound clearest.</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={seeTip}>
                Got it
              </button>
            </div>
          ) : null}

          {blocked ? (
            <button type="button" className="btn btn-primary btn-lg gist-btn" onClick={() => void gist.hear()}>
              Tap to hear the Gist
            </button>
          ) : null}
          {/* Paused from the system's media controls (or the bar): still in, hearing nothing. */}
          {!hearing && !blocked ? (
            <div role="status" className="notice gist-tip">
              <PlayIcon size={18} />
              <p>Paused. You are still in the Gist, and nobody else can tell.</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  // The note goes away once it plays: focus moves to the room's title, not to nothing.
                  titleRef.current?.focus()
                  void gist.hear()
                }}
              >
                Play
              </button>
            </div>
          ) : null}

          <div className="gist-bar square-card" role="group" aria-label="Your controls">
            {controls.mic ? (
              <>
                <button
                  type="button"
                  className={`btn gist-btn gist-main ${micOn ? 'btn-primary' : 'btn-secondary'}`}
                  // One fixed name; the pressed state says on or off, so it is never announced twice.
                  aria-pressed={micOn}
                  onClick={toggleMic}
                >
                  {micOn ? <MicIcon size={20} /> : <MicOffIcon size={20} />}
                  Microphone
                  <span aria-hidden="true" className="gist-mic-state">
                    {micOn ? 'On' : 'Off'}
                  </span>
                </button>
                <button type="button" className="btn btn-secondary gist-btn gist-square" aria-haspopup="dialog" aria-label="Microphone settings" onClick={() => setMicSheet(true)}>
                  <GearIcon size={20} />
                </button>
              </>
            ) : null}
            {controls.request ? (
              <button ref={requestRef} type="button" className="btn btn-primary gist-btn gist-main" onClick={() => speakRequest(true)}>
                <HandIcon size={20} />
                Request to speak
              </button>
            ) : null}
            {controls.cancelRequest ? (
              <button ref={cancelRef} type="button" className="btn btn-secondary gist-btn gist-main" onClick={() => speakRequest(false)}>
                Cancel request
              </button>
            ) : null}
            {controls.requestsClosed ? <span className="gist-note gist-main">The host is not taking requests to speak.</span> : null}
            <button type="button" className="btn btn-secondary gist-btn" onClick={leave}>
              <LeaveIcon size={20} />
              Leave
            </button>
          </div>
        </>
      ) : null}

      {/* Everyone: the count. Hosts and co-hosts get the list from the host panel's sheet. */}
      {!moderator ? (
        <Sheet open={listenersOpen} onClose={() => setListenersOpen(false)} title="Listeners">
          <p className="text-sm">{listenerLabel(view.listenerCount)}, out of room for {view.listenerCap.toLocaleString('en-NG')}.</p>
          <p className="mt-2 text-sm text-muted">Only the host and co-hosts can see who is listening. Nobody can tell what you are listening to.</p>
        </Sheet>
      ) : null}

      <Sheet open={connectionSheet} onClose={() => setConnectionSheet(false)} title="Connection">
        <ConnectionPanel read={readConnection} speaker={controls.mic} />
      </Sheet>
      <Sheet open={reportSheet} onClose={() => setReportSheet(false)} title="Report this Gist">
        <ReportGist gistId={id} onDone={() => setReportSheet(false)} />
      </Sheet>
      <Sheet open={micSheet} onClose={() => setMicSheet(false)} title="Microphone settings">
        <MicPanel
          settings={gist.micSettings}
          devices={gist.devices}
          noDevice={gist.noDevice}
          fellBack={gist.fellBack}
          failure={micProblem}
          live={micOn}
          level={level}
          noiseRemoval={noiseRemoval}
          onChange={gist.changeMicSettings}
        />
      </Sheet>
    </div>
  )
}
