import { type Db, MEETING_PARTICIPANT_STATUSES, MEETING_STATUSES, blocks, calls, meetingParticipants as mp, meetings, members } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, eq, gt, ilike, inArray, lt, ne, or, sql } from 'drizzle-orm'
import { canCall } from '../calls/can-call.js'
import { CALLS_CONFIG, type CallsConfig, isUniqueViolation, isUuid } from '../calls/calls.service.js'
import { ROOM_SERVICE, type RoomEvent, type RoomService } from '../gists/room-service.js'
import { DB } from '../tokens.js'

/**
 * Small group voice meetings (docs/adr/0017 stage 2), built on the calls module: the same
 * `canCall` eligibility (and its two dark-launch seams), the same LiveKit room service and
 * webhook fan-out, the same once-a-minute pass. Invite-only: everyone in a meeting is a
 * member the host invited who passes `canCall`. State lives in Postgres; LiveKit only moves audio.
 */

/** Everyone counts, the host included (ADR 0017 section 4 and open question 7: 8, no guests). */
export const MAX_PARTICIPANTS = 8
/** How long an invitation can be answered. Meetings have no ring; this keeps old alerts from popping up. */
export const INVITE_TTL_MS = 5 * 60_000
/** After joining, how long a member has to connect before an empty seat in the room means they left. */
export const CONNECT_GRACE_MS = 60_000
const EMPTY_TIMEOUT_S = 60
const DEPARTURE_TIMEOUT_S = 20
const SEARCH_LIMIT = 20

/** `not_found` covers everything the caller must not be able to tell apart: missing, not eligible, blocked, removed, locked out. */
export type MeetingErrorCode = 'not_found' | 'already_in_meeting' | 'in_call' | 'full' | 'locked' | 'livekit_unavailable'

const STATUS: Record<MeetingErrorCode, number> = {
  not_found: 404,
  already_in_meeting: 409,
  in_call: 409,
  full: 409,
  locked: 409,
  livekit_unavailable: 502,
}

export class MeetingError extends Error {
  readonly status: number
  constructor(readonly code: MeetingErrorCode) {
    super(code)
    this.status = STATUS[code]
  }
}

type Who = { id: string; handle: string }
type Person = { id: string; handle: string; displayName: string | null }
type ParticipantStatus = (typeof MEETING_PARTICIPANT_STATUSES)[number]
export type MeetingPerson = Person & { state: 'joined' | 'invited'; isHost: boolean }
export type MeetingView = {
  id: string
  status: (typeof MEETING_STATUSES)[number]
  locked: boolean
  capacity: number
  /** Which side the viewer is. */
  role: 'host' | 'participant'
  /** The viewer's own state in the meeting. */
  me: ParticipantStatus
  host: Person
  /** Who is in or invited; only for someone who is in the meeting now. */
  participants: MeetingPerson[]
  endedAt: string | null
}
export type IncomingMeeting = { id: string; host: Person; expiresAt: string }
type MeetingRow = typeof meetings.$inferSelect
type ParticipantRow = typeof mp.$inferSelect
type Q = Pick<Db, 'select'>

const nf = () => new MeetingError('not_found')
const LIVE: ParticipantStatus[] = ['joined', 'invited']

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ROOM_SERVICE) private readonly rooms: RoomService,
    @Inject(CALLS_CONFIG) private readonly config: CallsConfig,
  ) {}

  // ---- the once-a-minute pass (run by CallsService.tick) -------------------------

  /** With calls on: reconcile. With calls off: the kill switch. Returns how many meetings it ended (0 when on). */
  async tick(): Promise<number> {
    if (this.config.enabled) {
      await this.reconcile()
      return 0
    }
    return this.shutdownLive()
  }

  /** Ends every open meeting and deletes its room. One indexed query; no rows in the normal case. */
  async shutdownLive(): Promise<number> {
    const ended = await this.db
      .update(meetings)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(meetings.status, 'open'))
      .returning({ id: meetings.id })
    for (const { id } of ended) {
      await this.freeSeats(id)
      await this.dropRoom(id)
    }
    return ended.length
  }

  // ---- starting ---------------------------------------------------------------------

  async create(host: Who, inviteeIds: string[]): Promise<MeetingView> {
    const ids = [...new Set(inviteeIds)]
    if (ids.some((i) => !isUuid(i) || i === host.id) || ids.length > MAX_PARTICIPANTS - 1) throw nf()
    await this.expireStale()
    let meeting: MeetingRow
    try {
      meeting = await this.db.transaction(async (tx) => {
        // Locking everyone involved serialises their meetings and calls.
        await tx.select({ id: members.id }).from(members).where(inArray(members.id, [host.id, ...ids])).orderBy(members.id).for('update')
        if (!(await canCall(tx, this.config, host.id))) throw nf()
        for (const invitee of ids) if (!(await canCall(tx, this.config, host.id, invitee))) throw nf()
        // Two invitees in a block cannot be in one room (ADR 0017 section 3).
        if (await this.anyBlockAmong(tx, ids)) throw nf()
        if (await this.inOpenCall(tx, host.id)) throw new MeetingError('in_call')
        const [created] = await tx.insert(meetings).values({ hostId: host.id }).returning()
        await tx.insert(mp).values([
          { meetingId: created!.id, memberId: host.id, status: 'joined', joinedAt: new Date() },
          ...ids.map((memberId) => ({ meetingId: created!.id, memberId })),
        ])
        return created!
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw new MeetingError('already_in_meeting')
      throw err
    }
    try {
      await this.rooms.createRoom(meeting.id, { maxParticipants: MAX_PARTICIPANTS, emptyTimeoutS: EMPTY_TIMEOUT_S, departureTimeoutS: DEPARTURE_TIMEOUT_S })
    } catch (err) {
      this.logger.error(`could not create the room of meeting ${meeting.id}: ${String(err)}`)
      await this.close(meeting.id)
      throw new MeetingError('livekit_unavailable')
    }
    return this.view(meeting, host.id)
  }

  /** The newest unanswered invitation, if any. */
  async incoming(me: Who): Promise<IncomingMeeting | null> {
    // Anyone who cannot use calls at all gets the same 404 as a route that does not exist.
    if (!(await canCall(this.db, this.config, me.id))) throw nf()
    await this.expireStale()
    const rows = await this.db
      .select({ id: meetings.id, hostId: meetings.hostId, invitedAt: mp.invitedAt })
      .from(mp)
      .innerJoin(meetings, eq(meetings.id, mp.meetingId))
      .where(and(eq(mp.memberId, me.id), eq(mp.status, 'invited'), eq(meetings.status, 'open'), eq(meetings.locked, false), gt(mp.invitedAt, this.inviteCutoff())))
      .orderBy(sql`${mp.invitedAt} desc`)
      .limit(5)
    for (const row of rows) {
      if (row.hostId !== me.id && !(await canCall(this.db, this.config, row.hostId, me.id))) continue
      const host = await this.person(row.hostId)
      return { id: row.id, host, expiresAt: new Date(row.invitedAt.getTime() + INVITE_TTL_MS).toISOString() }
    }
    return null
  }

  async get(me: Who, meetingId: string): Promise<MeetingView> {
    const { meeting } = await this.mine(me, meetingId)
    return this.view(meeting, me.id)
  }

  // ---- joining and leaving -----------------------------------------------------------

  /** Accept an invitation (or come back after leaving). Everything is re-checked on live data. */
  async join(me: Who, meetingId: string): Promise<MeetingView> {
    await this.mine(me, meetingId)
    let meeting: MeetingRow
    try {
      meeting = await this.db.transaction(async (tx) => {
        const [locked] = await tx.select().from(meetings).where(eq(meetings.id, meetingId)).for('update')
        if (!locked || locked.status !== 'open') throw nf()
        const [row] = await tx.select().from(mp).where(and(eq(mp.meetingId, meetingId), eq(mp.memberId, me.id))).for('update')
        if (!row || row.status === 'removed' || row.status === 'declined' || row.status === 'missed') throw nf()
        if (row.status === 'joined') return locked
        if (row.status === 'invited' && row.invitedAt.getTime() <= this.inviteCutoff().getTime()) throw nf()
        if (locked.locked) throw nf()
        if (!(await this.memberOk(tx, locked, me.id))) throw nf()
        const others = await this.joinedIds(tx, meetingId, me.id)
        if (await this.blockedWithAny(tx, me.id, others)) throw nf()
        if (await this.inOpenCall(tx, me.id)) throw new MeetingError('in_call')
        // Last, so a full meeting says so only to someone who could otherwise have joined.
        if (others.length + 1 > MAX_PARTICIPANTS) throw new MeetingError('full')
        await tx.update(mp).set({ status: 'joined', joinedAt: new Date(), leftAt: null, sid: null }).where(and(eq(mp.meetingId, meetingId), eq(mp.memberId, me.id)))
        return locked
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw new MeetingError('already_in_meeting')
      throw err
    }
    return this.view(meeting, me.id)
  }

  async decline(me: Who, meetingId: string): Promise<void> {
    const { participant } = await this.mine(me, meetingId)
    if (participant.status !== 'invited') throw nf()
    await this.db.update(mp).set({ status: 'declined' }).where(and(eq(mp.meetingId, meetingId), eq(mp.memberId, me.id), eq(mp.status, 'invited')))
  }

  /** Leave. A retry is safe. The host leaving hands the meeting on; the last one out ends it. */
  async leave(me: Who, meetingId: string): Promise<void> {
    const { participant } = await this.mine(me, meetingId)
    if (participant.status === 'joined') await this.departed(meetingId, me.id, true)
  }

  /** The host ends it for everyone. Already over is not an error, so a retry is safe. */
  async end(me: Who, meetingId: string): Promise<void> {
    const { meeting } = await this.mine(me, meetingId)
    if (meeting.hostId !== me.id) throw nf()
    await this.close(meeting.id)
  }

  // ---- host controls -------------------------------------------------------------------

  async setLocked(me: Who, meetingId: string, locked: boolean): Promise<MeetingView> {
    const meeting = await this.hosted(me, meetingId)
    await this.db.update(meetings).set({ locked }).where(eq(meetings.id, meeting.id))
    return this.view({ ...meeting, locked }, me.id)
  }

  async invite(me: Who, meetingId: string, memberId: string): Promise<MeetingView> {
    if (!isUuid(memberId) || memberId === me.id) throw nf()
    await this.hosted(me, meetingId)
    const meeting = await this.db.transaction(async (tx) => {
      await tx.select({ id: members.id }).from(members).where(inArray(members.id, [me.id, memberId])).orderBy(members.id).for('update')
      const [m] = await tx.select().from(meetings).where(eq(meetings.id, meetingId)).for('update')
      if (!m || m.status !== 'open' || m.hostId !== me.id) throw nf()
      const [row] = await tx.select().from(mp).where(and(eq(mp.meetingId, meetingId), eq(mp.memberId, memberId)))
      if (row?.status === 'removed') throw nf()
      if (!(await canCall(tx, this.config, me.id, memberId))) throw nf()
      const live = (await this.liveIds(tx, meetingId)).filter((i) => i !== memberId)
      if (await this.blockedWithAny(tx, memberId, live)) throw nf()
      if (row?.status === 'joined') return m
      if (m.locked) throw new MeetingError('locked')
      if (live.length + 1 > MAX_PARTICIPANTS) throw new MeetingError('full')
      await tx
        .insert(mp)
        .values({ meetingId, memberId })
        .onConflictDoUpdate({ target: [mp.meetingId, mp.memberId], set: { status: 'invited', invitedAt: new Date(), leftAt: null, sid: null } })
      return m
    })
    return this.view(meeting, me.id)
  }

  /** Remove a member: disconnected now, and on the removed list so no token or invitation follows. */
  async remove(me: Who, meetingId: string, memberId: string): Promise<void> {
    if (!isUuid(memberId) || memberId === me.id) throw nf()
    await this.hosted(me, meetingId)
    const changed = await this.db
      .update(mp)
      .set({ status: 'removed', leftAt: new Date(), sid: null })
      .where(and(eq(mp.meetingId, meetingId), eq(mp.memberId, memberId)))
      .returning({ id: mp.memberId })
    if (changed.length === 0) throw nf()
    await this.removeFromRoom(meetingId, memberId)
  }

  /** Members the host can invite now: eligible with the host, in no block with anyone there, not already in. */
  async invitable(me: Who, meetingId: string, query: string): Promise<Person[]> {
    await this.hosted(me, meetingId)
    const allow = this.config.callsMembers.map((h) => h.toLowerCase())
    if (allow.length === 0) return []
    const taken = new Map((await this.db.select().from(mp).where(eq(mp.meetingId, meetingId))).map((r) => [r.memberId, r]))
    const q = query.trim().slice(0, 40).replace(/[\\%_]/g, (c) => `\\${c}`)
    const rows = await this.db
      .select({ id: members.id, handle: members.handle, displayName: members.displayName })
      .from(members)
      .where(
        and(
          eq(members.active, true),
          sql`coalesce(${members.status}, '') <> 'suspended'`,
          eq(members.allowCalls, true),
          ne(members.id, me.id),
          inArray(sql`lower(${members.handle})`, allow),
          q ? or(ilike(members.handle, `${q}%`), ilike(members.displayName, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(asc(members.handle))
      .limit(SEARCH_LIMIT * 3)
    const live = await this.liveIds(this.db, meetingId)
    const out: Person[] = []
    for (const row of rows) {
      const there = taken.get(row.id)
      if (there && (there.status === 'removed' || there.status === 'joined' || (there.status === 'invited' && there.invitedAt.getTime() > this.inviteCutoff().getTime()))) continue
      if (!(await canCall(this.db, this.config, me.id, row.id))) continue
      if (await this.blockedWithAny(this.db, row.id, live)) continue
      out.push(row)
      if (out.length >= SEARCH_LIMIT) break
    }
    return out
  }

  // ---- tokens ----------------------------------------------------------------------------

  /** A token for a member who is in the meeting, re-checking everything on live data. Also the reconnect path. */
  async token(me: Who, meetingId: string): Promise<{ url: string; token: string; meeting: MeetingView }> {
    const { meeting, participant } = await this.mine(me, meetingId)
    if (meeting.status !== 'open' || participant.status !== 'joined') throw nf()
    const others = await this.joinedIds(this.db, meeting.id, me.id)
    if (!(await this.memberOk(this.db, meeting, me.id)) || (await this.blockedWithAny(this.db, me.id, others))) {
      await this.departed(meeting.id, me.id, true)
      throw nf()
    }
    const [self] = await this.db.select({ handle: members.handle, displayName: members.displayName }).from(members).where(eq(members.id, me.id))
    // Microphone only, no data channel, no screen share: the 1:1 call token.
    const jwt = await this.rooms.participantToken(meeting.id, me.id, self?.displayName ?? self?.handle ?? me.handle)
    return { url: this.config.livekitUrl, token: jwt, meeting: await this.view(meeting, me.id) }
  }

  // ---- LiveKit events and reconciliation ------------------------------------------------------

  /**
   * One webhook event. Delivery is not guaranteed and may repeat or arrive out of
   * order, so every branch only sets state and is safe to run twice. Rooms that are
   * not meetings are ignored (Gists and calls share this webhook).
   */
  async handleEvent(event: RoomEvent): Promise<void> {
    // With calls off there is no webhook handling for meetings, only the teardown.
    if (!this.config.enabled || event.kind === 'other' || !isUuid(event.room)) return
    const [meeting] = await this.db.select().from(meetings).where(eq(meetings.id, event.room))
    if (!meeting) return
    if (event.kind === 'room_finished') {
      await this.close(meeting.id)
      return
    }
    const [row] = await this.db.select().from(mp).where(and(eq(mp.meetingId, meeting.id), eq(mp.memberId, event.identity)))
    const inside = meeting.status === 'open' && row?.status === 'joined'

    if (event.kind === 'participant_left') {
      if (!inside) return
      // A reload makes a second connection under the same identity and LiveKit drops
      // the first: its leave names an older sid and must not take the member out.
      if (event.sid && row.sid && row.sid !== event.sid) return
      await this.departed(meeting.id, event.identity, false)
      return
    }

    // participant_joined: only a member who is in the meeting, and still eligible, may stay.
    const others = inside ? await this.joinedIds(this.db, meeting.id, event.identity) : []
    const staying = inside && (await this.memberOk(this.db, meeting, event.identity)) && !(await this.blockedWithAny(this.db, event.identity, others))
    if (!staying) {
      await this.removeFromRoom(meeting.id, event.identity)
      if (inside) await this.departed(meeting.id, event.identity, false)
      return
    }
    await this.db.update(mp).set({ sid: event.sid }).where(and(eq(mp.meetingId, meeting.id), eq(mp.memberId, event.identity)))
  }

  /**
   * Run every minute, and safe to run twice. Webhooks are hints; this settles what they missed:
   * invitations that timed out, members who stopped being eligible (a block, a lapse, a
   * suspension), blocks that arose inside a room, people in the room who should not be, people
   * who left it, and rooms that vanished.
   */
  async reconcile(now: Date = new Date()): Promise<void> {
    await this.expireStale(now)
    const open = await this.db.select().from(meetings).where(eq(meetings.status, 'open'))
    for (const meeting of open) {
      try {
        await this.reconcileOne(meeting, now)
      } catch (err) {
        // LiveKit is unreachable: leave the meeting for the next pass.
        this.logger.error(`could not reconcile meeting ${meeting.id}: ${String(err)}`)
      }
    }
  }

  private async reconcileOne(meeting: MeetingRow, now: Date): Promise<void> {
    let joined = await this.joined(this.db, meeting.id)
    for (const j of joined) {
      if (!(await this.memberOk(this.db, meeting, j.memberId))) await this.departed(meeting.id, j.memberId, true)
    }
    joined = await this.joined(this.db, meeting.id)
    // A block that arose inside the room: the non-host of the pair leaves, else the later joiner.
    // (The blocked member leaving is the same as the blocker leaving as far as the room is concerned;
    // neither side is told why.)
    const current = await this.db.select().from(meetings).where(eq(meetings.id, meeting.id))
    const hostId = current[0]?.hostId ?? meeting.hostId
    for (const loser of await this.conflictLosers(joined, hostId)) await this.departed(meeting.id, loser, true)
    joined = await this.joined(this.db, meeting.id)

    const present = await this.rooms.participants(meeting.id)
    if (present === null) {
      // The room is gone and the meeting is past its connect grace: a lost room_finished.
      if (now.getTime() - meeting.createdAt.getTime() >= CONNECT_GRACE_MS) await this.close(meeting.id)
      return
    }
    const here = new Set(present.map((p) => p.identity))
    const inMeeting = new Set(joined.map((j) => j.memberId))
    for (const identity of here) if (!inMeeting.has(identity)) await this.removeFromRoom(meeting.id, identity)
    for (const j of joined) {
      if (j.joinedAt && now.getTime() - j.joinedAt.getTime() >= CONNECT_GRACE_MS && !here.has(j.memberId)) await this.departed(meeting.id, j.memberId, false)
    }
    await this.settle(meeting.id)
  }

  // ---- internals ---------------------------------------------------------------------------------

  private inviteCutoff(now: number = Date.now()): Date {
    return new Date(now - INVITE_TTL_MS)
  }

  /** Invitations past their time become missed, whoever notices first. */
  private async expireStale(now: Date = new Date()): Promise<void> {
    await this.db
      .update(mp)
      .set({ status: 'missed' })
      .where(and(eq(mp.status, 'invited'), lt(mp.invitedAt, this.inviteCutoff(now.getTime()))))
  }

  /** This member may be in this meeting: passes `canCall`, and with the host. Blocks among guests are checked apart. */
  private async memberOk(q: Q, meeting: MeetingRow, memberId: string): Promise<boolean> {
    if (!(await canCall(q, this.config, memberId))) return false
    return memberId === meeting.hostId || canCall(q, this.config, memberId, meeting.hostId)
  }

  private async inOpenCall(q: Q, memberId: string): Promise<boolean> {
    const [open] = await q
      .select({ id: calls.id })
      .from(calls)
      .where(and(inArray(calls.status, ['ringing', 'active']), or(eq(calls.callerId, memberId), eq(calls.calleeId, memberId))))
      .limit(1)
    return Boolean(open)
  }

  private async joined(q: Q, meetingId: string): Promise<ParticipantRow[]> {
    return q.select().from(mp).where(and(eq(mp.meetingId, meetingId), eq(mp.status, 'joined'))).orderBy(asc(mp.joinedAt))
  }

  private async joinedIds(q: Q, meetingId: string, except: string): Promise<string[]> {
    return (await this.joined(q, meetingId)).map((r) => r.memberId).filter((i) => i !== except)
  }

  /** Joined, and invited with a live invitation: who the meeting is counting on. */
  private async liveIds(q: Q, meetingId: string): Promise<string[]> {
    const rows = await q.select().from(mp).where(and(eq(mp.meetingId, meetingId), inArray(mp.status, LIVE)))
    const cutoff = this.inviteCutoff().getTime()
    return rows.filter((r) => r.status === 'joined' || r.invitedAt.getTime() > cutoff).map((r) => r.memberId)
  }

  private async blockedWithAny(q: Q, memberId: string, others: string[]): Promise<boolean> {
    if (others.length === 0) return false
    const [hit] = await q
      .select({ b: blocks.blockerId })
      .from(blocks)
      .where(or(and(eq(blocks.blockerId, memberId), inArray(blocks.blockedId, others)), and(eq(blocks.blockedId, memberId), inArray(blocks.blockerId, others))))
      .limit(1)
    return Boolean(hit)
  }

  private async anyBlockAmong(q: Q, ids: string[]): Promise<boolean> {
    if (ids.length < 2) return false
    const [hit] = await q
      .select({ b: blocks.blockerId })
      .from(blocks)
      .where(and(inArray(blocks.blockerId, ids), inArray(blocks.blockedId, ids)))
      .limit(1)
    return Boolean(hit)
  }

  /** Who leaves when blocks stand between people already in the room: the non-host, else the later joiner. */
  private async conflictLosers(joined: ParticipantRow[], hostId: string): Promise<string[]> {
    const ids = joined.map((j) => j.memberId)
    if (ids.length < 2) return []
    const pairs = await this.db
      .select({ a: blocks.blockerId, b: blocks.blockedId })
      .from(blocks)
      .where(and(inArray(blocks.blockerId, ids), inArray(blocks.blockedId, ids)))
    const order = new Map(ids.map((i, n) => [i, n]))
    const losers = new Set<string>()
    for (const { a, b } of pairs) {
      if (losers.has(a) || losers.has(b)) continue
      losers.add(a === hostId ? b : b === hostId ? a : order.get(a)! > order.get(b)! ? a : b)
    }
    return [...losers]
  }

  /** A member is out of the room. Hands the meeting on or ends it if that leaves it hostless or empty. */
  private async departed(meetingId: string, memberId: string, disconnect: boolean): Promise<void> {
    const changed = await this.db
      .update(mp)
      .set({ status: 'left', leftAt: new Date(), sid: null })
      .where(and(eq(mp.meetingId, meetingId), eq(mp.memberId, memberId), eq(mp.status, 'joined')))
      .returning({ id: mp.memberId })
    if (changed.length === 0) return
    if (disconnect) await this.removeFromRoom(meetingId, memberId)
    await this.settle(meetingId)
  }

  /** Never an empty meeting, never a hostless one: the longest-present eligible participant takes over, else it ends. */
  private async settle(meetingId: string): Promise<void> {
    const [meeting] = await this.db.select().from(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.status, 'open')))
    if (!meeting) return
    const joined = await this.joined(this.db, meetingId)
    if (joined.length === 0) return this.close(meetingId)
    if (joined.some((j) => j.memberId === meeting.hostId)) return
    for (const candidate of joined) {
      if (!(await canCall(this.db, this.config, candidate.memberId))) continue
      try {
        await this.db.update(meetings).set({ hostId: candidate.memberId }).where(and(eq(meetings.id, meetingId), eq(meetings.hostId, meeting.hostId)))
        return
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
      }
    }
    await this.close(meetingId)
  }

  /** Ends an open meeting, frees its seats and drops its room. Safe to call twice. */
  private async close(meetingId: string): Promise<void> {
    const changed = await this.db
      .update(meetings)
      .set({ status: 'ended', endedAt: new Date() })
      .where(and(eq(meetings.id, meetingId), eq(meetings.status, 'open')))
      .returning({ id: meetings.id })
    if (changed.length === 0) return
    await this.freeSeats(meetingId)
    await this.dropRoom(meetingId)
  }

  /** Everyone still marked joined in a meeting that is over is no longer in a meeting. */
  private async freeSeats(meetingId: string): Promise<void> {
    await this.db
      .update(mp)
      .set({ status: 'left', leftAt: new Date(), sid: null })
      .where(and(eq(mp.meetingId, meetingId), eq(mp.status, 'joined')))
  }

  private async removeFromRoom(meetingId: string, memberId: string): Promise<void> {
    try {
      await this.rooms.removeParticipant(meetingId, memberId)
    } catch (err) {
      // The next pass sees them in the room and tries again.
      this.logger.error(`could not remove ${memberId} from the room of meeting ${meetingId}: ${String(err)}`)
    }
  }

  private async dropRoom(meetingId: string): Promise<void> {
    try {
      await this.rooms.deleteRoom(meetingId)
    } catch (err) {
      // The room empties itself after its short timeout; the state here is already right.
      this.logger.error(`could not delete the room of meeting ${meetingId}: ${String(err)}`)
    }
  }

  /** The meeting and the viewer's own row, if the viewer was invited and not removed; else not_found. */
  private async mine(me: Who, meetingId: string): Promise<{ meeting: MeetingRow; participant: ParticipantRow }> {
    if (!isUuid(meetingId)) throw nf()
    await this.expireStale()
    const [row] = await this.db
      .select({ meeting: meetings, participant: mp })
      .from(mp)
      .innerJoin(meetings, eq(meetings.id, mp.meetingId))
      .where(and(eq(mp.meetingId, meetingId), eq(mp.memberId, me.id)))
    if (!row || row.participant.status === 'removed') throw nf()
    return row
  }

  /** An open meeting this member hosts, or not_found. */
  private async hosted(me: Who, meetingId: string): Promise<MeetingRow> {
    const { meeting } = await this.mine(me, meetingId)
    if (meeting.hostId !== me.id || meeting.status !== 'open') throw nf()
    return meeting
  }

  private async person(id: string): Promise<Person> {
    const [row] = await this.db.select({ id: members.id, handle: members.handle, displayName: members.displayName }).from(members).where(eq(members.id, id))
    return row ?? { id, handle: '', displayName: null }
  }

  private async view(meeting: MeetingRow, viewerId: string): Promise<MeetingView> {
    const rows = await this.db
      .select({ id: members.id, handle: members.handle, displayName: members.displayName, status: mp.status, invitedAt: mp.invitedAt, joinedAt: mp.joinedAt })
      .from(mp)
      .innerJoin(members, eq(members.id, mp.memberId))
      .where(eq(mp.meetingId, meeting.id))
    const mine = rows.find((r) => r.id === viewerId)
    const cutoff = this.inviteCutoff().getTime()
    const inside = meeting.status === 'open' && mine?.status === 'joined'
    const participants: MeetingPerson[] = inside
      ? rows
          .filter((r) => r.status === 'joined' || (r.status === 'invited' && r.invitedAt.getTime() > cutoff))
          .sort((a, b) => Number(b.id === meeting.hostId) - Number(a.id === meeting.hostId) || (a.joinedAt?.getTime() ?? Infinity) - (b.joinedAt?.getTime() ?? Infinity))
          .map((r) => ({ id: r.id, handle: r.handle, displayName: r.displayName, state: r.status === 'joined' ? ('joined' as const) : ('invited' as const), isHost: r.id === meeting.hostId }))
      : []
    const host = rows.find((r) => r.id === meeting.hostId)
    return {
      id: meeting.id,
      status: meeting.status,
      locked: meeting.locked,
      capacity: MAX_PARTICIPANTS,
      role: meeting.hostId === viewerId ? 'host' : 'participant',
      me: mine?.status ?? 'removed',
      host: host ? { id: host.id, handle: host.handle, displayName: host.displayName } : await this.person(meeting.hostId),
      participants,
      endedAt: meeting.endedAt?.toISOString() ?? null,
    }
  }
}
