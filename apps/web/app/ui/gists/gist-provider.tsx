'use client'

// The Gist the member is in, held above the pages (in the (main) layout), so its sound
// goes on while they read the rest of the site: the LiveKit room, the join / reconnect /
// leave state machine (lib/gist-session.ts), the polling that follows the room, and the
// microphone. The room's page (gist-room.tsx) draws it; the Gists button in the top bar
// and the bar over every other page (gist-dock.tsx) show it from anywhere.
//
// One Gist at a time: joining another leaves the first. Joining is always a tap on the
// room's Join button, because browsers let a page start sound only from one. A full
// reload, closing the tab, or leaving the app's pages (signing out) leaves, as before.
// While the member is in a Gist, the system's media controls show it (Media Session),
// and pausing there silences it here without leaving (lib/gist-media.ts).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Quality } from '@/lib/gist-connection'
import { GIST_ALBUM, GIST_ARTWORK, gistMediaText, silentWav } from '@/lib/gist-media'
import {
  chooseDevice,
  DEFAULT_MIC,
  MIC_SETTINGS_KEY,
  micFailure,
  readMicSettings,
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
  isInGist,
  lostNotice,
  nextPollDelay,
  type GistView,
  type JoinResult,
  type Snapshot,
  type SpeakRequest,
} from '@/lib/gists'
import { gistCall } from './api'
import type { GistAudio } from './audio'
import { refreshLiveGists } from './live-gists'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/**
 * Whether the member is looking at the Gist's own page. Read from the address when
 * something happens, not with usePathname: this provider sits above every page, and a
 * route hook here would keep the whole layout from being prerendered.
 */
const onGistPage = (id: string) => window.location.pathname === `/gists/${id}`

/** The Gist the provider holds: the one the member joined, from the tap on Join until they leave it or join another. */
export type HeldGist = {
  id: string
  /** `gistStage` from /v1/me: false for a member who may only listen. */
  mayTakeStage: boolean
  view: GistView
  phase: Phase
  problem: string | null
  /** The browser would not start the sound by itself: a tap must. */
  blocked: boolean
  speaking: string[]
  requests: SpeakRequest[]
  mics: Record<string, boolean>
  quality: Record<string, Quality>
  noiseRemoval: boolean | null
  micOn: boolean
  micBusy: boolean
  micProblem: MicFailure | null
  /** False while paused: still in the Gist, hearing nothing. */
  hearing: boolean
  /** Why the member is no longer in it, when that happened away from its page; shown on the bar. */
  notice: string | null
}

export type GistContextValue = {
  room: HeldGist | null
  micSettings: MicSettings
  devices: InputDevice[]
  noDevice: boolean
  /** The chosen input fell back to the default one: it is not plugged in. */
  fellBack: boolean
  /** Names the microphone settings in force, so the level meter can follow a change. */
  micKey: string
  /** Joins `view`'s Gist, leaving any other first. Call it straight from the tap. */
  join: (view: GistView, mayTakeStage: boolean) => Promise<void>
  leave: () => Promise<void>
  toggleMic: () => Promise<void>
  /** Pause (false) or play (true): the sound stops here only, and the member stays in. */
  setHearing: (on: boolean) => void
  /** From a tap: starts sound the browser held back, and undoes a pause. */
  hear: () => Promise<void>
  changeMicSettings: (next: MicSettings) => void
  /** After something the member did: views requested before now are out of date, so fetch a fresh one. */
  refreshAfterAction: () => Promise<void>
  announce: (text: string) => void
  dismissNotice: () => void
  /** The live connection, for the room's level meter and Connection sheet. */
  audio: () => GistAudio | null
}

const GistContext = createContext<GistContextValue | null>(null)

export function useGist(): GistContextValue {
  const value = useContext(GistContext)
  if (!value) throw new Error('useGist needs a GistProvider above it (the (main) layout has one)')
  return value
}

export function GistProvider({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState<HeldGist | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [micSettings, setMicSettings] = useState<MicSettings>(DEFAULT_MIC)
  const [devices, setDevices] = useState<InputDevice[]>([])
  const [noDevice, setNoDevice] = useState(false)

  /** The SDK attaches one <audio> per speaker in here, a box per connection. */
  const container = useRef<HTMLDivElement>(null)
  const session = useRef<GistSession | null>(null)
  const audio = useRef<GistAudio | null>(null)
  // What the session's callbacks and the poll need now, not as of the render that made them.
  const idRef = useRef<string | null>(null)
  const phaseRef = useRef<Phase | null>(null)
  const micRef = useRef(false)
  const busyRef = useRef(false)
  const hearingRef = useRef(true)
  const snapshot = useRef<Snapshot>({ role: null, status: 'live' })
  const latest = useRef(createLatest())
  const wake = useRef<WakeLockSentinel | null>(null)
  const carrier = useRef<HTMLAudioElement | null>(null)
  const firstDeviceList = useRef(true)

  const announce = useCallback((text: string) => setAnnouncement(text), [])
  const update = useCallback((id: string, patch: Partial<HeldGist>) => setRoom((r) => (r && r.id === id ? { ...r, ...patch } : r)), [])

  // The chosen input if it is still plugged in, else the default one.
  const choice = chooseDevice(devices, micSettings.deviceId)
  const effective: MicSettings = { ...micSettings, deviceId: choice.deviceId }
  const micKey = `${effective.deviceId}|${Number(effective.noiseSuppression)}${Number(effective.echoCancellation)}${Number(effective.autoGainControl)}`

  // ---- the silent sound that gives the Gist a place in the media controls ----------

  function playCarrier() {
    if (typeof Audio === 'undefined') return
    if (!carrier.current) {
      const el = new Audio(URL.createObjectURL(new Blob([silentWav()], { type: 'audio/wav' })))
      el.loop = true
      carrier.current = el
    }
    // Refused (no tap to go on): the Gist plays all the same, just without the controls.
    void carrier.current.play().catch(() => undefined)
  }
  const pauseCarrier = () => carrier.current?.pause()

  // ---- the state machine, wired to this provider -----------------------------------

  function setMic(id: string, on: boolean) {
    micRef.current = on
    update(id, { micOn: on })
  }

  function phaseChange(id: string, next: Phase) {
    const before = phaseRef.current
    phaseRef.current = next
    const live = next === 'live' || next === 'reconnecting'
    if (!live) micRef.current = false
    // Said on the bar only when it happens away from the room, which says it for itself.
    const note = onGistPage(id) ? null : lostNotice(before, next)
    setRoom((r) => (r && r.id === id ? { ...r, phase: next, micOn: live && r.micOn, notice: isInGist(next) ? null : (note ?? r.notice) } : r))
    if (note) announce(note)
    if (!isInGist(next)) pauseCarrier()
    // In or out: the Live now counts (and whether it is still live) are worth asking again now.
    if (isInGist(before) !== isInGist(next)) refreshLiveGists()
  }

  /** Forgets the Gist: nothing held, nothing on the bar or in the media controls. */
  function release() {
    idRef.current = null
    phaseRef.current = null
    micRef.current = false
    hearingRef.current = true
    pauseCarrier()
    setRoom(null)
  }

  function createSession(id: string): GistSession {
    let made: GistSession | null = null
    // A session that has been replaced (another Gist joined) or left changes nothing on screen.
    const mine = () => made !== null && session.current === made
    const patch = (p: Partial<HeldGist>) => {
      if (mine()) update(id, p)
    }
    made = new GistSession({
      join: () => gistCall<JoinResult>('POST', `/${id}/join`),
      // The server grants the microphone to a speaker only after this; the poll repeats it if it is lost.
      sync: () => void gistCall('POST', `/${id}/sync`),
      // keepalive lets it finish while the page is closing.
      leave: () => void fetch(`/api/v1/gists/${id}/leave`, { method: 'POST', keepalive: true }).catch(() => undefined),
      createAudio: async (events) => {
        // The one place the SDK is fetched: a separate chunk, only after a tap.
        const { createAudio } = await import('./audio')
        const host = container.current
        if (!host) throw new Error('the page is gone')
        const into = document.createElement('div')
        host.appendChild(into)
        const created = createAudio(into, events)
        created.setHearing(hearingRef.current)
        const disconnect = created.disconnect
        created.disconnect = async () => {
          if (audio.current === created) audio.current = null
          await disconnect()
          into.remove()
        }
        audio.current = created
        return created
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
      reloadPage: () => goneAway(made, id),
      ui: {
        phase: (next) => {
          if (mine()) phaseChange(id, next)
        },
        problem: (problem) => patch({ problem }),
        joined: (result) => {
          if (!mine()) return
          update(id, { view: result.gist })
          snapshot.current = { role: result.role, status: result.gist.status }
        },
        announce: (text) => {
          if (mine()) announce(text)
        },
        playbackBlocked: (blocked) => patch({ blocked }),
        speaking: (speaking) => patch({ speaking }),
        micOff: () => {
          if (mine()) setMic(id, false)
        },
        mics: (mics) => patch({ mics }),
        quality: (quality) => patch({ quality }),
        noise: (noiseRemoval) => patch({ noiseRemoval }),
      },
    })
    return made
  }

  /**
   * The Gist is no longer there for this member (removed, or no longer visible). On its
   * page, a reload shows the normal not-found page, as before; anywhere else that would
   * throw away what they are reading, so they leave it and the bar says so.
   */
  function goneAway(s: GistSession | null, id: string) {
    if (onGistPage(id)) return window.location.reload()
    if (!s || session.current !== s) return
    void s.leave()
    phaseChange(id, 'gone')
  }

  const join = async (initial: GistView, mayTakeStage: boolean) => {
    // First, while still inside the tap: browsers let a page start sound only from one.
    playCarrier()
    const id = initial.id
    if (idRef.current !== id || !session.current) {
      // One Gist at a time: out of the one the member is in before into this one.
      const before = session.current
      session.current = null
      if (before) await before.leave()
      idRef.current = id
      phaseRef.current = 'prejoin'
      micRef.current = false
      snapshot.current = { role: initial.viewer.role, status: initial.status }
      latest.current = createLatest()
      setRoom({
        id,
        mayTakeStage,
        view: initial,
        phase: 'prejoin',
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
        notice: null,
      })
      session.current = createSession(id)
    }
    hearingRef.current = true
    update(id, { hearing: true, notice: null, micProblem: null })
    if (typeof RTCPeerConnection === 'undefined') {
      update(id, { problem: 'This browser cannot play Gists. Try a recent Chrome, Firefox, Safari or Edge.' })
      phaseChange(id, 'failed')
      return
    }
    await session.current?.join()
  }

  const leave = async () => {
    const s = session.current
    session.current = null
    release()
    await s?.leave()
    if (!s) return
    announce('You left the Gist.')
    refreshLiveGists()
  }

  const setHearing = (on: boolean) => {
    const id = idRef.current
    if (!id || !isInGist(phaseRef.current) || hearingRef.current === on) return
    hearingRef.current = on
    update(id, { hearing: on })
    audio.current?.setHearing(on)
    if (on) playCarrier()
    else pauseCarrier()
    // Nobody talks into a room they are not listening to.
    if (!on && micRef.current) {
      void audio.current?.setMic(false, effective, micKey).catch(() => undefined)
      setMic(id, false)
    }
    announce(on ? 'Playing the Gist.' : 'Paused. You are still in the Gist.')
  }
  const setHearingRef = useRef(setHearing)
  useEffect(() => {
    setHearingRef.current = setHearing
  })

  const hear = async () => {
    const id = idRef.current
    if (!id) return
    playCarrier()
    setHearing(true)
    if (room?.blocked) {
      await audio.current?.startAudio().catch(() => undefined)
      update(id, { blocked: false })
    }
  }

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    setNoDevice(inputs.length === 0)
    // Before the microphone is allowed, browsers list inputs without ids; they appear after the first Unmute.
    setDevices(inputs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ deviceId: d.deviceId, label: d.label })))
  }, [])

  const toggleMic = async () => {
    const id = idRef.current
    const a = audio.current
    if (!id || !a || busyRef.current) return
    update(id, { micProblem: null })
    const want = !micRef.current
    if (want) setHearing(true)
    busyRef.current = true
    update(id, { micBusy: true })
    try {
      await a.setMic(want, effective, micKey)
      setMic(id, want)
      announce(want ? 'Microphone on.' : 'You are muted.')
      // Device names appear once the browser has let us use the microphone.
      if (want) void refreshDevices()
    } catch (err) {
      setMic(id, false)
      update(id, { micProblem: micFailure(err) })
    } finally {
      busyRef.current = false
      update(id, { micBusy: false })
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

  // ---- polling (there is no realtime channel) ------------------------------------

  async function poll(): Promise<boolean> {
    const s = session.current
    const id = idRef.current
    if (!s || !id) return true
    const ticket = latest.current.begin()
    const res = await gistCall<GistView>('GET', `/${id}`)
    if (session.current !== s) return true
    if (!res.ok) {
      if (res.status === 404) goneAway(s, id)
      return false
    }
    // An older response, or one fetched before the member's last action, must not overwrite a newer view.
    if (!latest.current.accept(ticket)) return true
    const next = applyView(snapshot.current, res.data)
    snapshot.current = { role: next.role, status: next.status }
    update(id, { view: res.data })
    if (next.announcement) announce(next.announcement)
    if (next.ended) {
      await s.finish()
      return true
    }
    if (next.resync) {
      // A demotion takes the microphone: switch it off here too, then ask the server to match LiveKit to the role.
      if (res.data.viewer.role === 'listener' && micRef.current) {
        await audio.current?.setMic(false, DEFAULT_MIC, '').catch(() => undefined)
        setMic(id, false)
      }
      void gistCall('POST', `/${id}/sync`)
    }
    const r = res.data.viewer.role
    if (r === 'host' || r === 'cohost') {
      const queue = await gistCall<{ items: SpeakRequest[] }>('GET', `/${id}/requests`)
      if (queue.ok && session.current === s) update(id, { requests: queue.data.items })
    } else {
      update(id, { requests: [] })
    }
    return true
  }
  const pollRef = useRef(poll)
  useEffect(() => {
    pollRef.current = poll
  })

  const refreshAfterAction = useCallback(async () => {
    latest.current.noteAction()
    await pollRef.current()
  }, [])

  const polling = room !== null && (room.phase === 'live' || room.phase === 'reconnecting')
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

  // ---- the page around it ----------------------------------------------------------

  useEffect(() => {
    const onHide = () => session.current?.pageHide()
    // Back from the back/forward cache: the connection was dropped on the way out.
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) session.current?.pageShow()
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      // Leaving the app's pages altogether (signing out, the sign-in pages) leaves, as closing the tab does.
      const s = session.current
      if (!s) return
      session.current = null
      s.dispose()
      idRef.current = null
      phaseRef.current = null
      micRef.current = false
      carrier.current?.pause()
      setRoom(null)
    }
  }, [])

  // ---- the microphone ---------------------------------------------------------------

  const mayUseMic = room !== null && controlsFor({ ...room.view, mayTakeStage: room.mayTakeStage }).mic

  // What the member chose last time on this browser.
  useEffect(() => {
    try {
      setMicSettings(readMicSettings(localStorage.getItem(MIC_SETTINGS_KEY)))
    } catch {
      // No storage: the defaults.
    }
  }, [])

  // The list of inputs, kept current as headsets come and go.
  useEffect(() => {
    if (!polling || !mayUseMic) return
    void refreshDevices()
    const media = navigator.mediaDevices
    media?.addEventListener?.('devicechange', refreshDevices)
    return () => media?.removeEventListener?.('devicechange', refreshDevices)
  }, [polling, mayUseMic, refreshDevices])

  // A saved input that was not there when the visit began is forgotten (lib/gist-mic.ts).
  useEffect(() => {
    if (devices.length === 0 || !firstDeviceList.current) return
    firstDeviceList.current = false
    if (staleSavedDevice(devices, micSettings.deviceId, true)) changeMicSettings({ ...micSettings, deviceId: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices])

  // A live microphone follows the settings: a new device or switch restarts it; losing every input mutes it.
  const micOn = room?.micOn ?? false
  useEffect(() => {
    const id = idRef.current
    if (!micOn || !id) return
    if (noDevice) {
      void audio.current?.setMic(false, effective, micKey).catch(() => undefined)
      setMic(id, false)
      update(id, { micProblem: micFailure({ name: 'NotFoundError' }) })
      announce('Your microphone was unplugged. You are muted.')
      return
    }
    // A no-op unless the device or a switch differs from what the live track was started with.
    audio.current?.applyMic(effective, micKey).catch((err) => {
      setMic(id, false)
      update(id, { micProblem: micFailure(err) })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn, noDevice, micKey])

  // ---- the system's media controls --------------------------------------------------

  const inside = room !== null && isInGist(room.phase)
  const shown = room && inside ? gistMediaText(room.view, { micOn, reconnecting: room.phase === 'reconnecting' }) : null
  const shownTitle = shown?.title
  const shownArtist = shown?.artist

  useEffect(() => {
    if (!shownTitle || !shownArtist || !('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: shownTitle, artist: shownArtist, album: GIST_ALBUM, artwork: GIST_ARTWORK })
  }, [shownTitle, shownArtist])

  useEffect(() => {
    if (!inside || !('mediaSession' in navigator)) return
    const media = navigator.mediaSession
    const handle = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        media.setActionHandler(action, handler)
      } catch {
        // An action this browser does not know.
      }
    }
    handle('play', () => setHearingRef.current(true))
    handle('pause', () => setHearingRef.current(false))
    // A live room has no position: nothing to seek, skip or stop to.
    return () => {
      handle('play', null)
      handle('pause', null)
      media.metadata = null
      media.playbackState = 'none'
    }
  }, [inside])

  const hearing = room?.hearing ?? true
  useEffect(() => {
    if (inside && 'mediaSession' in navigator) navigator.mediaSession.playbackState = hearing ? 'playing' : 'paused'
  }, [inside, hearing])

  const value: GistContextValue = {
    room,
    micSettings,
    devices,
    noDevice,
    fellBack: choice.fellBack,
    micKey,
    join,
    leave,
    toggleMic,
    setHearing,
    hear,
    changeMicSettings,
    refreshAfterAction,
    announce,
    dismissNotice: () => {
      if (room) update(room.id, { notice: null })
    },
    audio: () => audio.current,
  }

  return (
    <GistContext.Provider value={value}>
      {children}
      <div ref={container} hidden />
      {/* What happens in the Gist, for screen readers, on whichever page the member is reading. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </GistContext.Provider>
  )
}
