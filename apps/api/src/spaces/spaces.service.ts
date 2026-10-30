import { type Db, SPACE_ROLES, blocks, communities, communityMemberships, members, spaceMembers, spaces } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { DB } from '../tokens.js'
import { type SpaceViewer, canHostSpace, canJoinSpace } from './eligibility.js'
import { ParticipantNotFoundError, ROOM_SERVICE, type RoomPermissions, type RoomService } from './room-service.js'

export type SpacesConfig = {
  /** CALLS_MEMBERS: the beta allow-list of handles (see eligibility.ts). */
  callsMembers: readonly string[]
  maxCohosts: number
  maxSpeakers: number
  /** The most listeners one Space takes. A host may set it lower for their Space. */
  listenerCap: number
  /** The LiveKit address browsers connect to. */
  livekitUrl: string
}

export type SpaceRole = (typeof SPACE_ROLES)[number]

export const SPACES_CONFIG = Symbol('SPACES_CONFIG')

/** `not_found` covers everything the caller must not be able to tell apart: missing, not eligible, blocked, removed. */
export type SpaceErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'invalid'
  | 'space_full'
  | 'space_locked'
  | 'space_ended'
  | 'already_hosting'
  | 'speakers_full'
  | 'cohosts_full'
  | 'requests_closed'
  | 'not_in_space'
  | 'not_eligible'
  | 'already_speaker'
  | 'livekit_unavailable'

const STATUS: Record<SpaceErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  invalid: 400,
  space_full: 409,
  space_locked: 409,
  space_ended: 409,
  already_hosting: 409,
  speakers_full: 409,
  cohosts_full: 409,
  requests_closed: 409,
  not_in_space: 409,
  not_eligible: 409,
  already_speaker: 409,
  livekit_unavailable: 502,
}

export class SpaceError extends Error {
  readonly status: number
  constructor(
    readonly code: SpaceErrorCode,
    message: string = code,
  ) {
    super(message)
    this.status = STATUS[code]
  }
}

export type Person = { id: string; handle: string; displayName: string | null }

export type SpaceView = {
  id: string
  title: string
  status: 'scheduled' | 'live' | 'ended'
  community: { id: string; slug: string; name: string } | null
  host: Person
  /** Co-hosts and speakers, in the order they were made. The host is not repeated here. */
  speakers: (Person & { role: 'cohost' | 'speaker' })[]
  locked: boolean
  requestsOpen: boolean
  /** The cap that applies to this Space: the server's, or the host's lower one. */
  listenerCap: number
  listenerCount: number
  peakListeners: number
  startedAt: string | null
  endedAt: string | null
  viewer: { role: SpaceRole | null; requestedToSpeak: boolean }
}

export type JoinResult = { url: string; token: string; role: SpaceRole; space: SpaceView }

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Q = Db | Tx
type SpaceRow = typeof spaces.$inferSelect
type MemberRow = typeof spaceMembers.$inferSelect

const STAGE: SpaceRole[] = ['host', 'cohost', 'speaker']
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const EMPTY_TIMEOUT_S = 300

/** What a role may do in the room. The database role is the truth; this is only its translation. */
export const permissionsFor = (role: SpaceRole): RoomPermissions =>
  role === 'listener' ? { canPublish: false, hidden: true } : { canPublish: true, hidden: false }

const isUniqueViolation = (err: unknown): boolean => {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 5; e = e.cause as typeof e, depth++) {
    if (e.code === '23505') return true
  }
  return false
}

@Injectable()
export class SpacesService {
  private readonly logger = new Logger(SpacesService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ROOM_SERVICE) private readonly rooms: RoomService,
    @Inject(SPACES_CONFIG) private readonly config: SpacesConfig,
  ) {}

  // ---- reading -------------------------------------------------------------

  async get(viewer: { id: string; handle: string }, spaceId: string): Promise<SpaceView> {
    const { space, me } = await this.open(this.db, viewer, spaceId)
    return this.view(this.db, space, me)
  }

  /** Requests to speak, oldest first. Host and co-hosts only. */
  async requests(actor: { id: string; handle: string }, spaceId: string) {
    const { space } = await this.moderator(this.db, actor, spaceId)
    return this.db
      .select({ id: members.id, handle: members.handle, displayName: members.displayName, requestedAt: spaceMembers.speakRequestedAt })
      .from(spaceMembers)
      .innerJoin(members, eq(members.id, spaceMembers.memberId))
      .where(
        and(
          eq(spaceMembers.spaceId, space.id),
          eq(spaceMembers.role, 'listener'),
          isNotNull(spaceMembers.speakRequestedAt),
          isNotNull(spaceMembers.joinedAt),
          isNull(spaceMembers.leftAt),
          isNull(spaceMembers.removedAt),
        ),
      )
      .orderBy(asc(spaceMembers.speakRequestedAt))
  }

  /** Who is listening. Host and co-hosts only: other listeners never see the audience. */
  async listeners(actor: { id: string; handle: string }, spaceId: string): Promise<Person[]> {
    const { space } = await this.moderator(this.db, actor, spaceId)
    return this.db
      .select({ id: members.id, handle: members.handle, displayName: members.displayName })
      .from(spaceMembers)
      .innerJoin(members, eq(members.id, spaceMembers.memberId))
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.role, 'listener'), this.present()))
      .orderBy(asc(spaceMembers.joinedAt))
  }

  // ---- starting, joining, leaving -----------------------------------------

  async create(host: { id: string; handle: string }, input: { title: string; communityId?: string | null }): Promise<SpaceView> {
    const me = await this.viewer(this.db, host.id)
    if (!me || !canHostSpace(me, this.config)) throw new SpaceError('not_found')
    const title = input.title.trim()
    if (title.length < 1 || title.length > 120) throw new SpaceError('invalid', 'The title must be 1 to 120 characters.')

    const communityId = input.communityId ?? null
    if (communityId) {
      if (!isUuid(communityId) || !(await this.inCommunity(this.db, host.id, communityId))) throw new SpaceError('not_found')
    }

    let space: SpaceRow
    try {
      space = await this.db.transaction(async (tx) => {
        const [live] = await tx.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.hostId, host.id), eq(spaces.status, 'live')))
        if (live) throw new SpaceError('already_hosting')
        const [row] = await tx.insert(spaces).values({ hostId: host.id, communityId, title, status: 'live', startedAt: new Date() }).returning()
        await tx.insert(spaceMembers).values({ spaceId: row!.id, memberId: host.id, role: 'host' })
        return row!
      })
    } catch (err) {
      // Two starts at once: the unique index lets one through.
      if (isUniqueViolation(err)) throw new SpaceError('already_hosting')
      throw err
    }

    try {
      await this.rooms.createRoom(space.id, {
        maxParticipants: this.config.listenerCap + 1 + this.config.maxCohosts + this.config.maxSpeakers,
        emptyTimeoutS: EMPTY_TIMEOUT_S,
      })
    } catch (err) {
      this.logger.error(`could not create the room for Space ${space.id}: ${String(err)}`)
      await this.db.update(spaces).set({ status: 'ended', endedAt: new Date() }).where(eq(spaces.id, space.id))
      throw new SpaceError('livekit_unavailable')
    }
    return this.get(host, space.id)
  }

  /**
   * Gives a token. It is always a listener token, whatever the member's role; the
   * role in the response tells the client what to expect, and once the client is
   * connected the server grants the microphone (the webhook, or `sync`).
   * Also the reconnect path: each reconnect asks again and gets a fresh token.
   */
  async join(viewer: { id: string; handle: string }, spaceId: string): Promise<JoinResult> {
    const result = await this.db.transaction(async (tx) => {
      // The row lock serialises joins to one Space, so the cap cannot be beaten by a burst.
      const [locked] = isUuid(spaceId) ? await tx.select().from(spaces).where(eq(spaces.id, spaceId)).for('update') : []
      if (!locked) throw new SpaceError('not_found')
      const { space, me, who } = await this.open(tx, viewer, spaceId)
      if (space.status === 'ended') throw new SpaceError('space_ended')
      if (space.status !== 'live') throw new SpaceError('not_found')

      const role = me?.role ?? 'listener'
      const inRoom = Boolean(me?.joinedAt && !me.leftAt)
      if (role === 'listener' && !inRoom) {
        if (space.locked && !me) throw new SpaceError('space_locked')
        if ((await this.listenerCount(tx, space.id)) >= this.capOf(space)) throw new SpaceError('space_full')
      }

      const now = new Date()
      if (me) {
        await tx
          .update(spaceMembers)
          .set({ joinedAt: now, leftAt: null })
          .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, viewer.id)))
      } else {
        await tx.insert(spaceMembers).values({ spaceId: space.id, memberId: viewer.id, role: 'listener', joinedAt: now })
      }
      const listeners = await this.listenerCount(tx, space.id)
      if (listeners > space.peakListeners) await tx.update(spaces).set({ peakListeners: listeners }).where(eq(spaces.id, space.id))
      return { space, role, who }
    })

    const token = await this.rooms.listenerToken(result.space.id, viewer.id, result.who.displayName ?? result.who.handle)
    // A member who is still connected from an earlier session is reset to the
    // role in the database now; a new connection is reset by the webhook or `sync`.
    await this.applyRole(result.space.id, viewer.id, result.role, false)
    const { space, me } = await this.open(this.db, viewer, spaceId)
    return { url: this.config.livekitUrl, token, role: result.role, space: await this.view(this.db, space, me) }
  }

  async leave(viewer: { id: string; handle: string }, spaceId: string): Promise<void> {
    const { space } = await this.open(this.db, viewer, spaceId)
    await this.db
      .update(spaceMembers)
      .set({ leftAt: new Date(), speakRequestedAt: null })
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, viewer.id), isNotNull(spaceMembers.joinedAt), isNull(spaceMembers.leftAt)))
  }

  /**
   * Resets the caller's LiveKit permissions to their role in the database. The
   * client calls it once connected, in case the participant_joined webhook was lost.
   */
  async sync(viewer: { id: string; handle: string }, spaceId: string): Promise<{ role: SpaceRole }> {
    const { space, me } = await this.open(this.db, viewer, spaceId)
    if (space.status !== 'live') throw new SpaceError('space_ended')
    if (!me) throw new SpaceError('not_in_space')
    await this.applyRole(space.id, viewer.id, me.role, true)
    return { role: me.role }
  }

  // ---- asking to speak ------------------------------------------------------

  async requestToSpeak(viewer: { id: string; handle: string }, spaceId: string): Promise<void> {
    const { space, me } = await this.open(this.db, viewer, spaceId)
    if (space.status !== 'live') throw new SpaceError('space_ended')
    if (!me || !me.joinedAt || me.leftAt) throw new SpaceError('not_in_space')
    if (me.role !== 'listener') throw new SpaceError('already_speaker')
    if (!space.requestsOpen) throw new SpaceError('requests_closed')
    // One open request per member: asking again keeps the place in the queue.
    await this.db
      .update(spaceMembers)
      .set({ speakRequestedAt: sql`coalesce(${spaceMembers.speakRequestedAt}, now())` })
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, viewer.id)))
  }

  async cancelRequest(viewer: { id: string; handle: string }, spaceId: string): Promise<void> {
    const { space } = await this.open(this.db, viewer, spaceId)
    await this.db
      .update(spaceMembers)
      .set({ speakRequestedAt: null })
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, viewer.id)))
  }

  // ---- moderating -----------------------------------------------------------

  /** Approves a request, or invites a listener who never asked: either way the host or a co-host chooses. */
  async setSpeaker(actor: { id: string; handle: string }, spaceId: string, targetId: string): Promise<void> {
    await this.promote(actor, spaceId, targetId, 'speaker')
  }

  /** Host only. */
  async setCohost(actor: { id: string; handle: string }, spaceId: string, targetId: string): Promise<void> {
    await this.promote(actor, spaceId, targetId, 'cohost')
  }

  /** Takes the microphone back and returns the member to the audience. They must ask again. */
  async demote(actor: { id: string; handle: string }, spaceId: string, targetId: string): Promise<void> {
    await this.revoke(actor, spaceId, targetId)
  }

  /**
   * A host's "mute" is revoking publish rights, not muting a track the speaker
   * could unmute (docs/adr/0017). It has the same effect as demoting.
   */
  async mute(actor: { id: string; handle: string }, spaceId: string, targetId: string): Promise<void> {
    await this.revoke(actor, spaceId, targetId)
  }

  /** Disconnects a member and puts them on the removed list: no new token for this Space, ever. */
  async remove(actor: { id: string; handle: string }, spaceId: string, targetId: string): Promise<void> {
    const { space, me } = await this.moderator(this.db, actor, spaceId)
    if (space.status !== 'live') throw new SpaceError('space_ended')
    const target = await this.target(this.db, space.id, targetId)
    this.mayActOn(me.role, target.role, actor.id === targetId)
    if (actor.id === targetId) throw new SpaceError('forbidden')
    await this.db
      .update(spaceMembers)
      .set({ removedAt: new Date(), removedBy: actor.id, role: 'listener', speakRequestedAt: null, leftAt: new Date(), roleChangedBy: actor.id, roleChangedAt: new Date() })
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, targetId)))
    try {
      await this.rooms.removeParticipant(space.id, targetId)
    } catch (err) {
      this.logger.error(`could not disconnect ${targetId} from Space ${space.id}: ${String(err)}`)
      throw new SpaceError('livekit_unavailable')
    }
  }

  async end(actor: { id: string; handle: string }, spaceId: string): Promise<void> {
    const { space, me } = await this.moderator(this.db, actor, spaceId)
    if (me.role !== 'host') throw new SpaceError('forbidden')
    await this.finish(space.id)
    // Always attempted, so a retry after a LiveKit failure finishes the job.
    try {
      await this.rooms.deleteRoom(space.id)
    } catch (err) {
      this.logger.error(`could not delete the room of Space ${space.id}: ${String(err)}`)
      throw new SpaceError('livekit_unavailable')
    }
  }

  /** Lock the room (no new listeners), set a lower listener cap, or close requests. Host only. */
  async updateSettings(
    actor: { id: string; handle: string },
    spaceId: string,
    settings: { locked?: boolean; listenerCap?: number | null; requestsOpen?: boolean },
  ): Promise<SpaceView> {
    const { space, me } = await this.moderator(this.db, actor, spaceId)
    if (me.role !== 'host') throw new SpaceError('forbidden')
    if (space.status !== 'live') throw new SpaceError('space_ended')
    const { listenerCap } = settings
    if (typeof listenerCap === 'number' && (!Number.isInteger(listenerCap) || listenerCap < 1 || listenerCap > this.config.listenerCap)) {
      throw new SpaceError('invalid', `The listener cap must be between 1 and ${this.config.listenerCap}.`)
    }
    const set: Partial<typeof spaces.$inferInsert> = {}
    if (settings.locked !== undefined) set.locked = settings.locked
    if (settings.requestsOpen !== undefined) set.requestsOpen = settings.requestsOpen
    if (listenerCap !== undefined) set.listenerCap = listenerCap
    if (Object.keys(set).length > 0) await this.db.update(spaces).set(set).where(eq(spaces.id, space.id))
    return this.get(actor, space.id)
  }

  // ---- LiveKit webhooks -------------------------------------------------------

  /**
   * Reads one webhook delivery. Throws WebhookRejectedError on a bad signature.
   * Delivery is not guaranteed and may repeat or arrive out of order, so every
   * branch only sets state, never counts, and is safe to run twice.
   */
  async handleWebhook(rawBody: string, authorization: string | undefined): Promise<void> {
    const event = await this.rooms.readWebhook(rawBody, authorization)
    if (event.kind === 'other' || !isUuid(event.room)) return

    const [space] = await this.db.select().from(spaces).where(eq(spaces.id, event.room))
    if (!space) return

    if (event.kind === 'room_finished') {
      await this.finish(space.id)
      return
    }

    if (event.kind === 'participant_left') {
      // An event older than the member's latest join belongs to a connection they have since replaced.
      await this.db
        .update(spaceMembers)
        .set({ leftAt: event.at, speakRequestedAt: null })
        .where(
          and(
            eq(spaceMembers.spaceId, space.id),
            eq(spaceMembers.memberId, event.identity),
            isNull(spaceMembers.leftAt),
            sql`${spaceMembers.joinedAt} <= ${event.at}`,
          ),
        )
      return
    }

    // participant_joined: only someone the API let in may stay, and only as their role.
    if (!isUuid(event.identity)) return void (await this.rooms.removeParticipant(space.id, event.identity))
    const allowed = space.status === 'live' && (await this.mayStay(space, event.identity))
    if (!allowed) {
      await this.rooms.removeParticipant(space.id, event.identity)
      return
    }
    const [row] = await this.db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, event.identity)))
    await this.applyRole(space.id, event.identity, row!.role, false)
  }

  // ---- internals ----------------------------------------------------------------

  private capOf(space: SpaceRow): number {
    return Math.min(this.config.listenerCap, space.listenerCap ?? this.config.listenerCap)
  }

  /** In the room now: joined, not left, not removed. */
  private present() {
    return and(isNotNull(spaceMembers.joinedAt), isNull(spaceMembers.leftAt), isNull(spaceMembers.removedAt))
  }

  private async listenerCount(q: Q, spaceId: string): Promise<number> {
    const [row] = await q
      .select({ n: count() })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.role, 'listener'), this.present()))
    return row?.n ?? 0
  }

  private async viewer(q: Q, memberId: string): Promise<SpaceViewer | undefined> {
    const [row] = await q.select({ id: members.id, handle: members.handle, active: members.active }).from(members).where(eq(members.id, memberId))
    return row
  }

  private async inCommunity(q: Q, memberId: string, communityId: string): Promise<boolean> {
    const [row] = await q
      .select({ id: communities.id })
      .from(communities)
      .innerJoin(communityMemberships, eq(communityMemberships.communityId, communities.id))
      .where(and(eq(communities.id, communityId), eq(communities.active, true), eq(communityMemberships.memberId, memberId)))
    return Boolean(row)
  }

  /** Whether a block, either way, stands between this member and the host, co-hosts or speakers. */
  private async blockedOnStage(q: Q, spaceId: string, memberId: string): Promise<boolean> {
    const stage = q
      .select({ id: spaceMembers.memberId })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), inArray(spaceMembers.role, STAGE), isNull(spaceMembers.removedAt)))
    const [hit] = await q
      .select({ n: sql<number>`1` })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, memberId), inArray(blocks.blockedId, stage)),
          and(eq(blocks.blockedId, memberId), inArray(blocks.blockerId, stage)),
        ),
      )
      .limit(1)
    return Boolean(hit)
  }

  /**
   * The Space as this viewer is allowed to know it, or not_found. Eligible, not
   * on the removed list, and (unless on the stage themselves) not blocked with the
   * host or a speaker. All of these look like a Space that does not exist.
   */
  private async open(q: Q, who: { id: string; handle: string }, spaceId: string) {
    if (!isUuid(spaceId)) throw new SpaceError('not_found')
    const [space] = await q.select().from(spaces).where(eq(spaces.id, spaceId))
    const viewer = await this.viewer(q, who.id)
    if (!space || !viewer) throw new SpaceError('not_found')
    const inCommunity = space.communityId ? await this.inCommunity(q, who.id, space.communityId) : false
    if (!canJoinSpace(viewer, space, { ...this.config, inCommunity })) throw new SpaceError('not_found')
    const [me] = await q
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, who.id)))
    if (me?.removedAt) throw new SpaceError('not_found')
    if (!me || !STAGE.includes(me.role)) {
      if (await this.blockedOnStage(q, space.id, who.id)) throw new SpaceError('not_found')
    }
    return { space, me, who: { ...viewer, displayName: await this.displayName(q, who.id) } }
  }

  private async displayName(q: Q, memberId: string): Promise<string | null> {
    const [row] = await q.select({ displayName: members.displayName }).from(members).where(eq(members.id, memberId))
    return row?.displayName ?? null
  }

  /** The host or a co-host of a Space they can see, or forbidden. */
  private async moderator(q: Q, actor: { id: string; handle: string }, spaceId: string) {
    const opened = await this.open(q, actor, spaceId)
    if (!opened.me || (opened.me.role !== 'host' && opened.me.role !== 'cohost')) throw new SpaceError('forbidden')
    return { space: opened.space, me: opened.me }
  }

  private async target(q: Q, spaceId: string, targetId: string): Promise<MemberRow> {
    if (!isUuid(targetId)) throw new SpaceError('not_found')
    const [row] = await q
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.memberId, targetId)))
    if (!row) throw new SpaceError('not_found')
    return row
  }

  /** The host is untouchable, and a co-host is only the host's to change. Anyone may step down themselves. */
  private mayActOn(actorRole: SpaceRole, targetRole: SpaceRole, self: boolean): void {
    if (targetRole === 'host') throw new SpaceError('forbidden')
    if (self) return
    if (targetRole === 'cohost' && actorRole !== 'host') throw new SpaceError('forbidden')
  }

  private async promote(actor: { id: string; handle: string }, spaceId: string, targetId: string, to: 'speaker' | 'cohost'): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Serialised with joins and other promotions so the limits hold under a burst.
      if (isUuid(spaceId)) await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, spaceId)).for('update')
      const { space, me } = await this.moderator(tx, actor, spaceId)
      if (space.status !== 'live') throw new SpaceError('space_ended')
      if (to === 'cohost' && me.role !== 'host') throw new SpaceError('forbidden')
      const target = await this.target(tx, space.id, targetId)
      if (target.removedAt) throw new SpaceError('not_found')
      if (!target.joinedAt || target.leftAt) throw new SpaceError('not_in_space')

      // Nobody is promoted past the eligibility and block checks, which are re-run here on live data.
      const candidate = await this.viewer(tx, targetId)
      if (!candidate || !canHostSpace(candidate, this.config) || (await this.blockedOnStage(tx, space.id, targetId))) {
        throw new SpaceError('not_eligible')
      }

      if (target.role === 'host' || target.role === to || (to === 'speaker' && target.role === 'cohost')) return
      const [taken] = await tx
        .select({ n: count() })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.role, to), isNull(spaceMembers.removedAt)))
      const n = taken?.n ?? 0
      if (to === 'speaker' && n >= this.config.maxSpeakers) throw new SpaceError('speakers_full')
      if (to === 'cohost' && n >= this.config.maxCohosts) throw new SpaceError('cohosts_full')

      await tx
        .update(spaceMembers)
        .set({ role: to, speakRequestedAt: null, roleChangedBy: actor.id, roleChangedAt: new Date() })
        .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, targetId)))
    })
    await this.applyRole(spaceId, targetId, to, false)
  }

  private async revoke(actor: { id: string; handle: string }, spaceId: string, targetId: string): Promise<void> {
    const opened = await this.open(this.db, actor, spaceId)
    const { space, me } = opened
    if (space.status !== 'live') throw new SpaceError('space_ended')
    const self = actor.id === targetId
    // A moderator may act on others; anyone on the stage may step down. A listener has nothing to revoke.
    if (!me || (!self && me.role !== 'host' && me.role !== 'cohost')) throw new SpaceError('forbidden')
    const target = await this.target(this.db, space.id, targetId)
    this.mayActOn(me.role, target.role, self)
    if (target.role === 'listener') return
    // The database first: from here on any rejoin or webhook finds a listener.
    await this.db
      .update(spaceMembers)
      .set({ role: 'listener', speakRequestedAt: null, roleChangedBy: actor.id, roleChangedAt: new Date() })
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, targetId)))
    try {
      await this.rooms.setPermissions(space.id, targetId, permissionsFor('listener'))
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) return
      // If the permission cannot be taken back, the connection is: they rejoin as a listener.
      this.logger.error(`could not revoke publish for ${targetId} in Space ${space.id}, disconnecting: ${String(err)}`)
      try {
        await this.rooms.removeParticipant(space.id, targetId)
      } catch (removeErr) {
        this.logger.error(`could not disconnect ${targetId} from Space ${space.id}: ${String(removeErr)}`)
        throw new SpaceError('livekit_unavailable')
      }
    }
  }

  /**
   * Sets a connected participant's LiveKit permissions to what `role` allows. A
   * participant who is not connected yet is fine (their token is listener-only
   * and the webhook or `sync` follows). `strict` makes other failures an error.
   */
  private async applyRole(spaceId: string, memberId: string, role: SpaceRole, strict: boolean): Promise<void> {
    try {
      await this.rooms.setPermissions(spaceId, memberId, permissionsFor(role))
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) {
        if (strict) throw new SpaceError('not_in_space')
        return
      }
      this.logger.warn(`could not set permissions for ${memberId} in Space ${spaceId}: ${String(err)}`)
      if (strict) throw new SpaceError('livekit_unavailable')
    }
  }

  /** Whether a member LiveKit reports as connected is still allowed in. */
  private async mayStay(space: SpaceRow, memberId: string): Promise<boolean> {
    const viewer = await this.viewer(this.db, memberId)
    if (!viewer) return false
    const inCommunity = space.communityId ? await this.inCommunity(this.db, memberId, space.communityId) : false
    if (!canJoinSpace(viewer, space, { ...this.config, inCommunity })) return false
    const [row] = await this.db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.memberId, memberId)))
    if (!row || row.removedAt) return false
    return STAGE.includes(row.role) || !(await this.blockedOnStage(this.db, space.id, memberId))
  }

  private async finish(spaceId: string): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      await tx.update(spaces).set({ status: 'ended', endedAt: now }).where(and(eq(spaces.id, spaceId), ne(spaces.status, 'ended')))
      await tx
        .update(spaceMembers)
        .set({ leftAt: now, speakRequestedAt: null })
        .where(and(eq(spaceMembers.spaceId, spaceId), isNotNull(spaceMembers.joinedAt), isNull(spaceMembers.leftAt)))
    })
  }

  private async view(q: Q, space: SpaceRow, me: MemberRow | undefined): Promise<SpaceView> {
    const people = await q
      .select({ id: members.id, handle: members.handle, displayName: members.displayName, role: spaceMembers.role })
      .from(spaceMembers)
      .innerJoin(members, eq(members.id, spaceMembers.memberId))
      .where(and(eq(spaceMembers.spaceId, space.id), inArray(spaceMembers.role, STAGE), isNull(spaceMembers.removedAt)))
      .orderBy(asc(spaceMembers.roleChangedAt), asc(members.handle))
    const person = ({ id, handle, displayName }: Person): Person => ({ id, handle, displayName })
    const host = people.find((p) => p.role === 'host')!
    const [community] = space.communityId
      ? await q.select({ id: communities.id, slug: communities.slug, name: communities.name }).from(communities).where(eq(communities.id, space.communityId))
      : []
    return {
      id: space.id,
      title: space.title,
      status: space.status,
      community: community ?? null,
      host: person(host),
      speakers: people.filter((p) => p.role === 'cohost' || p.role === 'speaker').map((p) => ({ ...person(p), role: p.role as 'cohost' | 'speaker' })),
      locked: space.locked,
      requestsOpen: space.requestsOpen,
      listenerCap: this.capOf(space),
      listenerCount: await this.listenerCount(q, space.id),
      peakListeners: space.peakListeners,
      startedAt: space.startedAt?.toISOString() ?? null,
      endedAt: space.endedAt?.toISOString() ?? null,
      viewer: { role: me?.role ?? null, requestedToSpeak: Boolean(me?.speakRequestedAt) },
    }
  }
}
