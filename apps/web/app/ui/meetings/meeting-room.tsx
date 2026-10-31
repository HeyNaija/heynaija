'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { GearIcon, LeaveIcon, LockIcon, MicIcon, MicOffIcon, PeopleIcon, PlusIcon } from '@/app/ui/icons'
import { apiCall } from '@/app/ui/gists/api'
import type { GistAudio } from '@/app/ui/gists/audio'
import { ConfirmButton } from '@/app/ui/gists/host-panel'
import { MicPanel } from '@/app/ui/gists/mic-panel'
import { Sheet } from '@/app/ui/gists/sheet'
import { Elapsed, LevelMeter, StageGrid, type StagePerson } from '@/app/ui/gists/stage'
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
import { invitedPeople, joinedPeople, meetingFailure, meetingOutcome, seatsLeft, type MeetingToken, type MeetingView } from '@/lib/meetings'
import { InviteSheet } from './invite-sheet'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const POLL_MS = 3000
const POLL_HIDDEN_MS = 10_000

/**
 * The meeting screen: tiles for the people in it (a ring and the word "Speaking" for whoever is
 * talking, a Muted badge for a silent microphone), the microphone toggle and settings, People,
 * and Leave. The host also has Invite, Remove, Lock and End for everyone. The connection is the Gists
 * session (join, reconnect, duplicate identity, leave on pagehide) with the meeting token endpoint as its "join".
 * The microphone is never started for the member: they tap Microphone, and the browser's prompt follows that tap.
 */
export function MeetingRoom({ initial, meId }: { initial: MeetingView; meId: string }) {
  const router = useRouter()
  const id = initial.id
  const [view, setView] = useState(initial)
  const [gone, setGone] = useState(false)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [announcement, setAnnouncement] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [micProblem, setMicProblem] = useState<MicFailure | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [level, setLevel] = useState(0)
  const [speaking, setSpeaking] = useState<string[]>([])
  const [mics, setMics] = useState<Record<string, boolean>>({})
  const [micSettings, setMicSettings] = useState<MicSettings>(DEFAULT_MIC)
  const [devices, setDevices] = useState<InputDevice[]>([])
  const [noDevice, setNoDevice] = useState(false)
  const [micSheet, setMicSheet] = useState(false)
  const [peopleSheet, setPeopleSheet] = useState(false)
  const [inviteSheet, setInviteSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hostProblem, setHostProblem] = useState<string | null>(null)

  const audio = useRef<GistAudio | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const session = useRef<GistSession<MeetingToken> | null>(null)
  const wake = useRef<WakeLockSentinel | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const started = useRef(false)

  const announce = useCallback((text: string) => setAnnouncement(text), [])
  const over = view.status === 'ended' || gone
  const inside = !over && view.me === 'joined'
  const connected = phase === 'live' || phase === 'reconnecting'
  const isHost = view.role === 'host'
  const choice = chooseDevice(devices, micSettings.deviceId)
  const effective: MicSettings = { ...micSettings, deviceId: choice.deviceId }
  const effKey = `${effective.deviceId}|${Number(effective.noiseSuppression)}${Number(effective.echoCancellation)}${Number(effective.autoGainControl)}`

  function getSession(): GistSession<MeetingToken> {
    if (!session.current) {
      session.current = new GistSession<MeetingToken>({
        join: () => apiCall<MeetingToken>('POST', `/v1/meetings/${id}/token`),
        sync: () => undefined,
        // Leaving the page leaves the meeting, like pressing Leave. keepalive lets it finish while the page closes.
        leave: () => void fetch(`/api/v1/meetings/${id}/leave`, { method: 'POST', keepalive: true }).catch(() => undefined),
        createAudio: async (events) => {
          // The one place the SDK is fetched: its own chunk, only on the meeting page.
          const { createAudio } = await import('@/app/ui/gists/audio')
          const into = container.current
          if (!into) throw new Error('the meeting is gone')
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
        noun: 'meeting',
        // A refused token ("no longer available", never why): look once to see whether it ended or we only left.
        reloadPage: () => void refreshNow(),
        ui: {
          phase: (next) => {
            setPhase(next)
            if (next !== 'live' && next !== 'reconnecting') setMic(false)
          },
          problem: setProblem,
          joined: (result) => setView(result.meeting),
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

  function setMic(on: boolean) {
    setMicOn(on)
  }

  function start() {
    if (started.current) return
    started.current = true
    const s = getSession()
    s.open()
    if (typeof RTCPeerConnection === 'undefined') {
      setPhase('failed')
      setProblem('This browser cannot join meetings. Try a recent Chrome, Firefox, Safari or Edge.')
    } else {
      void s.join()
    }
  }

  // Join as soon as the page opens if the member is already in: the tap on Join or Start was their go-ahead.
  useEffect(() => {
    if (initial.status === 'open' && initial.me === 'joined') start()
    const onHide = () => session.current?.pageHide()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      session.current?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshNow = useCallback(async () => {
    const res = await apiCall<MeetingView>('GET', `/v1/meetings/${id}`)
    if (res.ok) {
      setView(res.data)
      return res.data
    }
    if (res.status === 404) {
      setGone(true)
      setMic(false)
      await session.current?.finish()
    }
    return null
  }, [id])

  // Follow the meeting: people come and go, the host may lock it, remove someone or end it. There is no realtime channel.
  useEffect(() => {
    if (over) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const tick = async () => {
      const before = viewRef.current
      const next = await refreshNow()
      if (stopped) return
      if (next) {
        const was = new Set(joinedPeople(before).map((p) => p.id))
        const now = new Set(joinedPeople(next).map((p) => p.id))
        const said = [
          ...joinedPeople(next).filter((p) => !was.has(p.id) && p.id !== meId).map((p) => `${personName(p)} joined.`),
          ...joinedPeople(before).filter((p) => !now.has(p.id) && p.id !== meId).map((p) => `${personName(p)} left.`),
        ]
        if (said.length > 0 && before.me === 'joined') announce(said.join(' '))
        if (next.status === 'ended') {
          const outcome = meetingOutcome(next)
          if (outcome) announce(outcome.title)
          setMic(false)
          await session.current?.finish()
          return
        }
        if (next.me !== 'joined' && before.me === 'joined') {
          // Taken out of the room (not eligible any more, or the server dropped us): stop the audio, say nothing of why.
          setMic(false)
          await session.current?.finish()
          started.current = false
          return
        }
      } else if (viewRef.current.status === 'ended' || stopped) {
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
  }, [over, refreshNow, announce, meId, view.me])

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

  // The member's own input level, on their tile and in the settings sheet.
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

  async function leaveMeeting() {
    await apiCall('POST', `/v1/meetings/${id}/leave`)
    await getSession().leave()
    router.push('/')
  }

  async function endMeeting() {
    setBusy(true)
    const res = await apiCall('POST', `/v1/meetings/${id}/end`)
    setBusy(false)
    if (!res.ok) return setHostProblem(meetingFailure(res.status, res.code))
    await getSession().leave()
    router.push('/')
  }

  /** Join (or rejoin) from the card shown to someone who is invited or stepped out. */
  async function enter() {
    setBusy(true)
    setProblem(null)
    const res = await apiCall<MeetingView>('POST', `/v1/meetings/${id}/join`)
    setBusy(false)
    if (!res.ok) {
      if (res.status === 404) setGone(true)
      else setProblem(meetingFailure(res.status, res.code))
      return
    }
    setView(res.data)
    started.current = false
    start()
  }

  async function declineInvite() {
    setBusy(true)
    await apiCall('POST', `/v1/meetings/${id}/decline`)
    router.push('/')
  }

  async function host(path: string, body?: unknown, method: 'POST' | 'PUT' = 'POST') {
    setBusy(true)
    setHostProblem(null)
    const res = await apiCall<MeetingView | undefined>(method, `/v1/meetings/${id}/${path}`, body)
    setBusy(false)
    if (!res.ok) {
      setHostProblem(meetingFailure(res.status, res.code))
      return false
    }
    if (res.data) setView(res.data)
    else await refreshNow()
    return true
  }

  async function retry() {
    setProblem(null)
    await getSession().join()
  }

  const outcome = over ? (meetingOutcome({ status: 'ended' })) : null
  const hostName = personName(view.host)
  const people: StagePerson[] = joinedPeople(view).map((p) => ({ id: p.id, handle: p.handle, displayName: p.displayName, label: p.isHost ? 'Host' : undefined }))
  const waiting = invitedPeople(view)
  const left = seatsLeft(view)

  return (
    <div className="page-stack meeting-room">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* The SDK attaches the other people's <audio> here. */}
      <div ref={container} hidden />

      <section className="square-card gist-section" aria-labelledby="meeting-heading">
        <div className="meeting-head">
          <h1 id="meeting-heading" className="page-title">
            Meeting
          </h1>
          {view.locked && !over ? (
            <span className="gist-badge gist-badge-role">
              <LockIcon size={12} /> Locked
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          Hosted by {isHost ? 'you' : hostName}
          {inside ? (
            <>
              {' · '}
              {joinedPeople(view).length} of {view.capacity}
              {' · '}
              <span className="call-timer">
                <Elapsed startedAt={view.startedAt} />
              </span>
            </>
          ) : null}
        </p>

        {over ? (
          <div role="status" className="call-state">
            <p className="section-title">{gone && view.status === 'open' ? 'This meeting has ended for you' : (outcome?.title ?? 'Meeting ended')}</p>
            <p className="mt-1 text-sm text-muted">{gone && view.status === 'open' ? 'You are no longer in this meeting.' : (outcome?.detail ?? 'Meetings are not recorded.')}</p>
          </div>
        ) : inside ? (
          <>
            <StageGrid people={people} meId={meId} speaking={speaking} mics={mics} level={level} heading="People in the meeting" />
            {waiting.length > 0 ? (
              <p className="mt-3 text-sm text-muted">
                Invited, not here yet: {waiting.map((p) => personName(p)).join(', ')}
              </p>
            ) : null}
            {phase === 'connecting' ? <p className="mt-3 text-sm text-muted">Connecting… When you tap Microphone, your browser will ask to use it so others can hear you.</p> : null}
            {connected ? <p className="mt-3 text-sm text-muted">Keep this screen open. Meetings are not recorded.</p> : null}
            {/* The microphone is never started for the member: the browser asks only after they tap. */}
            {connected && !micOn ? <p className="mt-2 text-sm">Tap Microphone when you are ready to talk. Nobody can hear you until you do.</p> : null}
          </>
        ) : view.me === 'invited' ? (
          <div className="mt-3">
            <p className="text-sm">{hostName} invited you to this meeting. Joining does not turn on your microphone.</p>
            <div className="gist-actions mt-3">
              <button type="button" className="btn btn-primary gist-btn" disabled={busy} onClick={() => void enter()}>
                Join
              </button>
              <button type="button" className="btn btn-secondary gist-btn" disabled={busy} onClick={() => void declineInvite()}>
                Decline
              </button>
            </div>
          </div>
        ) : view.me === 'left' ? (
          <div className="mt-3">
            <p className="text-sm">You are not in this meeting right now.</p>
            <button type="button" className="btn btn-primary gist-btn mt-3" disabled={busy} onClick={() => void enter()}>
              Rejoin
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm">You are no longer in this meeting.</p>
        )}
      </section>

      {phase === 'reconnecting' && inside ? (
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
          {micProblem.message} You can still hear the others.
        </p>
      ) : null}
      {phase === 'elsewhere' && inside ? (
        <section className="square-card gist-section" role="alert">
          <h2 className="section-title">This meeting is open in another tab or device</h2>
          <p className="mt-2 text-sm text-muted">A meeting can only be in one place at a time. To move it here, tap the button.</p>
          <button type="button" className="btn btn-primary gist-btn mt-4" onClick={() => void retry()}>
            Use it here
          </button>
        </section>
      ) : null}
      {phase === 'failed' && inside ? (
        <button type="button" className="btn btn-primary gist-btn" onClick={() => void retry()}>
          Try again
        </button>
      ) : null}
      {blocked && inside ? (
        <button type="button" className="btn btn-primary btn-lg gist-btn" onClick={() => void audio.current?.startAudio().then(() => setBlocked(false))}>
          Tap to hear the meeting
        </button>
      ) : null}

      {over ? (
        <Link href="/" className="btn btn-primary gist-btn">
          Back to Home
        </Link>
      ) : inside ? (
        <div className="gist-bar square-card" role="group" aria-label="Meeting controls">
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
          <button type="button" className="btn btn-secondary gist-btn gist-square" aria-haspopup="dialog" aria-label={`People, ${joinedPeople(view).length} here`} onClick={() => setPeopleSheet(true)}>
            <PeopleIcon size={20} />
          </button>
          <button type="button" className="btn btn-danger gist-btn" onClick={() => void leaveMeeting()}>
            <LeaveIcon size={20} />
            Leave
          </button>
        </div>
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

      <Sheet open={peopleSheet} onClose={() => setPeopleSheet(false)} title="People">
        {hostProblem ? (
          <p role="alert" className="notice notice-danger mb-3">
            {hostProblem}
          </p>
        ) : null}
        <h3 className="gist-subhead">In the meeting ({joinedPeople(view).length} of {view.capacity})</h3>
        <ul className="gist-people">
          {joinedPeople(view).map((p) => (
            <li key={p.id} className="gist-person">
              <Avatar handle={p.handle} size={32} />
              <span className="gist-person-name">
                {personName(p)}
                {p.id === meId ? ' (you)' : ''}
                {p.isHost ? <span className="text-muted"> Host</span> : null}
              </span>
              {isHost && p.id !== meId ? (
                <ConfirmButton label="Remove" confirmLabel="Tap again to remove" name={personName(p)} disabled={busy} onConfirm={() => void host('remove', { memberId: p.id })} />
              ) : null}
            </li>
          ))}
        </ul>
        {waiting.length > 0 ? (
          <>
            <h3 className="gist-subhead">Invited</h3>
            <ul className="gist-people">
              {waiting.map((p) => (
                <li key={p.id} className="gist-person">
                  <Avatar handle={p.handle} size={32} />
                  <span className="gist-person-name">{personName(p)}</span>
                  {isHost ? (
                    <ConfirmButton label="Remove" confirmLabel="Tap again to remove" name={personName(p)} disabled={busy} onConfirm={() => void host('remove', { memberId: p.id })} />
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {isHost ? (
          <>
            <h3 className="gist-subhead">Host controls</h3>
            <div className="gist-actions">
              <button
                type="button"
                className="btn btn-secondary gist-btn"
                disabled={busy || view.locked || left === 0}
                onClick={() => {
                  setPeopleSheet(false)
                  setInviteSheet(true)
                }}
              >
                <PlusIcon size={18} />
                Invite people
              </button>
            </div>
            <label className="gist-switch">
              <input type="checkbox" checked={view.locked} disabled={busy} onChange={(event) => void host('lock', { locked: event.target.checked }, 'PUT')} />
              <span>
                <span className="font-semibold">Lock the meeting</span>
                <span className="field-hint block">Nobody new can join or be invited while it is locked. People already in stay.</span>
              </span>
            </label>
            <div className="gist-actions mt-3">
              <ConfirmButton label="End meeting for everyone" confirmLabel="Tap again to end it" disabled={busy} onConfirm={() => void endMeeting()} />
            </div>
          </>
        ) : null}
      </Sheet>

      {isHost ? (
        <InviteSheet
          open={inviteSheet}
          onClose={() => setInviteSheet(false)}
          meetingId={id}
          seatsLeft={left}
          announce={announce}
          onInvited={(next) => setView(next)}
        />
      ) : null}
    </div>
  )
}
