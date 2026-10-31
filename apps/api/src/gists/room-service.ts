/** What the API needs from the media server, and nothing more (docs/adr/0017). */

/** What a participant may do in the room right now. Everything else is fixed at listener-only. */
export type RoomPermissions = {
  /** Microphone only; the source list is not configurable here. */
  canPublish: boolean
  /** Listeners are hidden so the audience is not sent a list of names. */
  hidden: boolean
}

export type RoomEvent =
  | { id: string; kind: 'participant_joined' | 'participant_left'; room: string; identity: string; sid: string | null; at: Date }
  | { id: string; kind: 'room_finished'; room: string; at: Date }
  | { id: string; kind: 'other'; at: Date }

/** The participant is not (or no longer) in the room. */
export class ParticipantNotFoundError extends Error {
  constructor() {
    super('participant not in the room')
  }
}

/** The webhook's signature or body did not check out. */
export class WebhookRejectedError extends Error {}

export interface RoomService {
  /** Creates the room. `maxParticipants` counts everyone, hidden listeners included. */
  createRoom(room: string, options: { maxParticipants: number; emptyTimeoutS: number }): Promise<void>
  /** Ends the room and disconnects everyone. A room that is already gone is not an error. */
  deleteRoom(room: string): Promise<void>
  /** A short-lived token that can only listen: it never carries publish rights. */
  listenerToken(room: string, identity: string, displayName: string): Promise<string>
  /** Throws ParticipantNotFoundError if the participant is not connected. */
  setPermissions(room: string, identity: string, permissions: RoomPermissions): Promise<void>
  /** Disconnects a participant. One who is not there is not an error. */
  removeParticipant(room: string, identity: string): Promise<void>
  /** Checks the signature on a webhook delivery and reads it. Throws WebhookRejectedError. */
  readWebhook(rawBody: string, authorization: string | undefined): Promise<RoomEvent>
}

export const ROOM_SERVICE = Symbol('ROOM_SERVICE')
