// The only file that imports livekit-client. space-room.tsx loads it with a dynamic
// import() when someone taps Join, so the SDK is a separate chunk that the feed,
// the profile and every other page never download (ADR 0017 section 6).
//
// The microphone path is a clean pass-through: the browser's own capture
// processing (noise suppression, echo cancellation, auto gain) can be switched, and
// that is all. No effects, no pitch shifting (ADR 0017, open question 14).
import { ConnectionState, DisconnectReason, type LocalAudioTrack, Room, RoomEvent, Track } from 'livekit-client'
import type { AudioEvents, LostReason } from '@/lib/space-session'
import { rmsLevel, type MicSettings } from '@/lib/space-mic'

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
  const room = new Room({ publishDefaults: { dtx: true } })
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

  return {
    async connect(url: string, token: string) {
      await room.connect(url, token)
      emitMics()
      // Called from the tap that joined, so the browser lets sound start; if it still says no, onPlaybackBlocked shows a button.
      await room.startAudio().catch(() => undefined)
      on.onPlaybackBlocked(!room.canPlaybackAudio)
    },
    startAudio: () => room.startAudio(),
    /** Turns the microphone on or off. Turning it on is what makes the browser ask; it throws if that is refused. */
    async setMic(enabled: boolean, settings?: MicSettings) {
      await room.localParticipant.setMicrophoneEnabled(enabled, enabled && settings ? capture(settings) : undefined)
      emitMics()
    },
    /** Applies a changed device or processing switch to a microphone that is already live. */
    async applyMic(settings: MicSettings) {
      await localTrack()?.restartTrack(capture(settings))
    },
    /**
     * Calls `onLevel` (0..1) about fifteen times a second with the loudness of the member's own
     * microphone. Read through an analyser that is not connected to any output, so it adds no echo.
     * Returns a stop function. Does nothing if the microphone is not live.
     */
    watchLevel(onLevel: (level: number) => void): () => void {
      const track = localTrack()?.mediaStreamTrack
      if (!track || typeof AudioContext === 'undefined') return () => undefined
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(new MediaStream([track]))
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        onLevel(rmsLevel(samples))
      }, 66)
      return () => {
        clearInterval(timer)
        source.disconnect()
        void ctx.close().catch(() => undefined)
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
