import { type Db, members, privacyRequests, PRIVACY_REQUEST_KINDS, PRIVACY_REQUEST_STATUSES } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Env } from '../env.js'
import { DB, ENV } from '../tokens.js'

/** The statuses of a request nobody has finished with. */
export const OPEN_REQUEST = ['received', 'verifying', 'in_progress'] as const satisfies readonly (typeof PRIVACY_REQUEST_STATUSES)[number][]

/** A day, for the due dates here and the deletion's grace period and job timings. */
export const DAY_MS = 24 * 60 * 60 * 1000

export type RequestKind = (typeof PRIVACY_REQUEST_KINDS)[number]

/** A request still to be answered, with the handle of the account it is about, if any. */
export type OpenRequest = {
  id: string
  kind: RequestKind
  channel: string
  status: string
  receivedAt: Date
  dueBy: Date
  handle: string | null
}

export class PrivacyRequestError extends Error {}

/**
 * Privacy requests (docs/adr/0016): one row per request, from Settings or by
 * email, with when it came in, when it is due and when it was closed. Those made
 * by email are recorded and closed with `pnpm privacy-request`
 * (docs/governance/privacy-requests.md).
 */
@Injectable()
export class PrivacyRequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'PRIVACY_REQUEST_DUE_DAYS'>,
  ) {}

  /**
   * A request that came in by email, recorded as it arrives, so its due date runs
   * from then. `memberId` is null when no account has the address it came from.
   */
  async record(
    { memberId, kind, notes = '' }: { memberId: string | null; kind: RequestKind; notes?: string },
    now = new Date(),
  ): Promise<{ id: string; dueBy: Date }> {
    const [row] = await this.db
      .insert(privacyRequests)
      .values({ memberId, kind, channel: 'email', status: 'received', receivedAt: now, dueBy: new Date(now.getTime() + this.env.PRIVACY_REQUEST_DUE_DAYS * DAY_MS), notes })
      .returning({ id: privacyRequests.id, dueBy: privacyRequests.dueBy })
    return row!
  }

  async get(id: string): Promise<{ id: string; kind: RequestKind; status: string; memberId: string | null } | null> {
    const [row] = await this.db
      .select({ id: privacyRequests.id, kind: privacyRequests.kind, status: privacyRequests.status, memberId: privacyRequests.memberId })
      .from(privacyRequests)
      .where(eq(privacyRequests.id, id))
    return row ?? null
  }

  /** Every request still to be answered, the soonest due first. */
  async open(): Promise<OpenRequest[]> {
    return this.db
      .select({
        id: privacyRequests.id,
        kind: privacyRequests.kind,
        channel: privacyRequests.channel,
        status: privacyRequests.status,
        receivedAt: privacyRequests.receivedAt,
        dueBy: privacyRequests.dueBy,
        handle: members.handle,
      })
      .from(privacyRequests)
      .leftJoin(members, eq(members.id, privacyRequests.memberId))
      .where(inArray(privacyRequests.status, OPEN_REQUEST))
      .orderBy(asc(privacyRequests.dueBy))
  }

  /** Requests still open after the day they were due, oldest first. */
  async overdue(now = new Date()): Promise<{ id: string; kind: string; dueBy: Date }[]> {
    return this.db
      .select({ id: privacyRequests.id, kind: privacyRequests.kind, dueBy: privacyRequests.dueBy })
      .from(privacyRequests)
      .where(and(inArray(privacyRequests.status, OPEN_REQUEST), lt(privacyRequests.dueBy, now)))
      .orderBy(asc(privacyRequests.dueBy))
  }

  /**
   * Closes a request: answered, or refused (say why in `notes`). A deletion that
   * has been scheduled closes itself when the account is erased; until then only
   * cancelling it, or refusing one never acted on, closes it here.
   */
  async close(id: string, { refused = false, notes = '' }: { refused?: boolean; notes?: string } = {}, now = new Date()): Promise<void> {
    const request = await this.get(id)
    if (!request) throw new PrivacyRequestError('no privacy request has that ID')
    if (!(OPEN_REQUEST as readonly string[]).includes(request.status)) throw new PrivacyRequestError(`that request is already ${request.status}`)
    if (request.kind === 'deletion' && request.status === 'in_progress') {
      throw new PrivacyRequestError('that deletion is scheduled: it is completed when the account is erased')
    }
    if (request.kind === 'deletion' && !refused) {
      throw new PrivacyRequestError('a deletion request is completed by deleting the account (delete-account --request), or refused')
    }
    await this.db
      .update(privacyRequests)
      .set({
        status: refused ? 'refused' : 'completed',
        closedAt: now,
        notes: notes ? sql`case when ${privacyRequests.notes} = '' then ${notes} else ${privacyRequests.notes} || E'\n' || ${notes} end` : undefined,
      })
      .where(eq(privacyRequests.id, id))
  }
}
