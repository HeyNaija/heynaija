import {
  type ConnectedParticipant,
  ParticipantNotFoundError,
  type RoomEvent,
  type RoomPermissions,
  type RoomService,
  type RoomTimeouts,
  WebhookRejectedError,
} from './room-service.js'

/** The grants a fake token carries, readable by tests (the real one is a signed JWT). */
export type FakeToken = {
  room: string
  identity: string
  name: string
  canSubscribe: boolean
  canPublish: boolean
  canPublishData: boolean
  hidden: boolean
}

/** A RoomService that records what it was asked and holds no network. For tests. */
export class FakeRoomService implements RoomService {
  readonly rooms = new Map<string, RoomTimeouts>()
  /** Who is "connected": tests add identities with `connect`. */
  readonly connected = new Set<string>()
  /** The permissions last set on each connected identity, as `room/identity`. */
  readonly permissions = new Map<string, RoomPermissions>()
  readonly removed: string[] = []
  readonly deleted: string[] = []
  readonly calls: string[] = []
  /** Make the next call of this kind fail. */
  failNext: 'createRoom' | 'setPermissions' | 'removeParticipant' | 'participants' | undefined
  /**
   * Makes the next setPermissions call wait until released before it takes effect,
   * the way a slow request reaches the server after a later one.
   */
  holdNext: Promise<void> | undefined
  /** The authorization header that readWebhook accepts. */
  validAuthorization = 'valid'

  private key = (room: string, identity: string) => `${room}/${identity}`

  connect(room: string, identity: string): void {
    this.connected.add(this.key(room, identity))
    // A real participant joins with the listener token's grants.
    this.permissions.set(this.key(room, identity), { canPublish: false, hidden: true })
  }

  permissionsOf(room: string, identity: string): RoomPermissions | undefined {
    return this.permissions.get(this.key(room, identity))
  }

  private failIf(call: NonNullable<FakeRoomService['failNext']>): void {
    if (this.failNext === call) {
      this.failNext = undefined
      throw new Error(`${call} failed`)
    }
  }

  async createRoom(room: string, options: RoomTimeouts): Promise<void> {
    this.calls.push('createRoom')
    this.failIf('createRoom')
    this.rooms.set(room, options)
  }

  async deleteRoom(room: string): Promise<void> {
    this.calls.push('deleteRoom')
    this.deleted.push(room)
    this.rooms.delete(room)
  }

  async listenerToken(room: string, identity: string, displayName: string): Promise<string> {
    const token: FakeToken = {
      room,
      identity,
      name: displayName,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      hidden: true,
    }
    return JSON.stringify(token)
  }

  async participantToken(room: string, identity: string, displayName: string): Promise<string> {
    const token: FakeToken = {
      room,
      identity,
      name: displayName,
      canSubscribe: true,
      canPublish: true,
      canPublishData: false,
      hidden: false,
    }
    return JSON.stringify(token)
  }

  async setPermissions(room: string, identity: string, permissions: RoomPermissions): Promise<void> {
    this.calls.push('setPermissions')
    this.failIf('setPermissions')
    if (this.holdNext) {
      const gate = this.holdNext
      this.holdNext = undefined
      await gate
    }
    if (!this.connected.has(this.key(room, identity))) throw new ParticipantNotFoundError()
    this.permissions.set(this.key(room, identity), permissions)
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    this.calls.push('removeParticipant')
    this.failIf('removeParticipant')
    this.removed.push(this.key(room, identity))
    this.connected.delete(this.key(room, identity))
    this.permissions.delete(this.key(room, identity))
  }

  async participants(room: string): Promise<ConnectedParticipant[] | null> {
    this.calls.push('participants')
    this.failIf('participants')
    if (!this.rooms.has(room)) return null
    return [...this.connected]
      .filter((key) => key.startsWith(`${room}/`))
      .map((key) => {
        const identity = key.slice(room.length + 1)
        const { canPublish, hidden } = this.permissions.get(key) ?? { canPublish: false, hidden: true }
        return { identity, sid: `PA_${identity}`, canPublish, hidden }
      })
  }

  async readWebhook(rawBody: string, authorization: string | undefined): Promise<RoomEvent> {
    if (authorization !== this.validAuthorization) throw new WebhookRejectedError('bad signature')
    const body = JSON.parse(rawBody) as { id: string; kind: RoomEvent['kind']; room?: string; identity?: string; sid?: string }
    // LiveKit stamps events in whole seconds.
    const at = new Date(Math.floor(Date.now() / 1000) * 1000)
    if (body.kind === 'room_finished') return { id: body.id, kind: 'room_finished', room: body.room!, at }
    if (body.kind === 'participant_joined' || body.kind === 'participant_left') {
      return { id: body.id, kind: body.kind, room: body.room!, identity: body.identity!, sid: body.sid ?? null, at }
    }
    return { id: body.id, kind: 'other', at }
  }
}
