// The only file that imports livekit-client. space-room.tsx loads it with a dynamic
// import() when someone taps Join, so the SDK is a separate chunk that the feed,
// the profile and every other page never download (ADR 0017 section 6).
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client'

export type AudioHandlers = {
  /** The SDK is retrying on its own with the token it has. */
  onReconnecting: () => void
  onReconnected: () => void
  /** The connection is gone and the SDK gave up (or the server closed it); the room asks the API for a new token. */
  onLost: () => void
  /** The browser is blocking playback until a tap. */
  onPlaybackBlocked: (blocked: boolean) => void
  /** Member ids of whoever is talking now. Drawn as an outline only; never announced. */
  onSpeaking: (ids: string[]) => void
  onMicOff: () => void
}

export function createAudio(container: HTMLElement, on: AudioHandlers) {
  const room = new Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, publishDefaults: { dtx: true } })
  let closing = false

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
    .on(RoomEvent.Disconnected, () => {
      if (!closing) on.onLost()
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => on.onPlaybackBlocked(!room.canPlaybackAudio))
    // The server took the microphone (a host muted or demoted us): the button must not keep saying "on".
    .on(RoomEvent.LocalTrackUnpublished, () => on.onMicOff())
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => on.onSpeaking(speakers.map((s) => s.identity)))

  return {
    async connect(url: string, token: string) {
      await room.connect(url, token)
      // Called from the tap that joined, so the browser lets sound start; if it still says no, onPlaybackBlocked shows a button.
      await room.startAudio().catch(() => undefined)
      on.onPlaybackBlocked(!room.canPlaybackAudio)
    },
    startAudio: () => room.startAudio(),
    /** Turns the microphone on or off. Turning it on is what makes the browser ask; it throws if that is refused. */
    async setMic(enabled: boolean) {
      await room.localParticipant.setMicrophoneEnabled(enabled)
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
