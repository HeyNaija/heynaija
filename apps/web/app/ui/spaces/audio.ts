// The only file that imports livekit-client. space-room.tsx loads it with a dynamic
// import() when someone taps Join, so the SDK is a separate chunk that the feed,
// the profile and every other page never download (ADR 0017 section 6).
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track } from 'livekit-client'
import type { AudioEvents, LostReason } from '@/lib/space-session'

/** Why LiveKit ended the connection, in the terms the room acts on: only a network drop is worth retrying. */
export function lostReason(reason: DisconnectReason | undefined): LostReason {
  if (reason === DisconnectReason.DUPLICATE_IDENTITY) return 'duplicate'
  if (reason === DisconnectReason.PARTICIPANT_REMOVED) return 'removed'
  if (reason === DisconnectReason.ROOM_DELETED) return 'room_deleted'
  return 'network'
}

export function createAudio(container: HTMLElement, on: AudioEvents) {
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
    .on(RoomEvent.Disconnected, (reason) => {
      if (!closing) on.onLost(lostReason(reason))
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
