// The join / reconnect / leave state machine of a Space room, with no React and no
// livekit-client, so the order of awaits and the "did the member leave meanwhile?"
// checks can be unit tested with fakes (tests/space-session.test.mjs).
//
// Rules it keeps:
//  - Every await in an attempt is followed by a staleness check. An attempt is
//    stale when the session was closed (Leave, unmount) or a newer attempt began.
//  - Whatever a stale attempt created is disposed, and /leave is sent once if the
//    API was told the member joined.
//  - Why a connection ended decides what happens next: a network drop reconnects
//    (capped, with backoff), a duplicate identity or a removal never does.
import { joinFailure, type JoinResult } from './spaces.ts'

export type Phase = 'prejoin' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'full' | 'locked' | 'failed' | 'elsewhere' | 'gone'
export type LostReason = 'duplicate' | 'removed' | 'room_deleted' | 'network'

export type JoinReply = { ok: true; data: JoinResult } | { ok: false; status: number; code?: string; message?: string }

export type AudioLike = {
  connect(url: string, token: string): Promise<void>
  disconnect(): Promise<void>
}

export type AudioEvents = {
  onReconnecting: () => void
  onReconnected: () => void
  onLost: (reason: LostReason) => void
  onPlaybackBlocked: (blocked: boolean) => void
  onSpeaking: (ids: string[]) => void
  onMicOff: () => void
  /** Who has a live microphone: member id to true when they are publishing and unmuted. */
  onMics: (mics: Record<string, boolean>) => void
}

export type SessionDeps = {
  join: () => Promise<JoinReply>
  sync: () => void
  /** POST /leave. Fire and forget; the session calls it at most once per presence. */
  leave: () => void
  /** Loads the media library and builds the connection. Throws if the page it plays into is gone. */
  createAudio: (events: AudioEvents) => Promise<AudioLike>
  rememberSpace: (on: boolean) => void
  /** Takes a screen wake lock; resolves to its release function. */
  holdScreen: () => Promise<() => void>
  sleep: (ms: number) => Promise<void>
  reloadPage: () => void
  ui: {
    phase: (phase: Phase) => void
    problem: (message: string | null) => void
    joined: (result: JoinResult) => void
    announce: (text: string) => void
    playbackBlocked: (blocked: boolean) => void
    speaking: (ids: string[]) => void
    micOff: () => void
    mics: (mics: Record<string, boolean>) => void
  }
}

export const RECONNECT_ATTEMPTS = 8
export const reconnectDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 15_000)

type Outcome = 'ok' | 'retry' | 'stop'

export class SpaceSession {
  private deps: SessionDeps
  private gen = 0
  private closed = false
  private ended = false
  private present = false
  private reconnecting = false
  private release: (() => void) | null = null
  audio: AudioLike | null = null

  constructor(deps: SessionDeps) {
    this.deps = deps
  }

  /** Called when the page mounts (again, under StrictMode): the session may run. */
  open() {
    this.closed = false
  }

  private stale(my: number) {
    return this.closed || my !== this.gen
  }

  /** Stops the connection and what hangs off it. Sends /leave once if the API thinks we are in and `leave` is set. */
  private async teardown(leave: boolean) {
    const audio = this.audio
    this.audio = null
    this.release?.()
    this.release = null
    this.deps.rememberSpace(false)
    if (leave && this.present) this.deps.leave()
    this.present = false
    await audio?.disconnect().catch(() => undefined)
  }

  private async bail(): Promise<Outcome> {
    if (this.closed) await this.teardown(true)
    return 'stop'
  }

  /** One join: a token from the API, the media connection, then /sync. */
  private async connectOnce(my: number): Promise<Outcome> {
    const { ui } = this.deps
    const res = await this.deps.join()
    if (res.ok) this.present = true
    if (this.stale(my)) return this.bail()
    if (!res.ok) {
      const why = joinFailure(res.status, res.code)
      if (why === 'notfound') {
        // Removed, or no longer visible: the server answers with the normal not-found page.
        this.deps.reloadPage()
        return 'stop'
      }
      if (why === 'full' || why === 'locked') {
        ui.phase(why)
        return 'stop'
      }
      if (why === 'ended') {
        await this.finish()
        return 'stop'
      }
      ui.problem(res.message ?? 'Could not reach the Space. Check your connection.')
      return 'retry'
    }
    ui.joined(res.data)
    try {
      if (!this.audio) {
        const created = await this.deps.createAudio(this.events())
        // Own it at once, so a stale attempt's teardown disconnects it.
        this.audio = created
        if (this.stale(my)) return this.bail()
      }
      await this.audio.connect(res.data.url, res.data.token)
    } catch {
      if (this.stale(my)) return this.bail()
      ui.problem('Could not connect the audio. Check your connection and try again.')
      return 'retry'
    }
    if (this.stale(my)) return this.bail()
    // The server grants the microphone to a speaker only after this; the poll repeats it if it is lost.
    this.deps.sync()
    return 'ok'
  }

  private events(): AudioEvents {
    const { ui } = this.deps
    return {
      onReconnecting: () => !this.closed && ui.phase('reconnecting'),
      onReconnected: () => !this.closed && ui.phase('live'),
      onLost: (reason) => void this.lost(reason),
      onPlaybackBlocked: ui.playbackBlocked,
      onSpeaking: ui.speaking,
      onMicOff: ui.micOff,
      onMics: ui.mics,
    }
  }

  async join(): Promise<void> {
    const { ui } = this.deps
    const my = ++this.gen
    ui.problem(null)
    ui.phase('connecting')
    const result = await this.connectOnce(my)
    if (this.stale(my)) return
    if (result === 'retry') {
      // A /join may have answered 200 before the media connection failed: do not leave a ghost listener behind.
      await this.teardown(true)
      return ui.phase('failed')
    }
    if (result === 'stop') return
    this.deps.rememberSpace(true)
    const release = await this.deps.holdScreen()
    if (this.stale(my)) {
      release()
      await this.bail()
      return
    }
    this.release = release
    ui.phase('live')
    ui.announce('You are in the Space. Keep this screen open to keep listening.')
  }

  /** The connection ended; why decides what happens next. */
  private async lost(reason: LostReason) {
    if (this.closed || this.ended) return
    const { ui } = this.deps
    if (reason === 'network') return this.reconnect()
    // Anything else is final: no automatic rejoin.
    this.gen++
    if (reason === 'room_deleted') return this.finish()
    // Another tab or device owns the presence now (duplicate), or we were removed: do not send /leave.
    this.present = false
    await this.teardown(false)
    ui.phase(reason === 'duplicate' ? 'elsewhere' : 'gone')
    ui.announce(reason === 'duplicate' ? 'This Space is open somewhere else.' : 'You are no longer in this Space.')
  }

  async reconnect(): Promise<void> {
    if (this.reconnecting || this.closed || this.ended) return
    this.reconnecting = true
    const { ui } = this.deps
    const my = ++this.gen
    try {
      ui.phase('reconnecting')
      ui.announce('Reconnecting.')
      for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
        await this.deps.sleep(reconnectDelay(attempt))
        if (this.stale(my)) return void (await this.bail())
        // Every reconnect asks the API again: a new token, and the role as it is now.
        const result = await this.connectOnce(my)
        if (this.stale(my)) return
        if (result === 'ok') {
          ui.problem(null)
          ui.phase('live')
          ui.announce('Reconnected.')
          return
        }
        if (result === 'stop') return
      }
      // Out of attempts: stop, and let the member decide. Each /join that answered 200 marked them present, so say they left.
      await this.teardown(true)
      ui.phase('failed')
    } finally {
      this.reconnecting = false
    }
  }

  /** The Space ended (poll, join refusal or room deleted). */
  async finish(): Promise<void> {
    this.ended = true
    this.gen++
    await this.teardown(false)
    this.deps.ui.phase('ended')
  }

  /** Leave button. */
  async leave(): Promise<void> {
    this.closed = true
    this.gen++
    await this.teardown(true)
  }

  /** Unmount: the same as Leave, without waiting. Reversible by open() for StrictMode's second mount. */
  dispose(): void {
    this.closed = true
    this.gen++
    void this.teardown(true)
  }

  /** The tab is going away: stop counting as present now, not when the webhook notices. */
  pageHide(): void {
    if (this.present) {
      this.present = false
      this.deps.leave()
    }
  }
}
