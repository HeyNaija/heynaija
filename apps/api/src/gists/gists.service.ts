import { type Db, GIST_ROLES, blocks, communities, communityMemberships, gistMembers, gists, members } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { RateLimiter } from '../rate-limit.js'
import { DB } from '../tokens.js'
import { type GistViewer, canHostGist, canJoinGist } from './eligibility.js'
import { ParticipantNotFoundError, ROOM_SERVICE, type RoomPermissions, type RoomService } from './room-service.js'

export type GistsConfig = {
  /** CALLS_MEMBERS: the beta allow-list of handles (see eligibility.ts). */
  callsMembers: readonly string[]
  maxCohosts: number
  maxSpeakers: number
  /** The most listeners one Gist takes. A host may set it lower for their Gist. */
  listenerCap: number
  /** The LiveKit address browsers connect to. */
  livekitUrl: string
}

export type GistRole = (typeof GIST_ROLES)[number]

export const GISTS_CONFIG = Symbol('GISTS_CONFIG')

/** `not_found` covers everything the caller must not be able to tell apart: missing, not eligible, blocked, removed. */
export type GistErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'invalid'
  | 'gist_full'
  | 'gist_locked'
  | 'gist_ended'
  | 'already_hosting'
  | 'speakers_full'
  | 'cohosts_full'
  | 'requests_closed'
  | 'not_in_gist'
  | 'not_eligible'
  | 'already_speaker'
  | 'livekit_unavailable'

const STATUS: Record<GistErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  invalid: 400,
  gist_full: 409,
  gist_locked: 409,
  gist_ended: 409,
  already_hosting: 409,
  speakers_full: 409,
  cohosts_full: 409,
  requests_closed: 409,
  not_in_gist: 409,
  not_eligible: 409,
  already_speaker: 409,
  livekit_unavailable: 502,
}

export class GistError extends Error {
  readonly status: number
  constructor(
    readonly code: GistErrorCode,
    message: string = code,
    /** Facts the caller may be told with the refusal (only ever about their own Gist). */
    readonly details?: Record<string, string>,
  ) {
    super(message)
    this.status = STATUS[code]
  }
}

export type Person = { id: string; handle: string; displayName: string | null }

export type GistView = {
  id: string
  title: string
  status: 'scheduled' | 'live' | 'ended'
  community: { id: string; slug: string; name: string } | null
  host: Person
  /** Co-hosts and speakers, in the order they were made. The host is not repeated here. */
  speakers: (Person & { role: 'cohost' | 'speaker' })[]
  locked: boolean
  requestsOpen: boolean
  /** The cap that applies to this Gist: the server's, or the host's lower one. */
  listenerCap: number
  listenerCount: number
  peakListeners: number
  startedAt: string | null
  endedAt: string | null
  viewer: { role: GistRole | null; requestedToSpeak: boolean }
}

export type JoinResult = { url: string; token: string; role: GistRole; gist: GistView }

/** A Gist in the Live now list: what its card shows, and no one but the host. */
export type LiveGist = {
  id: string
  title: string
  host: Person
  community: { id: string; slug: string; name: string } | null
  listenerCount: number
  startedAt: string | null
}

/** The most Gists the Live now list shows. */
export const LIVE_LIST_MAX = 20

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Q = Db | Tx
type GistRow = typeof gists.$inferSelect
type MemberRow = typeof gistMembers.$inferSelect

const STAGE: GistRole[] = ['host', 'cohost', 'speaker']
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const EMPTY_TIMEOUT_S = 300
// LiveKit closes a room this long after the last person leaves. Its default is
// 20 seconds, which ended a Gist when the host only reloaded or switched apps.
const DEPARTURE_TIMEOUT_S = 120
// The reconcile (below) waits this long before acting on an absence: a host or
// speaker who is gone that long is taken as gone (docs/adr/0017 section 4a, takeover).
const ABSENT_MS = 2 * 60_000
// Between /join and connecting the browser has a token and no connection yet.
const CONNECTING_MS = 30_000

/** What a role may do in the room. The database role is the truth; this is only its translation. */
export const permissionsFor = (role: GistRole): RoomPermissions =>
  role === 'listener' ? { canPublish: false, hidden: true } : { canPublish: true, hidden: false }

const isUniqueViolation = (err: unknown): boolean => {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 5; e = e.cause as typeof e, depth++) {
    if (e.code === '23505') return true
  }
  return false
}

@Injectable()
export class GistsService {
  private readonly logger = new Logger(GistsService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ROOM_SERVICE) private readonly rooms: RoomService,
    @Inject(GISTS_CONFIG) private readonly config: GistsConfig,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  // ---- reading -------------------------------------------------------------

  async get(viewer: { id: string; handle: string }, gistId: string): Promise<GistView> {
    const { gist, me } = await this.open(this.db, viewer, gistId)
    return this.view(this.db, gist, me)
  }

  /** Requests to speak, oldest first. Host and co-hosts only. */
  async requests(actor: { id: string; handle: string }, gistId: string) {
    const { gist } = await this.moderator(this.db, actor, gistId)
    return this.db
      .select({ id: members.id, handle: members.handle, displayName: members.displayName, requestedAt: gistMembers.speakRequestedAt })
      .from(gistMembers)
      .innerJoin(members, eq(members.id, gistMembers.memberId))
      .where(
        and(
          eq(gistMembers.gistId, gist.id),
          eq(gistMembers.role, 'listener'),
          isNotNull(gistMembers.speakRequestedAt),
          isNotNull(gistMembers.joinedAt),
          isNull(gistMembers.leftAt),
          isNull(gistMembers.removedAt),
        ),
      )
      .orderBy(asc(gistMembers.speakRequestedAt))
  }

  /**
   * The live Gists this member may see, newest first: the Live now list. The
   * rules are the ones `open` applies to a single Gist, batched for the list: on
   * the allow-list, a member of a community-only Gist's community, not on its
   * removed list, and (unless on its stage) not blocked either way with its host
   * or a speaker. So it never lists a Gist the member would get not-found for.
   */
  async live(viewer: { id: string; handle: string }): Promise<LiveGist[]> {
    const me = await this.viewer(this.db, viewer.id)
    // Someone who may not use Gists gets the not-found of a dark feature, not an empty list.
    if (!me || !canJoinGist(me, { status: 'live', communityId: null }, { ...this.config, inCommunity: false })) throw new GistError('not_found')

    // More than the list shows, since some will be filtered out.
    const rows = await this.db
      .select({ gist: gists, host: { id: members.id, handle: members.handle, displayName: members.displayName } })
      .from(gists)
      .innerJoin(members, eq(members.id, gists.hostId))
      .where(eq(gists.status, 'live'))
      .orderBy(desc(gists.startedAt))
      .limit(LIVE_LIST_MAX * 5)
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.gist.id)
    const communityIds = [...new Set(rows.map((r) => r.gist.communityId).filter((c): c is string => c !== null))]

    const [mine, joined, communityRows, blockedOn, counts] = await Promise.all([
      // The viewer's own rows in these Gists: removed, or on the stage.
      this.db
        .select({ gistId: gistMembers.gistId, role: gistMembers.role, removedAt: gistMembers.removedAt })
        .from(gistMembers)
        .where(and(inArray(gistMembers.gistId, ids), eq(gistMembers.memberId, viewer.id))),
      communityIds.length
        ? this.db
            .select({ id: communities.id })
            .from(communities)
            .innerJoin(communityMemberships, eq(communityMemberships.communityId, communities.id))
            .where(and(inArray(communities.id, communityIds), eq(communities.active, true), eq(communityMemberships.memberId, viewer.id)))
        : [],
      communityIds.length
        ? this.db.select({ id: communities.id, slug: communities.slug, name: communities.name }).from(communities).where(inArray(communities.id, communityIds))
        : [],
      // Gists with someone on the stage who blocked the viewer, or whom the viewer blocked.
      this.db
        .selectDistinct({ gistId: gistMembers.gistId })
        .from(gistMembers)
        .innerJoin(
          blocks,
          or(
            and(eq(blocks.blockerId, viewer.id), eq(blocks.blockedId, gistMembers.memberId)),
            and(eq(blocks.blockedId, viewer.id), eq(blocks.blockerId, gistMembers.memberId)),
          ),
        )
        .where(and(inArray(gistMembers.gistId, ids), inArray(gistMembers.role, STAGE), isNull(gistMembers.removedAt))),
      this.db
        .select({ gistId: gistMembers.gistId, n: count() })
        .from(gistMembers)
        .where(and(inArray(gistMembers.gistId, ids), eq(gistMembers.role, 'listener'), this.present()))
        .groupBy(gistMembers.gistId),
    ])

    const own = new Map(mine.map((row) => [row.gistId, row]))
    const inCommunity = new Set(joined.map((c) => c.id))
    const community = new Map(communityRows.map((c) => [c.id, c]))
    const blocked = new Set(blockedOn.map((row) => row.gistId))
    const listeners = new Map(counts.map((row) => [row.gistId, row.n]))
    return rows
      .filter(({ gist }) => {
        const mineHere = own.get(gist.id)
        if (mineHere?.removedAt) return false
        if (!canJoinGist(me, gist, { ...this.config, inCommunity: gist.communityId !== null && inCommunity.has(gist.communityId) })) return false
        return (mineHere !== undefined && STAGE.includes(mineHere.role)) || !blocked.has(gist.id)
      })
      .slice(0, LIVE_LIST_MAX)
      .map(({ gist, host }) => ({
        id: gist.id,
        title: gist.title,
        host,
        community: gist.communityId ? (community.get(gist.communityId) ?? null) : null,
        listenerCount: listeners.get(gist.id) ?? 0,
        startedAt: gist.startedAt?.toISOString() ?? null,
      }))
  }

  /** Who is listening. Host and co-hosts only: other listeners never see the audience. */
  async listeners(actor: { id: string; handle: string }, gistId: string): Promise<Person[]> {
    const { gist } = await this.moderator(this.db, actor, gistId)
    return this.db
      .select({ id: members.id, handle: members.handle, displayName: members.displayName })
      .from(gistMembers)
      .innerJoin(members, eq(members.id, gistMembers.memberId))
      .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.role, 'listener'), this.present()))
      .orderBy(asc(gistMembers.joinedAt))
  }

  // ---- starting, joining, leaving -----------------------------------------

  async create(host: { id: string; handle: string }, input: { title: string; communityId?: string | null }): Promise<GistView> {
    const me = await this.viewer(this.db, host.id)
    if (!me || !canHostGist(me, this.config)) throw new GistError('not_found')
    const title = input.title.trim()
    if (title.length < 1 || title.length > 120) throw new GistError('invalid', 'The title must be 1 to 120 characters.')

    const communityId = input.communityId ?? null
    if (communityId) {
      if (!isUuid(communityId) || !(await this.inCommunity(this.db, host.id, communityId))) throw new GistError('not_found')
    }

    let gist: GistRow
    try {
      gist = await this.db.transaction(async (tx) => {
        const [live] = await tx.select({ id: gists.id }).from(gists).where(and(eq(gists.hostId, host.id), eq(gists.status, 'live')))
        if (live) throw this.alreadyHosting(live.id)
        const [row] = await tx.insert(gists).values({ hostId: host.id, communityId, title, status: 'live', startedAt: new Date() }).returning()
        await tx.insert(gistMembers).values({ gistId: row!.id, memberId: host.id, role: 'host' })
        return row!
      })
    } catch (err) {
      // Two starts at once: the unique index lets one through.
      if (isUniqueViolation(err)) {
        const [live] = await this.db.select({ id: gists.id }).from(gists).where(and(eq(gists.hostId, host.id), eq(gists.status, 'live')))
        throw this.alreadyHosting(live?.id)
      }
      throw err
    }

    try {
      await this.rooms.createRoom(gist.id, {
        maxParticipants: this.config.listenerCap + 1 + this.config.maxCohosts + this.config.maxSpeakers,
        emptyTimeoutS: EMPTY_TIMEOUT_S,
        departureTimeoutS: DEPARTURE_TIMEOUT_S,
      })
    } catch (err) {
      this.logger.error(`could not create the room for Gist ${gist.id}: ${String(err)}`)
      await this.db.update(gists).set({ status: 'ended', endedAt: new Date() }).where(eq(gists.id, gist.id))
      throw new GistError('livekit_unavailable')
    }
    return this.get(host, gist.id)
  }

  /**
   * Gives a token. It is always a listener token, whatever the member's role; the
   * role in the response tells the client what to expect, and once the client is
   * connected the server grants the microphone (the webhook, or `sync`).
   * Also the reconnect path: each reconnect asks again and gets a fresh token.
   */
  async join(viewer: { id: string; handle: string }, gistId: string): Promise<JoinResult> {
    // Counted per Gist only once the caller may see it, so accounts that know an
    // id but may not join cannot use up its allowance and lock others out.
    await this.open(this.db, viewer, gistId)
    await this.limits.hit('gistJoinBurst', gistId)
    const result = await this.db.transaction(async (tx) => {
      // The row lock serialises joins to one Gist, so the cap cannot be beaten by a burst.
      const [locked] = isUuid(gistId) ? await tx.select().from(gists).where(eq(gists.id, gistId)).for('update') : []
      if (!locked) throw new GistError('not_found')
      const { gist, me, who } = await this.open(tx, viewer, gistId)
      if (gist.status === 'ended') throw new GistError('gist_ended')
      if (gist.status !== 'live') throw new GistError('not_found')

      const role = me?.role ?? 'listener'
      const inRoom = Boolean(me?.joinedAt && !me.leftAt)
      if (role === 'listener' && !inRoom) {
        if (gist.locked && !me) throw new GistError('gist_locked')
        if ((await this.listenerCount(tx, gist.id)) >= this.capOf(gist)) throw new GistError('gist_full')
      }

      const now = new Date()
      if (me) {
        await tx
          .update(gistMembers)
          .set({ joinedAt: now, leftAt: null, connectionSid: null })
          .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, viewer.id), isNull(gistMembers.removedAt)))
      } else {
        await tx.insert(gistMembers).values({ gistId: gist.id, memberId: viewer.id, role: 'listener', joinedAt: now })
      }
      const listeners = await this.listenerCount(tx, gist.id)
      if (listeners > gist.peakListeners) await tx.update(gists).set({ peakListeners: listeners }).where(eq(gists.id, gist.id))
      return { gist, role, who }
    })

    const token = await this.rooms.listenerToken(result.gist.id, viewer.id, result.who.displayName ?? result.who.handle)
    // A member who is still connected from an earlier session is reset to the
    // role in the database now; a new connection is reset by the webhook or `sync`.
    await this.applyRole(result.gist.id, viewer.id, false)
    const { gist, me } = await this.open(this.db, viewer, gistId)
    return { url: this.config.livekitUrl, token, role: result.role, gist: await this.view(this.db, gist, me) }
  }

  async leave(viewer: { id: string; handle: string }, gistId: string): Promise<void> {
    const { gist } = await this.open(this.db, viewer, gistId)
    await this.db
      .update(gistMembers)
      .set({ leftAt: new Date(), speakRequestedAt: null })
      .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, viewer.id), isNotNull(gistMembers.joinedAt), isNull(gistMembers.leftAt)))
  }

  /**
   * Resets the caller's LiveKit permissions to their role in the database. The
   * client calls it once connected, in case the participant_joined webhook was lost.
   */
  async sync(viewer: { id: string; handle: string }, gistId: string): Promise<{ role: GistRole }> {
    const { gist, me } = await this.open(this.db, viewer, gistId)
    if (gist.status !== 'live') throw new GistError('gist_ended')
    if (!me) throw new GistError('not_in_gist')
    // LiveKit first: only a client it reports as connected is marked present.
    const role = await this.applyRole(gist.id, viewer.id, true)
    // Present, then, whatever a lost or reordered webhook said, if there is still room.
    if (!(await this.markPresent(gist.id, viewer.id))) {
      await this.disconnect(gist.id, viewer.id)
      throw new GistError('gist_full')
    }
    return { role }
  }

  // ---- asking to speak ------------------------------------------------------

  async requestToSpeak(viewer: { id: string; handle: string }, gistId: string): Promise<void> {
    const { gist, me } = await this.open(this.db, viewer, gistId)
    if (gist.status !== 'live') throw new GistError('gist_ended')
    if (!me || !me.joinedAt || me.leftAt) throw new GistError('not_in_gist')
    if (me.role !== 'listener') throw new GistError('already_speaker')
    if (!gist.requestsOpen) throw new GistError('requests_closed')
    // One open request per member: asking again keeps the place in the queue.
    await this.db
      .update(gistMembers)
      .set({ speakRequestedAt: sql`coalesce(${gistMembers.speakRequestedAt}, now())` })
      .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, viewer.id)))
  }

  async cancelRequest(viewer: { id: string; handle: string }, gistId: string): Promise<void> {
    const { gist } = await this.open(this.db, viewer, gistId)
    await this.db
      .update(gistMembers)
      .set({ speakRequestedAt: null })
      .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, viewer.id)))
  }

  // ---- moderating -----------------------------------------------------------

  /** Approves a request, or invites a listener who never asked: either way the host or a co-host chooses. */
  async setSpeaker(actor: { id: string; handle: string }, gistId: string, targetId: string): Promise<void> {
    await this.promote(actor, gistId, targetId, 'speaker')
  }

  /** Host only. */
  async setCohost(actor: { id: string; handle: string }, gistId: string, targetId: string): Promise<void> {
    await this.promote(actor, gistId, targetId, 'cohost')
  }

  /** Takes the microphone back and returns the member to the audience. They must ask again. */
  async demote(actor: { id: string; handle: string }, gistId: string, targetId: string): Promise<void> {
    await this.revoke(actor, gistId, targetId)
  }

  /**
   * A host's "mute" is revoking publish rights, not muting a track the speaker
   * could unmute (docs/adr/0017). It has the same effect as demoting.
   */
  async mute(actor: { id: string; handle: string }, gistId: string, targetId: string): Promise<void> {
    await this.revoke(actor, gistId, targetId)
  }

  /** Disconnects a member and puts them on the removed list: no new token for this Gist, ever. */
  async remove(actor: { id: string; handle: string }, gistId: string, targetId: string): Promise<void> {
    const gist = await this.db.transaction(async (tx) => {
      // Serialised with joins: a join that has read the member as welcome cannot
      // write them back in after this, and one that comes later sees the removal.
      if (isUuid(gistId)) await tx.select({ id: gists.id }).from(gists).where(eq(gists.id, gistId)).for('update')
      const { gist, me } = await this.moderator(tx, actor, gistId)
      if (gist.status !== 'live') throw new GistError('gist_ended')
      const target = await this.target(tx, gist.id, targetId)
      this.mayActOn(me.role, target.role, actor.id === targetId)
      if (actor.id === targetId) throw new GistError('forbidden')
      const now = new Date()
      await tx
        .update(gistMembers)
        .set({ removedAt: now, removedBy: actor.id, role: 'listener', speakRequestedAt: null, leftAt: now, roleChangedBy: actor.id, roleChangedAt: now })
        .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, targetId)))
      return gist
    })
    try {
      await this.rooms.removeParticipant(gist.id, targetId)
    } catch (err) {
      this.logger.error(`could not disconnect ${targetId} from Gist ${gist.id}: ${String(err)}`)
      throw new GistError('livekit_unavailable')
    }
  }

  async end(actor: { id: string; handle: string }, gistId: string): Promise<void> {
    const { gist, me } = await this.moderator(this.db, actor, gistId)
    if (me.role !== 'host') throw new GistError('forbidden')
    await this.finish(gist.id)
    // Always attempted, so a retry after a LiveKit failure finishes the job.
    try {
      await this.rooms.deleteRoom(gist.id)
    } catch (err) {
      this.logger.error(`could not delete the room of Gist ${gist.id}: ${String(err)}`)
      throw new GistError('livekit_unavailable')
    }
  }

  /**
   * Ends every live Gist `hostId` hosts, room first, before their account is
   * erased (docs/adr/0016). The erase deletes the Gist's rows, and the reconciler
   * goes by those rows, so a room still open then would never be closed. A
   * LiveKit failure leaves the Gist live for the erase's retry. Safe to repeat.
   */
  async endHostedBy(hostId: string): Promise<void> {
    const live = await this.db.select({ id: gists.id }).from(gists).where(and(eq(gists.hostId, hostId), eq(gists.status, 'live')))
    for (const { id } of live) await this.endNow(id)
  }

  /**
   * Ends a Gist at once, whoever hosts it: a moderator's decision on a report.
   * The room goes first, so everyone in it is disconnected; if the database
   * write then fails, the reconcile ends a live Gist whose room is gone. A
   * LiveKit failure throws and leaves the Gist live, to be tried again. Safe to repeat.
   */
  async endNow(gistId: string): Promise<void> {
    await this.rooms.deleteRoom(gistId)
    await this.finish(gistId)
  }

  /** Lock the room (no new listeners), set a lower listener cap, or close requests. Host only. */
  async updateSettings(
    actor: { id: string; handle: string },
    gistId: string,
    settings: { locked?: boolean; listenerCap?: number | null; requestsOpen?: boolean },
  ): Promise<GistView> {
    const { gist, me } = await this.moderator(this.db, actor, gistId)
    if (me.role !== 'host') throw new GistError('forbidden')
    if (gist.status !== 'live') throw new GistError('gist_ended')
    const { listenerCap } = settings
    if (typeof listenerCap === 'number' && (!Number.isInteger(listenerCap) || listenerCap < 1 || listenerCap > this.config.listenerCap)) {
      throw new GistError('invalid', `The listener cap must be between 1 and ${this.config.listenerCap}.`)
    }
    const set: Partial<typeof gists.$inferInsert> = {}
    if (settings.locked !== undefined) set.locked = settings.locked
    if (settings.requestsOpen !== undefined) set.requestsOpen = settings.requestsOpen
    if (listenerCap !== undefined) set.listenerCap = listenerCap
    if (Object.keys(set).length > 0) await this.db.update(gists).set(set).where(eq(gists.id, gist.id))
    return this.get(actor, gist.id)
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

    const [gist] = await this.db.select().from(gists).where(eq(gists.id, event.room))
    if (!gist) return

    if (event.kind === 'room_finished') {
      await this.finish(gist.id)
      return
    }

    if (event.kind === 'participant_left') {
      // A reload makes a second connection under the same identity and LiveKit drops
      // the first. Its leave names a different sid than the one last reported
      // joined, and must not mark the member gone. (verify against a real server)
      await this.db
        .update(gistMembers)
        .set({ leftAt: event.at, speakRequestedAt: null })
        .where(
          and(
            eq(gistMembers.gistId, gist.id),
            eq(gistMembers.memberId, event.identity),
            isNull(gistMembers.leftAt),
            event.sid
              ? or(isNull(gistMembers.connectionSid), eq(gistMembers.connectionSid, event.sid))
              : undefined,
          ),
        )
      return
    }

    // participant_joined: only someone the API let in may stay, and only as their role.
    if (!isUuid(event.identity)) return void (await this.rooms.removeParticipant(gist.id, event.identity))
    const allowed = gist.status === 'live' && (await this.mayStay(gist, event.identity)) && (await this.markPresent(gist.id, event.identity, event.sid))
    if (!allowed) {
      await this.rooms.removeParticipant(gist.id, event.identity)
      return
    }
    await this.applyRole(gist.id, event.identity, false)
  }

  // ---- reconcile ------------------------------------------------------------------

  /**
   * Puts every live Gist right against LiveKit, once a minute (gist-queue.ts).
   * Webhooks can be lost (LiveKit does not promise delivery), so this is what
   * finally holds: a Gist whose room is gone ends; anyone connected
   * who may not stay (removed, suspended, blocked with the stage) is disconnected,
   * and everyone else gets the permissions of their role; a member the database
   * thinks is in the room but LiveKit does not have is gone. A speaker gone for
   * two minutes goes back to the audience, freeing the slot, and a Gist whose host
   * has been gone that long ends: there is no co-host takeover yet.
   */
  async reconcile(now = new Date()): Promise<void> {
    const live = await this.db.select().from(gists).where(eq(gists.status, 'live'))
    for (const gist of live) {
      try {
        await this.reconcileOne(gist, now)
      } catch (err) {
        this.logger.warn(`could not reconcile Gist ${gist.id}: ${String(err)}`)
      }
    }
  }

  private async reconcileOne(gist: GistRow, now: Date): Promise<void> {
    // A Gist that is still being started may not have its room yet.
    if (gist.startedAt && now.getTime() - gist.startedAt.getTime() < CONNECTING_MS) return
    const connected = await this.rooms.participants(gist.id)
    if (connected === null) {
      this.logger.log(`Gist ${gist.id} has no room any more, ending it`)
      await this.finish(gist.id)
      return
    }

    const rows = new Map(
      (await this.db.select().from(gistMembers).where(eq(gistMembers.gistId, gist.id))).map((row) => [row.memberId, row]),
    )
    for (const p of connected) {
      const row = rows.get(p.identity)
      const present = Boolean(row?.joinedAt && !row.leftAt)
      if (!row || !(await this.mayStay(gist, p.identity)) || (!present && !(await this.markPresent(gist.id, p.identity)))) {
        await this.disconnect(gist.id, p.identity)
        continue
      }
      const want = permissionsFor(row.role)
      if (want.canPublish !== p.canPublish || want.hidden !== p.hidden) await this.applyRole(gist.id, p.identity, false)
    }

    // In the room by the database, not by LiveKit, for longer than a connection takes: gone.
    const here = connected.map((p) => p.identity).filter(isUuid)
    await this.db
      .update(gistMembers)
      .set({ leftAt: now, speakRequestedAt: null })
      .where(
        and(
          eq(gistMembers.gistId, gist.id),
          isNotNull(gistMembers.joinedAt),
          isNull(gistMembers.leftAt),
          lt(gistMembers.joinedAt, new Date(now.getTime() - CONNECTING_MS)),
          here.length > 0 ? notInArray(gistMembers.memberId, here) : undefined,
        ),
      )

    const absentSince = new Date(now.getTime() - ABSENT_MS)
    const [host] = await this.db.select().from(gistMembers).where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.role, 'host')))
    // Gone since they left, or since the Gist started if they never came.
    const hostGoneAt = host?.leftAt ?? (host?.joinedAt ? null : gist.startedAt)
    if (!host || (hostGoneAt && hostGoneAt < absentSince)) {
      this.logger.log(`the host of Gist ${gist.id} has been gone two minutes, ending it`)
      await this.finish(gist.id)
      try {
        await this.rooms.deleteRoom(gist.id)
      } catch (err) {
        this.logger.warn(`could not delete the room of Gist ${gist.id}: ${String(err)}`)
      }
      return
    }

    // Co-hosts and speakers who left two minutes ago give their place back. Their
    // connection is gone, so there is no permission to take away.
    await this.db
      .update(gistMembers)
      .set({ role: 'listener', roleChangedBy: null, roleChangedAt: now })
      .where(
        and(
          eq(gistMembers.gistId, gist.id),
          inArray(gistMembers.role, ['cohost', 'speaker']),
          lt(gistMembers.leftAt, absentSince),
        ),
      )
  }

  // ---- internals ----------------------------------------------------------------

  private capOf(gist: GistRow): number {
    return Math.min(this.config.listenerCap, gist.listenerCap ?? this.config.listenerCap)
  }

  private alreadyHosting(liveId: string | undefined): GistError {
    // Their own Gist, so telling them which one leaks nothing; it is how a host
    // who lost the tab finds it again.
    return new GistError('already_hosting', undefined, liveId ? { gistId: liveId } : undefined)
  }

  /**
   * Marks a member LiveKit reports as connected as present, recording the
   * connection when its sid is known. A listener who was counted as gone takes a
   * place again, so the cap is checked as a join checks it, under the same lock.
   * False when they may not be marked: removed, no row, or no room left.
   */
  private async markPresent(gistId: string, memberId: string, sid?: string | null): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [gist] = await tx.select().from(gists).where(eq(gists.id, gistId)).for('update')
      const [row] = await tx.select().from(gistMembers).where(and(eq(gistMembers.gistId, gistId), eq(gistMembers.memberId, memberId)))
      if (!gist || !row || row.removedAt) return false
      const counted = row.joinedAt !== null && row.leftAt === null
      if (!counted && row.role === 'listener' && (await this.listenerCount(tx, gistId)) >= this.capOf(gist)) return false
      await tx
        .update(gistMembers)
        .set({ joinedAt: sql`coalesce(${gistMembers.joinedAt}, now())`, leftAt: null, ...(sid !== undefined ? { connectionSid: sid } : {}) })
        .where(and(eq(gistMembers.gistId, gistId), eq(gistMembers.memberId, memberId)))
      return true
    })
  }

  /** Disconnects a participant, logging rather than failing when LiveKit cannot be reached. */
  private async disconnect(gistId: string, memberId: string): Promise<void> {
    try {
      await this.rooms.removeParticipant(gistId, memberId)
    } catch (err) {
      this.logger.warn(`could not disconnect ${memberId} from Gist ${gistId}: ${String(err)}`)
    }
  }

  /** In the room now: joined, not left, not removed. */
  private present() {
    return and(isNotNull(gistMembers.joinedAt), isNull(gistMembers.leftAt), isNull(gistMembers.removedAt))
  }

  private async listenerCount(q: Q, gistId: string): Promise<number> {
    const [row] = await q
      .select({ n: count() })
      .from(gistMembers)
      .where(and(eq(gistMembers.gistId, gistId), eq(gistMembers.role, 'listener'), this.present()))
    return row?.n ?? 0
  }

  private async viewer(q: Q, memberId: string): Promise<GistViewer | undefined> {
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
  private async blockedOnStage(q: Q, gistId: string, memberId: string): Promise<boolean> {
    const stage = q
      .select({ id: gistMembers.memberId })
      .from(gistMembers)
      .where(and(eq(gistMembers.gistId, gistId), inArray(gistMembers.role, STAGE), isNull(gistMembers.removedAt)))
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
   * The Gist as this viewer is allowed to know it, or not_found. Eligible, not
   * on the removed list, and (unless on the stage themselves) not blocked with the
   * host or a speaker. All of these look like a Gist that does not exist.
   */
  private async open(q: Q, who: { id: string; handle: string }, gistId: string) {
    if (!isUuid(gistId)) throw new GistError('not_found')
    const [gist] = await q.select().from(gists).where(eq(gists.id, gistId))
    const viewer = await this.viewer(q, who.id)
    if (!gist || !viewer) throw new GistError('not_found')
    const inCommunity = gist.communityId ? await this.inCommunity(q, who.id, gist.communityId) : false
    if (!canJoinGist(viewer, gist, { ...this.config, inCommunity })) throw new GistError('not_found')
    const [me] = await q
      .select()
      .from(gistMembers)
      .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, who.id)))
    if (me?.removedAt) throw new GistError('not_found')
    if (!me || !STAGE.includes(me.role)) {
      if (await this.blockedOnStage(q, gist.id, who.id)) throw new GistError('not_found')
    }
    return { gist, me, who: { ...viewer, displayName: await this.displayName(q, who.id) } }
  }

  private async displayName(q: Q, memberId: string): Promise<string | null> {
    const [row] = await q.select({ displayName: members.displayName }).from(members).where(eq(members.id, memberId))
    return row?.displayName ?? null
  }

  /** The host or a co-host of a Gist they can see, or forbidden. */
  private async moderator(q: Q, actor: { id: string; handle: string }, gistId: string) {
    const opened = await this.open(q, actor, gistId)
    if (!opened.me || (opened.me.role !== 'host' && opened.me.role !== 'cohost')) throw new GistError('forbidden')
    return { gist: opened.gist, me: opened.me }
  }

  private async target(q: Q, gistId: string, targetId: string): Promise<MemberRow> {
    if (!isUuid(targetId)) throw new GistError('not_found')
    const [row] = await q
      .select()
      .from(gistMembers)
      .where(and(eq(gistMembers.gistId, gistId), eq(gistMembers.memberId, targetId)))
    if (!row) throw new GistError('not_found')
    return row
  }

  /** The host is untouchable, and a co-host is only the host's to change. Anyone may step down themselves. */
  private mayActOn(actorRole: GistRole, targetRole: GistRole, self: boolean): void {
    if (targetRole === 'host') throw new GistError('forbidden')
    if (self) return
    if (targetRole === 'cohost' && actorRole !== 'host') throw new GistError('forbidden')
  }

  private async promote(actor: { id: string; handle: string }, gistId: string, targetId: string, to: 'speaker' | 'cohost'): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Serialised with joins and other promotions so the limits hold under a burst.
      if (isUuid(gistId)) await tx.select({ id: gists.id }).from(gists).where(eq(gists.id, gistId)).for('update')
      const { gist, me } = await this.moderator(tx, actor, gistId)
      if (gist.status !== 'live') throw new GistError('gist_ended')
      if (to === 'cohost' && me.role !== 'host') throw new GistError('forbidden')
      const target = await this.target(tx, gist.id, targetId)
      if (target.removedAt) throw new GistError('not_found')
      if (!target.joinedAt || target.leftAt) throw new GistError('not_in_gist')

      // Nobody is promoted past the eligibility and block checks, which are re-run here on live data.
      const candidate = await this.viewer(tx, targetId)
      if (!candidate || !canHostGist(candidate, this.config) || (await this.blockedOnStage(tx, gist.id, targetId))) {
        throw new GistError('not_eligible')
      }

      if (target.role === 'host' || target.role === to || (to === 'speaker' && target.role === 'cohost')) return
      const [taken] = await tx
        .select({ n: count() })
        .from(gistMembers)
        .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.role, to), isNull(gistMembers.removedAt)))
      const n = taken?.n ?? 0
      if (to === 'speaker' && n >= this.config.maxSpeakers) throw new GistError('speakers_full')
      if (to === 'cohost' && n >= this.config.maxCohosts) throw new GistError('cohosts_full')

      await tx
        .update(gistMembers)
        .set({ role: to, speakRequestedAt: null, roleChangedBy: actor.id, roleChangedAt: new Date() })
        .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, targetId), isNull(gistMembers.removedAt)))
    })
    await this.applyRole(gistId, targetId, false)
  }

  private async revoke(actor: { id: string; handle: string }, gistId: string, targetId: string): Promise<void> {
    const opened = await this.open(this.db, actor, gistId)
    const { gist, me } = opened
    if (gist.status !== 'live') throw new GistError('gist_ended')
    const self = actor.id === targetId
    // A moderator may act on others; anyone on the stage may step down. A listener has nothing to revoke.
    if (!me || (!self && me.role !== 'host' && me.role !== 'cohost')) throw new GistError('forbidden')
    const target = await this.target(this.db, gist.id, targetId)
    this.mayActOn(me.role, target.role, self)
    if (target.role === 'listener') return
    // The database first: from here on any rejoin or webhook finds a listener.
    await this.db
      .update(gistMembers)
      .set({ role: 'listener', speakRequestedAt: null, roleChangedBy: actor.id, roleChangedAt: new Date() })
      .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, targetId)))
    try {
      await this.pushRole(gist.id, targetId)
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) return
      // If the permission cannot be taken back, the connection is: they rejoin as a listener.
      this.logger.error(`could not revoke publish for ${targetId} in Gist ${gist.id}, disconnecting: ${String(err)}`)
      try {
        await this.rooms.removeParticipant(gist.id, targetId)
      } catch (removeErr) {
        this.logger.error(`could not disconnect ${targetId} from Gist ${gist.id}: ${String(removeErr)}`)
        throw new GistError('livekit_unavailable')
      }
    }
  }

  /**
   * Sets a participant's LiveKit permissions to what the role in the database
   * allows, as it is at this moment. Every write of a role (join, promote, demote,
   * mute, remove) and every reset (sync, webhook) goes through here, one at a time
   * per member: the role is read under a lock held across the LiveKit call, so a
   * slow call that read "speaker" can never land after a later one that read
   * "listener". Throws ParticipantNotFoundError if they are not connected.
   */
  private async pushRole(gistId: string, memberId: string): Promise<GistRole> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${gistId}/${memberId}`}, 0))`)
      const [row] = await tx
        .select({ role: gistMembers.role, removedAt: gistMembers.removedAt })
        .from(gistMembers)
        .where(and(eq(gistMembers.gistId, gistId), eq(gistMembers.memberId, memberId)))
      const role: GistRole = !row || row.removedAt ? 'listener' : row.role
      await this.rooms.setPermissions(gistId, memberId, permissionsFor(role))
      return role
    })
  }

  /**
   * `pushRole`, where a participant who is not connected yet is fine (their token
   * is listener-only and the webhook or `sync` follows). `strict` makes other
   * failures an error.
   */
  private async applyRole(gistId: string, memberId: string, strict: boolean): Promise<GistRole> {
    try {
      return await this.pushRole(gistId, memberId)
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) {
        if (strict) throw new GistError('not_in_gist')
        return 'listener'
      }
      this.logger.warn(`could not set permissions for ${memberId} in Gist ${gistId}: ${String(err)}`)
      if (strict) throw new GistError('livekit_unavailable')
      return 'listener'
    }
  }

  /** Whether a member LiveKit reports as connected is still allowed in. */
  private async mayStay(gist: GistRow, memberId: string): Promise<boolean> {
    const viewer = await this.viewer(this.db, memberId)
    if (!viewer) return false
    const inCommunity = gist.communityId ? await this.inCommunity(this.db, memberId, gist.communityId) : false
    if (!canJoinGist(viewer, gist, { ...this.config, inCommunity })) return false
    const [row] = await this.db
      .select()
      .from(gistMembers)
      .where(and(eq(gistMembers.gistId, gist.id), eq(gistMembers.memberId, memberId)))
    if (!row || row.removedAt) return false
    return STAGE.includes(row.role) || !(await this.blockedOnStage(this.db, gist.id, memberId))
  }

  private async finish(gistId: string): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      await tx.update(gists).set({ status: 'ended', endedAt: now }).where(and(eq(gists.id, gistId), ne(gists.status, 'ended')))
      await tx
        .update(gistMembers)
        .set({ leftAt: now, speakRequestedAt: null })
        .where(and(eq(gistMembers.gistId, gistId), isNotNull(gistMembers.joinedAt), isNull(gistMembers.leftAt)))
    })
  }

  private async view(q: Q, gist: GistRow, me: MemberRow | undefined): Promise<GistView> {
    const people = await q
      .select({ id: members.id, handle: members.handle, displayName: members.displayName, role: gistMembers.role })
      .from(gistMembers)
      .innerJoin(members, eq(members.id, gistMembers.memberId))
      .where(and(eq(gistMembers.gistId, gist.id), inArray(gistMembers.role, STAGE), isNull(gistMembers.removedAt)))
      .orderBy(asc(gistMembers.roleChangedAt), asc(members.handle))
    const person = ({ id, handle, displayName }: Person): Person => ({ id, handle, displayName })
    const host = people.find((p) => p.role === 'host')!
    const [community] = gist.communityId
      ? await q.select({ id: communities.id, slug: communities.slug, name: communities.name }).from(communities).where(eq(communities.id, gist.communityId))
      : []
    return {
      id: gist.id,
      title: gist.title,
      status: gist.status,
      community: community ?? null,
      host: person(host),
      speakers: people.filter((p) => p.role === 'cohost' || p.role === 'speaker').map((p) => ({ ...person(p), role: p.role as 'cohost' | 'speaker' })),
      locked: gist.locked,
      requestsOpen: gist.requestsOpen,
      listenerCap: this.capOf(gist),
      listenerCount: await this.listenerCount(q, gist.id),
      peakListeners: gist.peakListeners,
      startedAt: gist.startedAt?.toISOString() ?? null,
      endedAt: gist.endedAt?.toISOString() ?? null,
      viewer: { role: me?.role ?? null, requestedToSpeak: Boolean(me?.speakRequestedAt) },
    }
  }
}
