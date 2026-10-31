'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { GearIcon, MicIcon, MicOffIcon, PhoneOffIcon } from '@/app/ui/icons'
import { Sheet } from '@/app/ui/gists/sheet'
import { MicPanel } from '@/app/ui/gists/mic-panel'
import { apiCall } from '@/app/ui/gists/api'
import type { GistAudio } from '@/app/ui/gists/audio'
import { Elapsed, LevelMeter } from '@/app/ui/gists/stage'
import { callOutcome, ringSecondsLeft, type CallToken, type CallView } from '@/lib/calls'
import {
  chooseDevice,
  DEFAULT_MIC,
  MIC_SETTINGS_KEY,
  micFailure,
  readMicSettings,
  smoothLevel,
  writeMicSettings,
  type InputDevice,
  type MicFailure,
  type MicSettings,
} from '@/lib/gist-mic'
import { GistSession, type Phase } from '@/lib/gist-session'
import { personName } from '@/lib/gists'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const POLL_MS = 3000
const POLL_HIDDEN_MS = 10_000

/**
 * The in-call screen: one other person, a mute button, the microphone settings,
 * and hang up. The connection is the Gists session (join, reconnect, duplicate
 * identity, leave on pagehide) with the call token endpoint as its "join".
 */
export function CallRoom({ initial }: { initial: CallView }) {
  const router = useRouter()
  const id = initial.id
  const [view, setView] = useState(initial)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [announcement, setAnnouncement] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [micProblem, setMicProblem] = useState<MicFailure | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [level, setLevel] = useState(0)
  const [micSettings, setMicSettings] = useState<MicSettings>(DEFAULT_MIC)
  const [devices, setDevices] = useState<InputDevice[]>([])
  const [noDevice, setNoDevice] = useState(false)
  const [micSheet, setMicSheet] = useState(false)
  const [now, setNow] = useState<number | null>(null)

  const audio = useRef<GistAudio | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const session = useRef<GistSession<CallToken> | null>(null)
  const micRef = useRef(false)
  const wake = useRef<WakeLockSentinel | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const announce = useCallback((text: string) => setAnnouncement(text), [])
  const over = view.status !== 'ringing' && view.status !== 'active'
  const connected = phase === 'live' || phase === 'reconnecting'
  const choice = chooseDevice(devices, micSettings.deviceId)
  const effective: MicSettings = { ...micSettings, deviceId: choice.deviceId }
  const effKey = `${effective.deviceId}|${Number(effective.noiseSuppression)}${Number(effective.echoCancellation)}${Number(effective.autoGainControl)}`

  const setMic = (on: boolean) => {
    micRef.current = on
    setMicOn(on)
  }

  function getSession(): GistSession<CallToken> {
    if (!session.current) {
      session.current = new GistSession<CallToken>({
        join: () => apiCall<CallToken>('POST', `/v1/calls/${id}/token`),
        sync: () => undefined,
        // Leaving the page ends the call, like hanging up. keepalive lets it finish while the page closes.
        leave: () => void fetch(`/api/v1/calls/${id}/end`, { method: 'POST', keepalive: true }).catch(() => undefined),
        createAudio: async (events) => {
          // The one place the SDK is fetched: its own chunk, only on the call page.
          const { createAudio } = await import('@/app/ui/gists/audio')
          const into = container.current
          if (!into) throw new Error('the call is gone')
          const made = createAudio(into, events)
          audio.current = made
          return made
        },
        rememberGist: () => undefined,
        holdScreen: async () => {
          try {
            wake.current = (await navigator.wakeLock?.request('screen')) ?? null
          } catch {
            // Denied or unsupported: the "keep this screen open" note is the fallback.
          }
          return () => {
            void wake.current?.release().catch(() => undefined)
            wake.current = null
          }
        },
        sleep,
        // A refused token ("no longer available", never why): the call is over for us.
        reloadPage: () => {
          setView((v) => (v.status === 'ringing' || v.status === 'active' ? { ...v, status: 'ended' } : v))
          setPhase('ended')
        },
        ui: {
          phase: (next) => {
            setPhase(next)
            if (next !== 'live' && next !== 'reconnecting') setMic(false)
          },
          problem: setProblem,
          joined: (result) => setView(result.call),
          announce,
          playbackBlocked: setBlocked,
          speaking: () => undefined,
          micOff: () => setMic(false),
          mics: () => undefined,
        },
      })
    }
    return session.current
  }

  // Join as soon as the page opens: the tap on Call or Accept was the member's go-ahead.
  useEffect(() => {
    if (initial.status !== 'ringing' && initial.status !== 'active') {
      setPhase('ended')
      return
    }
    const s = getSession()
    s.open()
    if (typeof RTCPeerConnection === 'undefined') {
      setPhase('failed')
      setProblem('This browser cannot make calls. Try a recent Chrome, Firefox, Safari or Edge.')
    } else {
      void s.join()
    }
    const onHide = () => s.pageHide()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      s.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the call: the other side may answer, decline or hang up. There is no realtime channel.
  useEffect(() => {
    if (over) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const tick = async () => {
      const res = await apiCall<CallView>('GET', `/v1/calls/${id}`)
      if (stopped) return
      if (res.ok) {
        const before = viewRef.current.status
        setView(res.data)
        if (before === 'ringing' && res.data.status === 'active') announce('Connected.')
        if (res.data.status !== 'ringing' && res.data.status !== 'active') {
          const outcome = callOutcome(res.data.status, res.data.role)
          if (outcome) announce(outcome.title)
          setMic(false)
          await session.current?.finish()
          return
        }
      } else if (res.status === 404) {
        setView((v) => ({ ...v, status: v.status === 'ringing' ? 'missed' : 'ended' }))
        await session.current?.finish()
        return
      }
      schedule()
    }
    const schedule = () => {
      if (stopped) return
      timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_MS)
    }
    schedule()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [id, over, announce])

  // The ring countdown.
  useEffect(() => {
    if (view.status !== 'ringing') return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [view.status])

  async function toggleMic(force?: boolean) {
    setMicProblem(null)
    const want = force ?? !micOn
    try {
      await audio.current?.setMic(want, effective, effKey)
      setMic(want)
      announce(want ? 'Microphone on.' : 'You are muted.')
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
    setDevices(inputs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ deviceId: d.deviceId, label: d.label })))
  }, [])

  useEffect(() => {
    try {
      setMicSettings(readMicSettings(localStorage.getItem(MIC_SETTINGS_KEY)))
    } catch {
      // No storage: defaults.
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    void refreshDevices()
    const media = navigator.mediaDevices
    media?.addEventListener?.('devicechange', refreshDevices)
    return () => media?.removeEventListener?.('devicechange', refreshDevices)
  }, [connected, refreshDevices])

  // A live microphone follows the settings; losing every input mutes it.
  useEffect(() => {
    if (!micOn) return
    if (noDevice) {
      void audio.current?.setMic(false, effective, effKey).catch(() => undefined)
      setMic(false)
      setMicProblem(micFailure({ name: 'NotFoundError' }))
      announce('Your microphone was unplugged. You are muted.')
      return
    }
    audio.current?.applyMic(effective, effKey).catch((err) => {
      setMic(false)
      setMicProblem(micFailure(err))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn, noDevice, effKey])

  // The input level, in the settings sheet and under the person's name.
  useEffect(() => {
    if (!micOn) {
      setLevel(0)
      return
    }
    let value = 0
    let shown = 0
    const stop = audio.current?.watchLevel((raw) => {
      value = smoothLevel(value, raw)
      if (Math.abs(value - shown) > 0.03 || value === 0) {
        shown = value
        setLevel(value)
      }
    })
    return () => stop?.()
  }, [micOn, effKey])

  /** Hang up, or cancel while it rings: the API treats both as "end". */
  async function hangUp() {
    await apiCall('POST', `/v1/calls/${id}/end`)
    await getSession().leave()
    router.push('/')
  }

  async function retry() {
    setProblem(null)
    await getSession().join()
  }

  const name = personName(view.other)
  const outcome = callOutcome(view.status, view.role)
  const secondsLeft = now !== null ? ringSecondsLeft(view.ringExpiresAt, now) : null
  const ringing = view.status === 'ringing'

  return (
    <div className="page-stack call-room">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* The SDK attaches the other person's <audio> here. */}
      <div ref={container} hidden />

      <section className="square-card call-card" aria-labelledby="call-heading">
        <span className={`call-avatar ${ringing ? 'is-ringing' : ''}`}>
          <Avatar handle={view.other.handle} size={96} />
        </span>
        <h1 id="call-heading" className="page-title call-name">
          {name}
        </h1>
        {view.other.displayName ? <p className="text-sm text-muted">@{view.other.handle}</p> : null}

        {outcome ? (
          <div role="status" className="call-state">
            <p className="section-title">{outcome.title}</p>
            <p className="mt-1 text-sm text-muted">{outcome.detail}</p>
          </div>
        ) : ringing ? (
          <p className="call-state text-sm" role="status">
            {view.role === 'caller' ? `Calling ${name}…` : `${name} is calling…`}
            {secondsLeft !== null ? <span className="text-muted"> {secondsLeft}s</span> : null}
          </p>
        ) : (
          <p className="call-state text-sm">
            <span className="call-timer">
              <Elapsed startedAt={view.answeredAt} />
            </span>
            {phase === 'connecting' ? ' Connecting…' : ''}
          </p>
        )}

        {!over && phase === 'connecting' ? <p className="text-sm text-muted">When you tap Microphone, your browser will ask to use it so {name} can hear you.</p> : null}
        {!over && connected ? <p className="text-sm text-muted">Keep this screen open. Calls are not recorded.</p> : null}
        {/* The microphone is never started for the member: the browser asks only after they tap. */}
        {!over && connected && !micOn ? <p className="text-sm">Tap Microphone when you are ready to talk. {name} cannot hear you until you do.</p> : null}
        {micOn ? <LevelMeter level={level} /> : null}
      </section>

      {phase === 'reconnecting' ? (
        <p role="status" className="notice">
          Reconnecting… keep this screen open.
        </p>
      ) : null}
      {problem && !over ? (
        <p role="alert" className="notice notice-danger">
          {problem}
        </p>
      ) : null}
      {micProblem && !micSheet ? (
        <p role="alert" className="notice notice-danger">
          {micProblem.message} You can still hear {name}.
        </p>
      ) : null}
      {phase === 'elsewhere' ? (
        <section className="square-card gist-section" role="alert">
          <h2 className="section-title">This call is open in another tab or device</h2>
          <p className="mt-2 text-sm text-muted">A call can only be in one place at a time. To move it here, tap the button.</p>
          <button type="button" className="btn btn-primary gist-btn mt-4" onClick={() => void retry()}>
            Use it here
          </button>
        </section>
      ) : null}
      {phase === 'failed' && !over ? (
        <button type="button" className="btn btn-primary gist-btn" onClick={() => void retry()}>
          Try again
        </button>
      ) : null}
      {blocked && !over ? (
        <button type="button" className="btn btn-primary btn-lg gist-btn" onClick={() => void audio.current?.startAudio().then(() => setBlocked(false))}>
          Tap to hear {name}
        </button>
      ) : null}

      {over ? (
        <Link href="/" className="btn btn-primary gist-btn">
          Back to Home
        </Link>
      ) : (
        <div className="gist-bar square-card" role="group" aria-label="Call controls">
          <button
            type="button"
            className={`btn gist-btn gist-main ${micOn ? 'btn-primary' : 'btn-secondary'}`}
            // One fixed name; the pressed state says on or off, so it is never announced twice.
            aria-pressed={micOn}
            disabled={!connected}
            onClick={() => void toggleMic()}
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
          <button type="button" className="btn btn-danger gist-btn" onClick={() => void hangUp()}>
            <PhoneOffIcon size={20} />
            {ringing && view.role === 'caller' ? 'Cancel' : 'Hang up'}
          </button>
        </div>
      )}

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
