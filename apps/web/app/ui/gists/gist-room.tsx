'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FlagIcon, GearIcon, HandIcon, LeaveIcon, LockIcon, MicIcon, MicOffIcon, PeopleIcon } from '@/app/ui/icons'
import {
  chooseDevice,
  createSpeakingAnnouncer,
  DEFAULT_MIC,
  MIC_SETTINGS_KEY,
  micFailure,
  readMicSettings,
  smoothLevel,
  staleSavedDevice,
  writeMicSettings,
  type InputDevice,
  type MicFailure,
  type MicSettings,
} from '@/lib/gist-mic'
import { GistSession, type Phase } from '@/lib/gist-session'
import {
  applyView,
  controlsFor,
  createLatest,
  CURRENT_GIST_KEY,
  dataUseHint,
  listenerLabel,
  nextPollDelay,
  personName,
  type JoinResult,
  type Snapshot,
  type GistView,
  type SpeakRequest,
} from '@/lib/gists'
import { gistCall } from './api'
import type { GistAudio } from './audio'
import { HostPanel } from './host-panel'
import { MicPanel } from './mic-panel'
import { ReportGist } from './report-gist'
import { Sheet } from './sheet'
import { Elapsed, StageGrid, type StagePerson } from './stage'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function GistRoom({ initial, meId }: { initial: GistView; meId: string }) {
  const router = useRouter()
  const id = initial.id
  const [view, setView] = useState(initial)
  const [phase, setPhase] = useState<Phase>(initial.status === 'ended' ? 'ended' : 'prejoin')
  const [announcement, setAnnouncement] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [micProblem, setMicProblem] = useState<MicFailure | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [speaking, setSpeaking] = useState<string[]>([])
  const [requests, setRequests] = useState<SpeakRequest[]>([])
  const [hint, setHint] = useState(() => dataUseHint(undefined))
  const [mics, setMics] = useState<Record<string, boolean>>({})
  const [level, setLevel] = useState(0)
  const [micSettings, setMicSettings] = useState<MicSettings>(DEFAULT_MIC)
  const [devices, setDevices] = useState<InputDevice[]>([])
  const [noDevice, setNoDevice] = useState(false)
  const [listenersOpen, setListenersOpen] = useState(false)
  const [micSheet, setMicSheet] = useState(false)
  const [reportSheet, setReportSheet] = useState(false)
  const [speakingNote, setSpeakingNote] = useState('')

  const audio = useRef<GistAudio | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const snapshot = useRef<Snapshot>({ role: initial.viewer.role, status: initial.status })
  const micRef = useRef(false)
  const wake = useRef<WakeLockSentinel | null>(null)
  const latest = useRef(createLatest())
  const session = useRef<GistSession | null>(null)
  const announcer = useRef(createSpeakingAnnouncer())
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const homeRef = useRef<HTMLAnchorElement>(null)
  const requestRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wantFocus = useRef<'request' | 'cancel' | null>(null)
  const firstDeviceList = useRef(true)
  const shownPhase = useRef(phase)

  const announce = useCallback((text: string) => setAnnouncement(text), [])
  const role = view.viewer.role
  const controls = controlsFor(view)
  const polling = phase === 'live' || phase === 'reconnecting'
  const moderating = role === 'host' || role === 'cohost'
  // A modal sheet opens only when asked. A moderator's list lives in the host panel, which exists only while
  // live, so joining, leaving or a role change must not leave it half-open to appear by itself.
  useEffect(() => {
    setListenersOpen(false)
  }, [polling, role])

  // The chosen input if it is still plugged in, else the default one.
  const choice = chooseDevice(devices, micSettings.deviceId)
  const effective: MicSettings = { ...micSettings, deviceId: choice.deviceId }
  const effKey = `${effective.deviceId}|${Number(effective.noiseSuppression)}${Number(effective.echoCancellation)}${Number(effective.autoGainControl)}`

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection
    setHint(dataUseHint(connection))
  }, [])

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

  const setMic = (on: boolean) => {
    micRef.current = on
    setMicOn(on)
  }

  /** The join / reconnect / leave state machine (lib/gist-session.ts), wired to this page. */
  function getSession(): GistSession {
    if (!session.current) {
      session.current = new GistSession({
        join: () => gistCall<JoinResult>('POST', `/${id}/join`),
        // The server grants the microphone to a speaker only after this; the poll repeats it if it is lost.
        sync: () => void gistCall('POST', `/${id}/sync`),
        // keepalive lets it finish while the page is closing.
        leave: () => void fetch(`/api/v1/gists/${id}/leave`, { method: 'POST', keepalive: true }).catch(() => undefined),
        createAudio: async (events) => {
          // The one place the SDK is fetched: a separate chunk, only after a tap.
          const { createAudio } = await import('./audio')
          const into = container.current
          if (!into) throw new Error('the room is gone')
          const made = createAudio(into, events)
          audio.current = made
          return made
        },
        rememberGist: (on) => (on ? sessionStorage.setItem(CURRENT_GIST_KEY, id) : sessionStorage.removeItem(CURRENT_GIST_KEY)),
        holdScreen: async () => {
          try {
            wake.current = (await navigator.wakeLock?.request('screen')) ?? null
          } catch {
            // Denied (low battery, or no support): the "keep this screen open" note is the fallback.
          }
          return () => {
            void wake.current?.release().catch(() => undefined)
            wake.current = null
          }
        },
        sleep,
        reloadPage: () => window.location.reload(),
        ui: {
          phase: (next) => {
            setPhase(next)
            if (next !== 'live' && next !== 'reconnecting') setMic(false)
          },
          problem: setProblem,
          joined: (result) => {
            setView(result.gist)
            snapshot.current = { role: result.role, status: result.gist.status }
          },
          announce,
          playbackBlocked: setBlocked,
          speaking: setSpeaking,
          micOff: () => setMic(false),
          mics: setMics,
        },
      })
    }
    return session.current
  }

  useEffect(() => {
    const s = getSession()
    s.open()
    const onHide = () => s.pageHide()
    // Back from the back/forward cache: the connection was dropped on the way out.
    const onShow = (event: PageTransitionEvent) => event.persisted && s.pageShow()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      // Leaving by any route (a link, Back) drops the connection, the screen lock and the presence.
      s.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function join() {
    if (typeof RTCPeerConnection === 'undefined') {
      setPhase('failed')
      setProblem('This browser cannot play Gists. Try a recent Chrome, Firefox, Safari or Edge.')
      return
    }
    await getSession().join()
  }

  async function leave() {
    await getSession().leave()
    router.push('/')
  }

  // ---- polling (there is no realtime channel) ------------------------------------

  const poll = useCallback(async (): Promise<boolean> => {
    const ticket = latest.current.begin()
    const res = await gistCall<GistView>('GET', `/${id}`)
    if (!res.ok) {
      if (res.status === 404) window.location.reload()
      return false
    }
    // An older response, or one fetched before the member's last action, must not overwrite a newer view.
    if (!latest.current.accept(ticket)) return true
    const next = applyView(snapshot.current, res.data)
    snapshot.current = { role: next.role, status: next.status }
    setView(res.data)
    if (next.announcement) announce(next.announcement)
    if (next.ended) {
      await getSession().finish()
      return true
    }
    if (next.resync) {
      // A demotion takes the microphone: switch it off here too, then ask the server to match LiveKit to the role.
      if (res.data.viewer.role === 'listener' && micRef.current) {
        await audio.current?.setMic(false, effective, effKey).catch(() => undefined)
        setMic(false)
      }
      void gistCall('POST', `/${id}/sync`)
    }
    const r = res.data.viewer.role
    if (r === 'host' || r === 'cohost') {
      const queue = await gistCall<{ items: SpeakRequest[] }>('GET', `/${id}/requests`)
      if (queue.ok) setRequests(queue.data.items)
    } else {
      setRequests([])
    }
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, announce])
  const pollRef = useRef(poll)
  pollRef.current = poll

  /** After something the member did: views requested before now are out of date, so fetch a fresh one. */
  const refreshAfterAction = useCallback(async () => {
    latest.current.noteAction()
    await pollRef.current()
  }, [])

  useEffect(() => {
    if (!polling) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let stopped = false
    const schedule = () => {
      clearTimeout(timer)
      const delay = nextPollDelay({ hidden: document.hidden, failures })
      if (delay !== null && !stopped) timer = setTimeout(tick, delay)
    }
    const tick = async () => {
      failures = (await pollRef.current()) ? 0 : failures + 1
      schedule()
    }
    const onVisibility = () => {
      clearTimeout(timer)
      if (document.hidden) return
      // The browser releases a wake lock when the tab is hidden; take it again.
      if (wake.current?.released) void navigator.wakeLock?.request('screen').then((l) => (wake.current = l)).catch(() => undefined)
      void tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    schedule()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [polling])

  useEffect(() => {
    if (phase !== 'live' || !('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: view.title, artist: `Hosted by ${personName(view.host)}`, album: 'HeyNaija Gists' })
  }, [phase, view.title, view.host])

  // ---- controls ----------------------------------------------------------------------

  async function toggleMic() {
    setMicProblem(null)
    const want = !micOn
    try {
      await audio.current?.setMic(want, effective, effKey)
      setMic(want)
      announce(want ? 'Microphone on.' : 'You are muted.')
      // Device names appear once the browser has let us use the microphone.
      if (want) void refreshDevices()
    } catch (err) {
      setMic(false)
      setMicProblem(micFailure(err))
    }
  }

  function changeMicSettings(next: MicSettings) {
    setMicSettings(next)
    try {
      localStorage.setItem(MIC_SETTINGS_KEY, writeMicSettings(next))
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  }

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    setNoDevice(inputs.length === 0)
    // Before the microphone is allowed, browsers list inputs without ids; they appear after the first Unmute.
    setDevices(inputs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ deviceId: d.deviceId, label: d.label })))
  }, [])

  // A saved input that was not there when the visit began is forgotten (lib/gist-mic.ts).
  useEffect(() => {
    if (devices.length === 0 || !firstDeviceList.current) return
    firstDeviceList.current = false
    if (staleSavedDevice(devices, micSettings.deviceId, true)) changeMicSettings({ ...micSettings, deviceId: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices])

  // What the member chose last time on this browser.
  useEffect(() => {
    try {
      setMicSettings(readMicSettings(localStorage.getItem(MIC_SETTINGS_KEY)))
    } catch {
      // No storage: defaults.
    }
  }, [])

  // The list of inputs, kept current as headsets come and go.
  useEffect(() => {
    if (!polling || !controls.mic) return
    void refreshDevices()
    const media = navigator.mediaDevices
    media?.addEventListener?.('devicechange', refreshDevices)
    return () => media?.removeEventListener?.('devicechange', refreshDevices)
  }, [polling, controls.mic, refreshDevices])

  // A live microphone follows the settings: a new device or switch restarts it; losing every input mutes it.
  useEffect(() => {
    if (!micOn) return
    if (noDevice) {
      void audio.current?.setMic(false, effective, effKey).catch(() => undefined)
      setMic(false)
      setMicProblem(micFailure({ name: 'NotFoundError' }))
      announce('Your microphone was unplugged. You are muted.')
      return
    }
    // A no-op unless the device or a switch differs from what the live track was started with.
    audio.current?.applyMic(effective, effKey).catch((err) => {
      setMic(false)
      setMicProblem(micFailure(err))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn, noDevice, effKey])

  // The input level on the member's own tile and in the settings sheet.
  useEffect(() => {
    if (!micOn) {
      setLevel(0)
      return
    }
    let value = 0
    let shown = 0
    // Follows the track itself (a device change swaps it), and sleeps while the tab is hidden.
    const stop = audio.current?.watchLevel((raw) => {
      value = smoothLevel(value, raw)
      if (Math.abs(value - shown) > 0.03 || value === 0) {
        shown = value
        setLevel(value)
      }
    })
    return () => stop?.()
  }, [micOn, effKey])

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
    setProblem(null)
    const res = await gistCall(on ? 'PUT' : 'DELETE', `/${id}/speak-request`)
    if (!res.ok) setProblem(res.message ?? 'That did not work. Try again.')
    else {
      wantFocus.current = on ? 'cancel' : 'request'
      announce(on ? 'Request sent. The host will see it.' : 'Request withdrawn.')
    }
    await refreshAfterAction()
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
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* Who started speaking, throttled; a second region so it never overwrites a role change. */}
      <div role="status" aria-live="polite" className="sr-only">
        {speakingNote}
      </div>
      {/* The SDK attaches one <audio> per speaker here. */}
      <div ref={container} hidden />

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

      {phase === 'prejoin' ? (
        <section className="square-card gist-section" aria-labelledby="gist-join-heading">
          <h2 id="gist-join-heading" className="section-title">
            Ready to listen?
          </h2>
          <p className="mt-2 text-sm">
            <strong>Keep this screen open.</strong> If your phone locks or you switch to another app, the sound can stop. Audio only: no camera, and no recording.
          </p>
          <p className="mt-2 text-sm text-muted">{hint}</p>
          <p className="mt-2 text-sm text-muted">The sound starts when you tap Join. You only need your microphone if the host lets you speak.</p>
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

      {polling ? (
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
          {problem ? (
            <p role="alert" className="notice notice-danger">
              {problem}
            </p>
          ) : null}

          <section className="square-card gist-section" aria-labelledby="gist-stage-heading">
            <h2 id="gist-stage-heading" className="section-title">
              On stage
            </h2>
            <StageGrid people={people} meId={meId} speaking={speaking} mics={mics} level={level} />
          </section>

          {moderator && role ? (
            <HostPanel
              view={view}
              role={role}
              requests={requests}
              refresh={refreshAfterAction}
              announce={announce}
              listenersOpen={listenersOpen}
              onListenersClose={() => setListenersOpen(false)}
            />
          ) : null}

          {micProblem && !micSheet ? (
            <p role="alert" className="notice notice-danger">
              {micProblem.message}
            </p>
          ) : null}
          {choice.fellBack && controls.mic && !micSheet ? <p className="notice">The microphone you chose is not plugged in. Using the default one.</p> : null}

          {blocked ? (
            <button type="button" className="btn btn-primary btn-lg gist-btn" onClick={() => void audio.current?.startAudio().then(() => setBlocked(false))}>
              Tap to hear the Gist
            </button>
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
            {role === 'listener' && !controls.request && !controls.cancelRequest ? <span className="gist-note gist-main">The host is not taking requests to speak.</span> : null}
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

      <Sheet open={reportSheet} onClose={() => setReportSheet(false)} title="Report this Gist">
        <ReportGist gistId={id} onDone={() => setReportSheet(false)} />
      </Sheet>
      <Sheet open={micSheet} onClose={() => setMicSheet(false)} title="Microphone settings">
        <MicPanel
          settings={micSettings}
          devices={devices}
          noDevice={noDevice}
          fellBack={choice.fellBack}
          failure={micProblem}
          live={micOn}
          level={level}
          onChange={changeMicSettings}
        />
      </Sheet>
    </div>
  )
}
