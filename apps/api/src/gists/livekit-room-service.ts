import { AccessToken, RoomServiceClient, ServerError, TrackSource, WebhookReceiver } from 'livekit-server-sdk'
import {
  type ConnectedParticipant,
  ParticipantNotFoundError,
  type RoomEvent,
  type RoomPermissions,
  type RoomService,
  type RoomTimeouts,
  WebhookRejectedError,
} from './room-service.js'

export type LiveKitSettings = {
  /** ws:// or wss://; the REST calls use the same host over http(s). */
  url: string
  apiKey: string
  apiSecret: string
  /** A key of its own that signs webhooks; without one the API key does. */
  webhookKey?: string
  webhookSecret?: string
}

/** Join tokens only get you into the room; they are not a session (docs/adr/0017 section 3). */
export const TOKEN_TTL_S = 600

/**
 * The longest any server call may take. Role changes hold a database connection
 * while they wait (gists.service.ts, pushRole), so a slow LiveKit must not be
 * waited on for the SDK's default 10 seconds.
 */
export const REQUEST_TIMEOUT_S = 4

const notFound = (err: unknown): boolean => err instanceof ServerError && (err.status === 404 || err.code === 'not_found')

/** The real thing: livekit-server-sdk against a LiveKit server. */
export class LiveKitRoomService implements RoomService {
  private readonly client: RoomServiceClient
  private readonly receiver: WebhookReceiver

  constructor(private readonly settings: LiveKitSettings) {
    this.client = new RoomServiceClient(settings.url.replace(/^ws/, 'http'), settings.apiKey, settings.apiSecret, {
      requestTimeout: REQUEST_TIMEOUT_S,
    })
    this.receiver = new WebhookReceiver(settings.webhookKey ?? settings.apiKey, settings.webhookSecret ?? settings.apiSecret)
  }

  async createRoom(room: string, options: RoomTimeouts): Promise<void> {
    await this.client.createRoom({
      name: room,
      maxParticipants: options.maxParticipants,
      emptyTimeout: options.emptyTimeoutS,
      departureTimeout: options.departureTimeoutS,
    })
  }

  async deleteRoom(room: string): Promise<void> {
    try {
      await this.client.deleteRoom(room)
    } catch (err) {
      if (!notFound(err)) throw err
    }
  }

  /**
   * Every Gist token is this one: join the room, hear it, say nothing. A token
   * that outlives a role change can therefore never speak; speaking is granted
   * afterwards by `setPermissions`. Listeners join hidden so the audience is not
   * sent a list of names (LiveKit's `hidden` grant; see the report's verify list).
   */
  async listenerToken(room: string, identity: string, displayName: string): Promise<string> {
    const token = new AccessToken(this.settings.apiKey, this.settings.apiSecret, { identity, name: displayName, ttl: TOKEN_TTL_S })
    token.addGrant({
      roomJoin: true,
      room,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canPublishSources: [],
      hidden: true,
    })
    return token.toJwt()
  }

  /** The 1:1 call token: both parties publish the microphone and nothing else. */
  async participantToken(room: string, identity: string, displayName: string): Promise<string> {
    const token = new AccessToken(this.settings.apiKey, this.settings.apiSecret, { identity, name: displayName, ttl: TOKEN_TTL_S })
    token.addGrant({
      roomJoin: true,
      room,
      canSubscribe: true,
      canPublish: true,
      canPublishData: false,
      canPublishSources: [TrackSource.MICROPHONE],
    })
    return token.toJwt()
  }

  async setPermissions(room: string, identity: string, permissions: RoomPermissions): Promise<void> {
    try {
      // Permissions are replaced as a whole, so everything is spelled out each time.
      await this.client.updateParticipant(room, identity, {
        permission: {
          canSubscribe: true,
          canPublish: permissions.canPublish,
          canPublishData: false,
          canPublishSources: permissions.canPublish ? [TrackSource.MICROPHONE] : [],
          hidden: permissions.hidden,
        },
      })
    } catch (err) {
      if (notFound(err)) throw new ParticipantNotFoundError()
      throw err
    }
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    try {
      await this.client.removeParticipant(room, identity)
    } catch (err) {
      if (!notFound(err)) throw err
    }
  }

  async participants(room: string): Promise<ConnectedParticipant[] | null> {
    const [found] = await this.client.listRooms([room])
    if (!found) return null
    try {
      const list = await this.client.listParticipants(room)
      return list.map((p) => ({ identity: p.identity, sid: p.sid, canPublish: Boolean(p.permission?.canPublish), hidden: Boolean(p.permission?.hidden) }))
    } catch (err) {
      // Finished between the two calls.
      if (notFound(err)) return null
      throw err
    }
  }

  async readWebhook(rawBody: string, authorization: string | undefined): Promise<RoomEvent> {
    // Without the header the SDK would skip the check; a missing signature is a refusal.
    if (!authorization) throw new WebhookRejectedError('missing signature')
    let event
    try {
      event = await this.receiver.receive(rawBody, authorization)
    } catch (err) {
      throw new WebhookRejectedError(err instanceof Error ? err.message : 'bad signature')
    }
    const at = new Date(Number(event.createdAt) * 1000)
    const room = event.room?.name
    const identity = event.participant?.identity
    switch (event.event) {
      case 'participant_joined':
        if (room && identity) return { id: event.id, kind: 'participant_joined', room, identity, sid: event.participant?.sid || null, at }
        break
      // A connection that opened and never completed ends with this and no participant_left.
      case 'participant_connection_aborted':
      case 'participant_left':
        if (room && identity) return { id: event.id, kind: 'participant_left', room, identity, sid: event.participant?.sid || null, at }
        break
      case 'room_finished':
        if (room) return { id: event.id, kind: 'room_finished', room, at }
        break
    }
    return { id: event.id, kind: 'other', at }
  }
}

/**
 * Stands in when LiveKit is not configured. Every Gists route is already a 404
 * then, so none of this is reachable; it exists so the app can be built without
 * the settings.
 */
export class UnconfiguredRoomService implements RoomService {
  private fail(): never {
    throw new Error('LiveKit is not configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)')
  }
  createRoom = async () => this.fail()
  deleteRoom = async () => this.fail()
  listenerToken = async () => this.fail()
  participantToken = async () => this.fail()
  setPermissions = async () => this.fail()
  removeParticipant = async () => this.fail()
  participants = async () => this.fail()
  readWebhook = async () => this.fail()
}

export function roomServiceFor(env: {
  LIVEKIT_URL?: string
  LIVEKIT_API_KEY?: string
  LIVEKIT_API_SECRET?: string
  LIVEKIT_WEBHOOK_KEY?: string
  LIVEKIT_WEBHOOK_SECRET?: string
}): RoomService {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return new UnconfiguredRoomService()
  return new LiveKitRoomService({
    url: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    webhookKey: env.LIVEKIT_WEBHOOK_KEY,
    webhookSecret: env.LIVEKIT_WEBHOOK_SECRET,
  })
}
