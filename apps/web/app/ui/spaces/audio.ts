// The only file that imports livekit-client. space-room.tsx loads it with a dynamic
// import() when someone taps Join, so the SDK is a separate chunk that the feed,
// the profile and every other page never download (ADR 0017 section 6).
//
// The microphone path is a clean pass-through: the browser's own capture
// processing (noise suppression, echo cancellation, auto gain) can be switched, and
// that is all. No effects, no pitch shifting (ADR 0017, open question 20).
import { ConnectionState, DisconnectReason, type LocalAudioTrack, Room, RoomEvent, Track, TrackEvent } from 'livekit-client'
import type { AudioEvents, LostReason } from '@/lib/space-session'
import { afterFailedRestart, micPlan, rmsLevel, type MicSettings } from '@/lib/space-mic'

/** Why LiveKit ended the connection, in the terms the room acts on: only a network drop is worth retrying. */
export function lostReason(reason: DisconnectReason | undefined): LostReason {
  if (reason === DisconnectReason.DUPLICATE_IDENTITY) return 'duplicate'
  if (reason === DisconnectReason.PARTICIPANT_REMOVED) return 'removed'
  if (reason === DisconnectReason.ROOM_DELETED) return 'room_deleted'
  return 'network'
}

const capture = (m: MicSettings) => ({
  // A plain id is a preference, not a demand: an unplugged device falls back to the default instead of failing.
  deviceId: m.deviceId ?? undefined,
  noiseSuppression: m.noiseSuppression,
  echoCancellation: m.echoCancellation,
  autoGainControl: m.autoGainControl,
})

export function createAudio(container: HTMLElement, on: AudioEvents) {
  const room = new Room({
    // stopMicTrackOnMute: muting stops the capture, so the browser's recording indicator goes off with it.
    // Unmuting asks the browser for the microphone again (a tap, so allowed); see setMic.
    publishDefaults: { dtx: true, stopMicTrackOnMute: true },
  })
  let closing = false

  const mics = () => {
    const out: Record<string, boolean> = {}
    for (const p of [room.localParticipant, ...room.remoteParticipants.values()]) out[p.identity] = p.isMicrophoneEnabled
    return out
  }
  const emitMics = () => on.onMics(mics())
  const localTrack = () => room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack as LocalAudioTrack | undefined

  room
    .on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return
      const el = track.attach()
      container.appendChild(el)
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove())
    })
    .on(RoomEvent.Reconnecting, () => on.onReconnecting())
    .on(RoomEvent.Reconnected, () => on.onReconnected())
    .on(RoomEvent.Disconnected, (reason) => {
      if (!closing) on.onLost(lostReason(reason))
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => on.onPlaybackBlocked(!room.canPlaybackAudio))
    // The server took the microphone (a host muted or demoted us): the button must not keep saying "on".
    .on(RoomEvent.LocalTrackUnpublished, () => {
      on.onMicOff()
      emitMics()
    })
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => on.onSpeaking(speakers.map((s) => s.identity)))
    // Who is muted: any change in who publishes, or in whether a published track is muted.
    .on(RoomEvent.TrackMuted, emitMics)
    .on(RoomEvent.TrackUnmuted, emitMics)
    .on(RoomEvent.TrackPublished, emitMics)
    .on(RoomEvent.TrackUnpublished, emitMics)
    .on(RoomEvent.LocalTrackPublished, emitMics)
    .on(RoomEvent.ParticipantConnected, emitMics)
    .on(RoomEvent.ParticipantDisconnected, emitMics)

  /** What the live microphone track was last started with; '' when there is none. */
  let appliedKey = ''

  /**
   * Restarts the track with new options. LiveKit stops the old track first, so if the browser
   * then refuses, nothing usable is left: mute, drop a dead track, forget the key (the next Unmute
   * publishes afresh), tell everyone, and pass the error on for the wording.
   */
  const restart = async (settings: MicSettings, key: string) => {
    try {
      await localTrack()?.restartTrack(capture(settings))
      appliedKey = key
    } catch (err) {
      appliedKey = afterFailedRestart().appliedKey
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined)
      const track = localTrack()
      if (track && track.mediaStreamTrack.readyState === 'ended') await room.localParticipant.unpublishTrack(track, true).catch(() => undefined)
      emitMics()
      throw err
    }
  }

  return {
    async connect(url: string, token: string) {
      await room.connect(url, token)
      emitMics()
      // Called from the tap that joined, so the browser lets sound start; if it still says no, onPlaybackBlocked shows a button.
      await room.startAudio().catch(() => undefined)
      on.onPlaybackBlocked(!room.canPlaybackAudio)
    },
    startAudio: () => room.startAudio(),
    /**
     * Turns the microphone on or off. `key` names the settings (device and switches) so
     * we know whether a track that already exists was started with them. Turning it on
     * is what makes the browser ask; it throws if that is refused, leaving no live track.
     */
    async setMic(enabled: boolean, settings: MicSettings, key: string) {
      if (!enabled) {
        await room.localParticipant.setMicrophoneEnabled(false)
        emitMics()
        return
      }
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
      const plan = micPlan({ appliedKey, key, hasPublication: Boolean(pub?.audioTrack), isMuted: Boolean(pub?.isMuted), wantOn: true })
      if (plan === 'publish') {
        await room.localParticipant.setMicrophoneEnabled(true, capture(settings))
        appliedKey = key
      } else if (plan === 'restart') {
        await restart(settings, key)
        await room.localParticipant.setMicrophoneEnabled(true)
      } else if (plan === 'unmute') {
        // The muted track was stopped, so this asks the browser for the microphone again. If it refuses
        // the publication stays muted (nothing is live), and the next Unmute simply tries again.
        try {
          await room.localParticipant.setMicrophoneEnabled(true)
        } catch (err) {
          emitMics()
          throw err
        }
      }
      emitMics()
    },
    /** Applies a changed device or processing switch to a microphone that is already live. */
    async applyMic(settings: MicSettings, key: string) {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
      if (micPlan({ appliedKey, key, hasPublication: Boolean(pub?.audioTrack), isMuted: false, wantOn: true }) === 'restart') await restart(settings, key)
    },
    /**
     * Calls `onLevel` (0..1) about fifteen times a second with the loudness of the member's own
     * microphone, read through an analyser that is connected to no output (so no echo). It follows
     * the track: when a device change restarts it, the meter moves to the new one, and it never reads
     * an ended track. It sleeps while the tab is hidden. Returns a stop function.
     */
    watchLevel(onLevel: (level: number) => void): () => void {
      const watched = localTrack()
      if (!watched || typeof AudioContext === 'undefined') return () => undefined
      let ctx: AudioContext | undefined
      let analyser: AnalyserNode | undefined
      let source: MediaStreamAudioSourceNode | undefined
      let timer: ReturnType<typeof setInterval> | undefined
      const detach = () => {
        clearInterval(timer)
        timer = undefined
        source?.disconnect()
        source = undefined
      }
      const attach = () => {
        detach()
        const track = watched.mediaStreamTrack
        if (document.hidden || !track || track.readyState === 'ended') return onLevel(0)
        ctx ??= new AudioContext()
        if (!analyser) {
          analyser = ctx.createAnalyser()
          analyser.fftSize = 1024
        }
        source = ctx.createMediaStreamSource(new MediaStream([track]))
        source.connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        const reader = analyser
        timer = setInterval(() => {
          reader.getFloatTimeDomainData(samples)
          onLevel(rmsLevel(samples))
        }, 66)
      }
      const onGone = () => {
        detach()
        onLevel(0)
      }
      const onVisibility = () => attach()
      watched.on(TrackEvent.Restarted, attach)
      watched.on(TrackEvent.Ended, onGone)
      document.addEventListener('visibilitychange', onVisibility)
      attach()
      return () => {
        watched.off(TrackEvent.Restarted, attach)
        watched.off(TrackEvent.Ended, onGone)
        document.removeEventListener('visibilitychange', onVisibility)
        detach()
        void ctx?.close().catch(() => undefined)
      }
    },
    get connected() {
      return room.state === ConnectionState.Connected
    },
    async disconnect() {
      closing = true
      await room.disconnect()
      container.replaceChildren()
    },
  }
}

export type SpaceAudio = ReturnType<typeof createAudio>
