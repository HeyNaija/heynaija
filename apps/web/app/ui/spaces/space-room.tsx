'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { HandIcon, LeaveIcon, LiveIcon, LockIcon, MicIcon, MicOffIcon } from '@/app/ui/icons'
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
  type Person,
  type Snapshot,
  type SpaceView,
  type SpeakRequest,
} from '@/lib/spaces'
import { spaceCall } from './api'
import type { SpaceAudio } from './audio'
import { HostPanel } from './host-panel'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const MIC_BLOCKED =
  'The browser did not allow the microphone, so you are still listening. To speak, allow the microphone for this site in your browser settings, then tap again.'
const MIC_BUSY = 'The microphone did not start. Another app may be using it. You are still listening.'

export function SpaceRoom({ initial, meId }: { initial: SpaceView; meId: string }) {
  const router = useRouter()
  const id = initial.id
  const [view, setView] = useState(initial)
  const [phase, setPhase] = useState<Phase>(initial.status === 'ended' ? 'ended' : 'prejoin')
  const [announcement, setAnnouncement] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [micProblem, setMicProblem] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [speaking, setSpeaking] = useState<string[]>([])
  const [requests, setRequests] = useState<SpeakRequest[]>([])
  const [hint, setHint] = useState(() => dataUseHint(undefined))

  const audio = useRef<SpaceAudio | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const snapshot = useRef<Snapshot>({ role: initial.viewer.role, status: initial.status })
  const micRef = useRef(false)
  const wake = useRef<WakeLockSentinel | null>(null)
  const latest = useRef(createLatest())
  const session = useRef<SpaceSession | null>(null)

  const announce = useCallback((text: string) => setAnnouncement(text), [])
  const role = view.viewer.role
  const controls = controlsFor(view)
  const polling = phase === 'live' || phase === 'reconnecting'

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
        await audio.current?.setMic(false).catch(() => undefined)
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
      await audio.current?.setMic(want)
      setMic(want)
      announce(want ? 'Microphone on.' : 'You are muted.')
    } catch (err) {
      setMic(false)
      setMicProblem((err as { name?: string })?.name === 'NotAllowedError' ? MIC_BLOCKED : MIC_BUSY)
    }
  }

  async function speakRequest(on: boolean) {
    setProblem(null)
    const res = await spaceCall(on ? 'PUT' : 'DELETE', `/${id}/speak-request`)
    if (!res.ok) setProblem(res.message ?? 'That did not work. Try again.')
    else announce(on ? 'Request sent. The host will see it.' : 'Request withdrawn.')
    await refreshAfterAction()
  }

  // ---- drawing -----------------------------------------------------------------------

  const stage: (Person & { label: string })[] = [
    { ...view.host, label: 'Host' },
    ...view.speakers.map((s) => ({ ...s, label: s.role === 'cohost' ? 'Co-host' : 'Speaker' })),
  ]

  return (
    <div className="page-stack space-room">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* The SDK attaches one <audio> per speaker here. */}
      <div ref={container} hidden />

      <header className="square-card space-section">
        <p className="space-live">
          <LiveIcon size={16} />
          <span>{view.status === 'ended' || phase === 'ended' ? 'Ended' : 'Live'}</span>
          {view.community ? (
            <span className="text-muted">
              {' · '}
              <Link href={`/c/${view.community.slug}`} className="hover:underline">
                {view.community.name}
              </Link>
            </span>
          ) : null}
        </p>
        <h1 className="page-title mt-2">{view.title}</h1>
        <p className="mt-2 text-sm text-muted">
          Hosted by{' '}
          <Link href={`/u/${view.host.handle}`} className="font-semibold text-ink hover:underline">
            {personName(view.host)}
          </Link>
          {' · '}
          <span>{listenerLabel(view.listenerCount)}</span>
          {view.locked ? (
            <span className="space-locked">
              {' · '}
              <LockIcon size={14} /> Room locked
            </span>
          ) : null}
        </p>
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
            <ul className="space-people">
              {stage.map((p) => (
                <li key={p.id} className={`space-person ${speaking.includes(p.id) ? 'space-speaking' : ''}`}>
                  <Avatar handle={p.handle} size={44} />
                  <span className="space-person-name">
                    {personName(p)}
                    {p.id === meId ? ' (you)' : ''}
                    <span className="text-muted"> {p.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {role === 'host' || role === 'cohost' ? <HostPanel view={view} role={role} requests={requests} refresh={refreshAfterAction} announce={announce} /> : null}

          {micProblem ? (
            <p role="alert" className="notice notice-danger">
              {micProblem}
            </p>
          ) : null}

          <div className="space-bar square-card" role="group" aria-label="Your controls">
            {controls.mic ? (
              <button
                type="button"
                className={`btn space-btn ${micOn ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={micOn}
                aria-label={micOn ? 'Microphone, on. Tap to mute' : 'Microphone, off. Tap to turn on'}
                onClick={toggleMic}
              >
                {micOn ? <MicIcon size={20} /> : <MicOffIcon size={20} />}
                {micOn ? 'Mute' : 'Unmute'}
              </button>
            ) : null}
            {controls.request ? (
              <button type="button" className="btn btn-secondary space-btn" onClick={() => speakRequest(true)}>
                <HandIcon size={20} />
                Request to speak
              </button>
            ) : null}
            {controls.cancelRequest ? (
              <button type="button" className="btn btn-secondary space-btn" onClick={() => speakRequest(false)}>
                Cancel request
              </button>
            ) : null}
            {role === 'listener' && !controls.request && !controls.cancelRequest ? <span className="space-note">The host is not taking requests to speak.</span> : null}
            {blocked ? (
              <button type="button" className="btn btn-primary space-btn" onClick={() => void audio.current?.startAudio().then(() => setBlocked(false))}>
                Tap to hear the Space
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary space-btn ml-auto" onClick={leave}>
              <LeaveIcon size={20} />
              Leave
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
