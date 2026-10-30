'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { GearIcon, HandIcon, LeaveIcon, LockIcon, MicIcon, MicOffIcon, PeopleIcon } from '@/app/ui/icons'
import {
  chooseDevice,
  createSpeakingAnnouncer,
  DEFAULT_MIC,
  MIC_SETTINGS_KEY,
  micFailure,
  readMicSettings,
  smoothLevel,
  writeMicSettings,
  type InputDevice,
  type MicFailure,
  type MicSettings,
} from '@/lib/space-mic'
import { SpaceSession, type Phase } from '@/lib/space-session'
import {
  applyView,
  controlsFor,
  createLatest,
  CURRENT_SPACE_KEY,
  dataUseHint,
  listenerLabel,
  nextPollDelay,
  personName,
  type JoinResult,
  type Snapshot,
  type SpaceView,
  type SpeakRequest,
} from '@/lib/spaces'
import { spaceCall } from './api'
import type { SpaceAudio } from './audio'
import { HostPanel } from './host-panel'
import { MicPanel } from './mic-panel'
import { Sheet } from './sheet'
import { Elapsed, StageGrid, type StagePerson } from './stage'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function SpaceRoom({ initial, meId }: { initial: SpaceView; meId: string }) {
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
  const [speakingNote, setSpeakingNote] = useState('')

  const audio = useRef<SpaceAudio | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const snapshot = useRef<Snapshot>({ role: initial.viewer.role, status: initial.status })
  const micRef = useRef(false)
  const wake = useRef<WakeLockSentinel | null>(null)
  const latest = useRef(createLatest())
  const session = useRef<SpaceSession | null>(null)
  const announcer = useRef(createSpeakingAnnouncer())
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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

  const setMic = (on: boolean) => {
    micRef.current = on
    setMicOn(on)
  }

  /** The join / reconnect / leave state machine (lib/space-session.ts), wired to this page. */
  function getSession(): SpaceSession {
    if (!session.current) {
      session.current = new SpaceSession({
        join: () => spaceCall<JoinResult>('POST', `/${id}/join`),
        // The server grants the microphone to a speaker only after this; the poll repeats it if it is lost.
        sync: () => void spaceCall('POST', `/${id}/sync`),
        // keepalive lets it finish while the page is closing.
        leave: () => void fetch(`/api/v1/spaces/${id}/leave`, { method: 'POST', keepalive: true }).catch(() => undefined),
        createAudio: async (events) => {
          // The one place the SDK is fetched: a separate chunk, only after a tap.
          const { createAudio } = await import('./audio')
          const into = container.current
          if (!into) throw new Error('the room is gone')
          const made = createAudio(into, events)
          audio.current = made
          return made
        },
        rememberSpace: (on) => (on ? sessionStorage.setItem(CURRENT_SPACE_KEY, id) : sessionStorage.removeItem(CURRENT_SPACE_KEY)),
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
            setView(result.space)
            snapshot.current = { role: result.role, status: result.space.status }
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
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      // Leaving by any route (a link, Back) drops the connection, the screen lock and the presence.
      s.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function join() {
    if (typeof RTCPeerConnection === 'undefined') {
      setPhase('failed')
      setProblem('This browser cannot play Spaces. Try a recent Chrome, Firefox, Safari or Edge.')
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
    const res = await spaceCall<SpaceView>('GET', `/${id}`)
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
      void spaceCall('POST', `/${id}/sync`)
    }
    const r = res.data.viewer.role
    if (r === 'host' || r === 'cohost') {
      const queue = await spaceCall<{ items: SpeakRequest[] }>('GET', `/${id}/requests`)
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
    navigator.mediaSession.metadata = new MediaMetadata({ title: view.title, artist: `Hosted by ${personName(view.host)}`, album: 'HeyNaija Spaces' })
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
    const res = await spaceCall(on ? 'PUT' : 'DELETE', `/${id}/speak-request`)
    if (!res.ok) setProblem(res.message ?? 'That did not work. Try again.')
    else announce(on ? 'Request sent. The host will see it.' : 'Request withdrawn.')
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
    <div className="page-stack space-room">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* Who started speaking, throttled; a second region so it never overwrites a role change. */}
      <div role="status" aria-live="polite" className="sr-only">
        {speakingNote}
      </div>
      {/* The SDK attaches one <audio> per speaker here. */}
      <div ref={container} hidden />

      <header className="square-card space-section space-head">
        <div className="space-head-row">
          <p className="space-live">
            {ended ? null : <span className="space-live-dot" aria-hidden="true" />}
            <span>{ended ? 'Ended' : 'Live'}</span>
            {!ended ? <Elapsed startedAt={view.startedAt} /> : null}
          </p>
          {view.locked ? (
            <span className="space-badge">
              <LockIcon size={12} /> Room locked
            </span>
          ) : null}
        </div>
        <h1 className="page-title mt-2">{view.title}</h1>
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
          <button
            type="button"
            className="btn btn-secondary space-btn space-count mt-3"
            aria-haspopup="dialog"
            // A host or co-host's list is in the host panel, which appears once they have joined.
            disabled={moderator && !polling}
            onClick={() => setListenersOpen(true)}
          >
            <PeopleIcon size={18} />
            {listenerLabel(view.listenerCount)}
          </button>
        ) : null}
      </header>

      {phase === 'prejoin' ? (
        <section className="square-card space-section" aria-labelledby="space-join-heading">
          <h2 id="space-join-heading" className="section-title">
            Ready to listen?
          </h2>
          <p className="mt-2 text-sm">
            <strong>Keep this screen open.</strong> If your phone locks or you switch to another app, the sound can stop. Audio only: no camera, and no recording.
          </p>
          <p className="mt-2 text-sm text-muted">{hint}</p>
          <p className="mt-2 text-sm text-muted">The sound starts when you tap Join. You only need your microphone if the host lets you speak.</p>
          <button type="button" className="btn btn-primary btn-lg space-btn mt-4" onClick={join}>
            Join the Space
          </button>
        </section>
      ) : null}

      {phase === 'connecting' ? (
        <p className="square-card space-section text-sm" role="status">
          Connecting… keep this screen open.
        </p>
      ) : null}

      {phase === 'failed' ? (
        <section className="square-card space-section">
          <p role="alert" className="notice notice-danger">
            {problem ?? 'Could not join the Space.'}
          </p>
          <button type="button" className="btn btn-primary space-btn mt-4" onClick={join}>
            Try again
          </button>
        </section>
      ) : null}

      {phase === 'full' || phase === 'locked' ? (
        <section className="square-card space-section" role="alert">
          <h2 className="section-title">{phase === 'full' ? 'This Space is full' : 'This Space is locked'}</h2>
          <p className="mt-2 text-sm text-muted">
            {phase === 'full' ? 'It has all the listeners it can take. Spots open up as people leave.' : 'The host has locked the room, so no new listeners can join.'}
          </p>
          <div className="space-actions mt-4">
            <button type="button" className="btn btn-primary space-btn" onClick={join}>
              Try again
            </button>
            <Link href="/" className="btn btn-secondary space-btn">
              Back to Home
            </Link>
          </div>
        </section>
      ) : null}

      {phase === 'elsewhere' ? (
        <section className="square-card space-section" role="alert">
          <h2 className="section-title">This Space is open in another tab or device</h2>
          <p className="mt-2 text-sm text-muted">You can only listen in one place at a time. The sound is playing there. To move it here, tap the button.</p>
          <button type="button" className="btn btn-primary space-btn mt-4" onClick={join}>
            Use it here
          </button>
        </section>
      ) : null}

      {phase === 'gone' ? (
        <section className="square-card space-section" role="alert">
          <h2 className="section-title">You are no longer in this Space</h2>
          <Link href="/" className="btn btn-primary space-btn mt-4">
            Back to Home
          </Link>
        </section>
      ) : null}

      {phase === 'ended' ? (
        <section className="square-card space-section" role="status">
          <h2 className="section-title">This Space has ended</h2>
          <p className="mt-2 text-sm text-muted">
            {view.peakListeners > 0 ? `Up to ${listenerLabel(view.peakListeners)} listened. ` : ''}Thanks for being part of it. Spaces are not recorded.
          </p>
          <Link href="/" className="btn btn-primary space-btn mt-4">
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

          <section className="square-card space-section" aria-labelledby="space-stage-heading">
            <h2 id="space-stage-heading" className="section-title">
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
            <button type="button" className="btn btn-primary btn-lg space-btn" onClick={() => void audio.current?.startAudio().then(() => setBlocked(false))}>
              Tap to hear the Space
            </button>
          ) : null}

          <div className="space-bar square-card" role="group" aria-label="Your controls">
            {controls.mic ? (
              <>
                <button
                  type="button"
                  className={`btn space-btn space-main ${micOn ? 'btn-primary' : 'btn-secondary'}`}
                  aria-pressed={micOn}
                  aria-label={micOn ? 'Microphone, on. Tap to mute' : 'Microphone, off. Tap to turn on'}
                  onClick={toggleMic}
                >
                  {micOn ? <MicIcon size={20} /> : <MicOffIcon size={20} />}
                  {micOn ? 'Mute' : 'Unmute'}
                </button>
                <button type="button" className="btn btn-secondary space-btn space-square" aria-haspopup="dialog" aria-label="Microphone settings" onClick={() => setMicSheet(true)}>
                  <GearIcon size={20} />
                </button>
              </>
            ) : null}
            {controls.request ? (
              <button type="button" className="btn btn-primary space-btn space-main" onClick={() => speakRequest(true)}>
                <HandIcon size={20} />
                Request to speak
              </button>
            ) : null}
            {controls.cancelRequest ? (
              <button type="button" className="btn btn-secondary space-btn space-main" onClick={() => speakRequest(false)}>
                Cancel request
              </button>
            ) : null}
            {role === 'listener' && !controls.request && !controls.cancelRequest ? <span className="space-note space-main">The host is not taking requests to speak.</span> : null}
            <button type="button" className="btn btn-secondary space-btn" onClick={leave}>
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
