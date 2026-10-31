import { CALL_STATUSES, type Db, calls, members } from '@heynaija/db'
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { ROOM_SERVICE, type RoomEvent, type RoomService } from '../gists/room-service.js'
import { DB } from '../tokens.js'
import { canCall, isAgeVerifiedAdult } from './can-call.js'

export type CallsConfig = {
  /** CALLS_MEMBERS: the beta allow-list of handles (see can-call.ts). */
  callsMembers: readonly string[]
  /** The LiveKit address browsers connect to; empty when LiveKit is not configured. */
  livekitUrl: string
  /** CALLS_ENABLED (through `callsEnabled`). When off, the only thing that runs is the teardown of live calls. */
  enabled: boolean
}

export const CALLS_CONFIG = Symbol('CALLS_CONFIG')

/** How long a call rings before it is missed (docs/adr/0017 section 5 was 30s; the product decision is 45s). */
export const RING_TIMEOUT_MS = 45_000
/** After the callee answers, how long both sides have to connect before an empty room means a dead call. */
export const CONNECT_GRACE_MS = 60_000
const RECONCILE_EVERY_MS = 60_000
const EMPTY_TIMEOUT_S = 60
// LiveKit's own default for how long a room stays after its last participant leaves.
const DEPARTURE_TIMEOUT_S = 20

/** `not_found` covers everything the caller must not be able to tell apart: missing, not eligible, blocked, over. */
export type CallErrorCode = 'not_found' | 'busy' | 'already_in_call' | 'livekit_unavailable'

const STATUS: Record<CallErrorCode, number> = { not_found: 404, busy: 409, already_in_call: 409, livekit_unavailable: 502 }

export class CallError extends Error {
  readonly status: number
  constructor(readonly code: CallErrorCode) {
    super(code)
    this.status = STATUS[code]
  }
}

type CallStatus = (typeof CALL_STATUSES)[number]
type Who = { id: string; handle: string }
export type CallView = {
  id: string
  status: CallStatus
  /** Which side the viewer is. */
  role: 'caller' | 'callee'
  other: { id: string; handle: string; displayName: string | null }
  ringExpiresAt: string
  answeredAt: string | null
  endedAt: string | null
}
type CallRow = typeof calls.$inferSelect

const OPEN: CallStatus[] = ['ringing', 'active']
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const isUniqueViolation = (err: unknown): boolean => {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 5; e = e.cause as typeof e, depth++) {
    if (e.code === '23505') return true
  }
  return false
}

@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallsService.name)
  private timer: NodeJS.Timeout | undefined

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ROOM_SERVICE) private readonly rooms: RoomService,
    @Inject(CALLS_CONFIG) private readonly config: CallsConfig,
  ) {}

  /**
   * One pass a minute where LiveKit is configured. With calls on it is the reconcile job.
   * With calls off it is the kill switch (ADR 0017 section 7): any call still open is ended
   * and its room deleted. There are no routes or webhook handling for calls while off.
   */
  onModuleInit(): void {
    if (!this.config.livekitUrl) return
    const run = () => this.tick().catch((err) => this.logger.error(`call pass failed: ${String(err)}`))
    void run()
    this.timer = setInterval(run, RECONCILE_EVERY_MS)
    this.timer.unref()
  }

  /** One pass of whichever job applies to the current flag. Returns how many calls it ended (0 when on). */
  async tick(): Promise<number> {
    if (this.config.enabled) {
      await this.reconcile()
      return 0
    }
    return this.shutdownLive()
  }

  /** Ends every ringing or active call and deletes its room. One indexed query; no rows in the normal case. */
  async shutdownLive(): Promise<number> {
    const ended = await this.db
      .update(calls)
      .set({ status: sql`case when ${calls.status} = 'ringing' then 'missed' else 'ended' end`, endedAt: new Date() })
      .where(inArray(calls.status, OPEN))
      .returning({ id: calls.id })
    for (const { id } of ended) await this.dropRoom(id)
    return ended.length
  }

  onModuleDestroy(): void {
    clearInterval(this.timer)
  }

  // ---- settings and eligibility ---------------------------------------------

  /** Whether the "Allow calls" switch is on. Only for members who could ever use calls. */
  async settings(me: Who): Promise<{ allowCalls: boolean }> {
    if (!isAgeVerifiedAdult(me, this.config)) throw new CallError('not_found')
    const [row] = await this.db.select({ allowCalls: members.allowCalls }).from(members).where(eq(members.id, me.id))
    return { allowCalls: row?.allowCalls ?? false }
  }

  async setAllowCalls(me: Who, allowCalls: boolean): Promise<{ allowCalls: boolean }> {
    if (!isAgeVerifiedAdult(me, this.config)) throw new CallError('not_found')
    await this.db.update(members).set({ allowCalls }).where(eq(members.id, me.id))
    return { allowCalls }
  }

  /** For the Call button. A plain yes or no: never why. */
  async canCallMember(me: Who, otherId: string): Promise<boolean> {
    return isUuid(otherId) && canCall(this.db, this.config, me.id, otherId)
  }

  // ---- starting and answering -----------------------------------------------

  async create(caller: Who, calleeId: string): Promise<CallView> {
    if (!isUuid(calleeId) || calleeId === caller.id) throw new CallError('not_found')
    await this.expireStale()
    let row: CallRow
    try {
      row = await this.db.transaction(async (tx) => {
        // Locking both members serialises their calls, so neither can be in two.
        await tx.select({ id: members.id }).from(members).where(inArray(members.id, [caller.id, calleeId])).orderBy(members.id).for('update')
        // The block rule lives in canCall, and its refusal is the same 404 as nobody there.
        if (!(await canCall(tx, this.config, caller.id, calleeId))) throw new CallError('not_found')
        const open = await tx
          .select({ callerId: calls.callerId, calleeId: calls.calleeId })
          .from(calls)
          .where(
            and(
              inArray(calls.status, OPEN),
              or(inArray(calls.callerId, [caller.id, calleeId]), inArray(calls.calleeId, [caller.id, calleeId])),
            ),
          )
        if (open.some((c) => c.callerId === caller.id || c.calleeId === caller.id)) throw new CallError('already_in_call')
        if (open.length > 0) throw new CallError('busy')
        const [created] = await tx
          .insert(calls)
          .values({ callerId: caller.id, calleeId, ringExpiresAt: new Date(Date.now() + RING_TIMEOUT_MS) })
          .returning()
        return created!
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw new CallError('busy')
      throw err
    }
    try {
      await this.rooms.createRoom(row.id, { maxParticipants: 2, emptyTimeoutS: EMPTY_TIMEOUT_S, departureTimeoutS: DEPARTURE_TIMEOUT_S })
    } catch (err) {
      this.logger.error(`could not create the room of call ${row.id}: ${String(err)}`)
      await this.close(row.id, 'ended', OPEN)
      throw new CallError('livekit_unavailable')
    }
    return this.view(row, caller.id)
  }

  /** The call ringing for this member now, if any. */
  async incoming(me: Who): Promise<CallView | null> {
    // Anyone who cannot use calls at all gets the same 404 as a route that does not exist.
    if (!(await canCall(this.db, this.config, me.id))) throw new CallError('not_found')
    await this.expireStale()
    const [row] = await this.db
      .select()
      .from(calls)
      .where(and(eq(calls.calleeId, me.id), eq(calls.status, 'ringing')))
      .limit(1)
    return row ? this.view(row, me.id) : null
  }

  async get(me: Who, callId: string): Promise<CallView> {
    return this.view(await this.mine(me, callId), me.id)
  }

  async accept(me: Who, callId: string): Promise<CallView> {
    const call = await this.mine(me, callId)
    if (call.calleeId !== me.id || call.status !== 'ringing') throw new CallError('not_found')
    if (!(await canCall(this.db, this.config, call.callerId, call.calleeId))) {
      await this.close(call.id, 'missed', ['ringing'])
      throw new CallError('not_found')
    }
    const [updated] = await this.db
      .update(calls)
      .set({ status: 'active', answeredAt: new Date() })
      .where(and(eq(calls.id, call.id), eq(calls.status, 'ringing')))
      .returning()
    if (!updated) throw new CallError('not_found')
    return this.view(updated, me.id)
  }

  async decline(me: Who, callId: string): Promise<void> {
    const call = await this.mine(me, callId)
    if (call.calleeId !== me.id || call.status !== 'ringing') throw new CallError('not_found')
    await this.close(call.id, 'declined', ['ringing'])
  }

  /** The caller hangs up before it is answered: the callee sees a missed call. */
  async cancel(me: Who, callId: string): Promise<void> {
    const call = await this.mine(me, callId)
    if (call.callerId !== me.id || call.status !== 'ringing') throw new CallError('not_found')
    await this.close(call.id, 'missed', ['ringing'])
  }

  /** Either side hangs up. A call that is already over is not an error, so a retry is safe. */
  async end(me: Who, callId: string): Promise<void> {
    const call = await this.mine(me, callId)
    if (call.status === 'ringing') {
      await this.close(call.id, call.callerId === me.id ? 'missed' : 'declined', ['ringing'])
    } else if (call.status === 'active') {
      await this.close(call.id, 'ended', ['active'])
    }
  }

  /** A token for one of the two parties, re-checking everything on live data. Also the reconnect path. */
  async token(me: Who, callId: string): Promise<{ url: string; token: string; call: CallView }> {
    const call = await this.mine(me, callId)
    const may = call.callerId === me.id ? call.status === 'ringing' || call.status === 'active' : call.status === 'active'
    if (!may) throw new CallError('not_found')
    if (!(await canCall(this.db, this.config, call.callerId, call.calleeId))) {
      await this.close(call.id, call.status === 'ringing' ? 'missed' : 'ended', OPEN)
      throw new CallError('not_found')
    }
    const [self] = await this.db.select({ handle: members.handle, displayName: members.displayName }).from(members).where(eq(members.id, me.id))
    const jwt = await this.rooms.participantToken(call.id, me.id, self?.displayName ?? self?.handle ?? me.handle)
    return { url: this.config.livekitUrl, token: jwt, call: await this.view(call, me.id) }
  }

  // ---- LiveKit events and reconciliation --------------------------------------

  /**
   * One webhook event. Delivery is not guaranteed and may repeat or arrive out of
   * order, so every branch only sets state and is safe to run twice.
   */
  async handleEvent(event: RoomEvent): Promise<void> {
    if (event.kind === 'other' || !isUuid(event.room)) return
    const [call] = await this.db.select().from(calls).where(eq(calls.id, event.room))
    if (!call) return

    if (event.kind === 'room_finished') {
      await this.close(call.id, call.status === 'ringing' ? 'missed' : 'ended', OPEN)
      return
    }

    const side = event.identity === call.callerId ? 'caller' : event.identity === call.calleeId ? 'callee' : null
    if (event.kind === 'participant_left') {
      if (!side || !OPEN.includes(call.status)) return
      const sid = side === 'caller' ? call.callerSid : call.calleeSid
      // A reload makes a second connection under the same identity and LiveKit drops
      // the first: its leave names an older sid and must not end the call.
      if (event.sid && sid && sid !== event.sid) return
      if (call.status === 'active') await this.close(call.id, 'ended', ['active'])
      else if (side === 'caller') await this.close(call.id, 'missed', ['ringing'])
      return
    }

    // participant_joined: only the two parties, in a call that is still open, may stay.
    const staying =
      side !== null &&
      OPEN.includes(call.status) &&
      !(side === 'callee' && call.status !== 'active') &&
      (await canCall(this.db, this.config, call.callerId, call.calleeId))
    if (!staying) {
      await this.rooms.removeParticipant(call.id, event.identity)
      // A party who no longer qualifies takes the call down with them.
      if (side && OPEN.includes(call.status) && !(await canCall(this.db, this.config, call.callerId, call.calleeId))) {
        await this.close(call.id, call.status === 'ringing' ? 'missed' : 'ended', OPEN)
      }
      return
    }
    await this.db
      .update(calls)
      .set(side === 'caller' ? { callerSid: event.sid } : { calleeSid: event.sid })
      .where(eq(calls.id, call.id))
  }

  /**
   * Run every minute, and safe to run twice. Webhooks are hints; this settles what
   * they missed: rings that timed out, active calls with a side gone from the room,
   * and calls whose parties stopped being eligible (a block, a lapse, a suspension).
   */
  async reconcile(now: Date = new Date()): Promise<void> {
    await this.expireStale(now)
    const active = await this.db.select().from(calls).where(eq(calls.status, 'active'))
    for (const call of active) {
      try {
        if (!(await canCall(this.db, this.config, call.callerId, call.calleeId))) {
          await this.close(call.id, 'ended', ['active'])
          continue
        }
        if (!call.answeredAt || now.getTime() - call.answeredAt.getTime() < CONNECT_GRACE_MS) continue
        const present = new Set((await this.rooms.participants(call.id))?.map((p) => p.identity) ?? [])
        if (!(present.has(call.callerId) && present.has(call.calleeId))) await this.close(call.id, 'ended', ['active'])
      } catch (err) {
        // LiveKit is unreachable: leave the call for the next pass.
        this.logger.error(`could not reconcile call ${call.id}: ${String(err)}`)
      }
    }
  }

  // ---- internals ----------------------------------------------------------------

  /** Rings past their time become missed calls, whoever notices first. */
  private async expireStale(now: Date = new Date()): Promise<void> {
    const expired = await this.db
      .update(calls)
      .set({ status: 'missed', endedAt: now })
      .where(and(eq(calls.status, 'ringing'), lt(calls.ringExpiresAt, now)))
      .returning({ id: calls.id })
    for (const { id } of expired) await this.dropRoom(id)
  }

  /** Moves an open call to its final state (only from the states given) and drops its room. */
  private async close(callId: string, to: CallStatus, from: CallStatus[]): Promise<void> {
    const changed = await this.db
      .update(calls)
      .set({ status: to, endedAt: new Date() })
      .where(and(eq(calls.id, callId), inArray(calls.status, from)))
      .returning({ id: calls.id })
    if (changed.length > 0) await this.dropRoom(callId)
  }

  private async dropRoom(callId: string): Promise<void> {
    try {
      await this.rooms.deleteRoom(callId)
    } catch (err) {
      // The room empties itself after its short timeout; the state here is already right.
      this.logger.error(`could not delete the room of call ${callId}: ${String(err)}`)
    }
  }

  /** The call if this member is one of its two parties, or not_found. */
  private async mine(me: Who, callId: string): Promise<CallRow> {
    if (!isUuid(callId)) throw new CallError('not_found')
    await this.expireStale()
    const [row] = await this.db
      .select()
      .from(calls)
      .where(and(eq(calls.id, callId), or(eq(calls.callerId, me.id), eq(calls.calleeId, me.id))))
    if (!row) throw new CallError('not_found')
    return row
  }

  private async view(call: CallRow, viewerId: string): Promise<CallView> {
    const role = call.callerId === viewerId ? 'caller' : 'callee'
    const [other] = await this.db
      .select({ id: members.id, handle: members.handle, displayName: members.displayName })
      .from(members)
      .where(eq(members.id, role === 'caller' ? call.calleeId : call.callerId))
    return {
      id: call.id,
      status: call.status,
      role,
      other: other ?? { id: '', handle: '', displayName: null },
      ringExpiresAt: call.ringExpiresAt.toISOString(),
      answeredAt: call.answeredAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
    }
  }
}
