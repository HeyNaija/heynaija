import { type Db, ageVerifications } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { FeatureFlags } from '../flags/feature-flags.js'
import { DB } from '../tokens.js'
import type { DiditConfig } from './config.js'
import { DIDIT_CLIENT, type DiditClient, type DiditDecision } from './didit-client.js'
import { documentPersonKey } from './person-key.js'
import { verifyDiditSignature } from './signature.js'
import { type DiditStatusEvent, type StoredVerification, type VerificationStatus, isVerifiedAdult, sessionAction, statusFromDidit, transition } from './state.js'

export const DIDIT_CONFIG = Symbol('DIDIT_CONFIG')

export class AgeVerificationError extends Error {
  constructor(readonly code: 'unavailable' | 'upstream') {
    super(code)
  }
}

/** The webhook is not accepted: not configured, or not signed by Didit. Say no more than that to the caller. */
export class WebhookRejectedError extends Error {}

/** Didit could not be asked about the session just now. The webhook answers 5xx so that Didit sends it again. */
export class WebhookUpstreamError extends Error {}

export type AgeVerificationStatus = {
  /** Whether this member can start a check now: the flag is on for them and Didit is configured. */
  available: boolean
  status: 'none' | VerificationStatus
  verified: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const webhookBody = z.object({
  webhook_type: z.string(),
  session_id: z.string().min(1),
  status: z.string(),
  vendor_data: z.string().optional(),
})

/** Whether an error is the unique index on the person key being hit (drizzle wraps the driver's error as `cause`). */
function isPersonKeyConflict(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown }
    if (code === '23505' && constraint === 'age_verifications_person_idx') return true
  }
  return false
}

/** How many times a change is retried when another delivery changed the same row first. */
const ATTEMPTS = 3

/**
 * Age verification with Didit (docs/adr/0018). Keeps the outcome only: a status, how
 * an approval was reached, when, and Didit's session id. The document, the face, the
 * date of birth and Didit's payload are read, used for the status and dropped.
 */
@Injectable()
export class AgeVerificationService {
  private readonly logger = new Logger(AgeVerificationService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
    @Inject(DIDIT_CONFIG) private readonly config: DiditConfig | null,
    @Inject(DIDIT_CLIENT) private readonly didit: DiditClient | null,
  ) {}

  private async load(memberId: string): Promise<StoredVerification | undefined> {
    const [row] = await this.db.select().from(ageVerifications).where(eq(ageVerifications.memberId, memberId))
    return row
  }

  /** What is on record for the member, and whether they may start a check. */
  async status(memberId: string): Promise<AgeVerificationStatus> {
    const row = await this.load(memberId)
    const available = this.config !== null && (await this.flags.isEnabled('ageVerification', memberId))
    return { available, status: row?.status ?? 'none', verified: isVerifiedAdult(row) }
  }

  /**
   * Starts a hosted check and returns where to send the member. Asking again while a
   * session is open resumes it (Didit returns the same session for the same member
   * and workflow). The flag is the route's business; here it is only configuration.
   */
  async start(memberId: string): Promise<{ status: VerificationStatus; url: string | null }> {
    if (!this.config || !this.didit) throw new AgeVerificationError('unavailable')
    const current = await this.load(memberId)
    const action = sessionAction(current)
    if (action === 'already_verified') return { status: 'verified', url: null }
    if (action === 'in_review') return { status: 'in_review', url: null }

    let session: { sessionId: string; url: string }
    try {
      session = await this.didit.createSession({ memberId, callbackUrl: this.config.callbackUrl })
    } catch (err) {
      this.logger.error(`Didit session failed: ${err instanceof Error ? err.message : String(err)}`)
      throw new AgeVerificationError('upstream')
    }
    const now = new Date()
    await this.db
      .insert(ageVerifications)
      .values({ memberId, status: 'pending', diditSessionId: session.sessionId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: ageVerifications.memberId,
        set: { status: 'pending', diditSessionId: session.sessionId, method: null, verifiedAt: null, updatedAt: now },
        // Never over a result that became verified or went to review while the session was being made.
        setWhere: inArray(ageVerifications.status, ['pending', 'declined', 'expired']),
      })
    return { status: 'pending', url: session.url }
  }

  /**
   * The polling fallback for a webhook that never came: while a result is open, asks
   * Didit for the decision and applies it by the same rules as a webhook. Any
   * trouble reaching Didit leaves the stored result as it is.
   */
  async refresh(memberId: string): Promise<AgeVerificationStatus> {
    const row = await this.load(memberId)
    if (row && (row.status === 'pending' || row.status === 'in_review') && this.didit) {
      try {
        const decision = await this.didit.getDecision(row.diditSessionId)
        // A decision about someone else's session must never change this member's result.
        if (decision.vendorData === memberId) {
          await this.apply(memberId, decision)
        }
      } catch (err) {
        this.logger.warn(`Didit decision could not be read: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return this.status(memberId)
  }

  /**
   * Reads one webhook delivery. Throws WebhookRejectedError unless it is signed by
   * Didit with our secret and fresh. Anything validly signed that is not about a
   * member's current session is accepted and ignored, so Didit does not retry it.
   * Deliveries repeat and arrive out of order; the state rules make that safe.
   */
  async handleWebhook(body: unknown, headers: Record<string, string | string[] | undefined>): Promise<void> {
    if (!this.config) throw new WebhookRejectedError('not configured')
    const checked = verifyDiditSignature({ body, headers, secret: this.config.webhookSecret, nowMs: Date.now() })
    if (!checked.ok) throw new WebhookRejectedError(checked.reason)

    const parsed = webhookBody.safeParse(body)
    if (!parsed.success || parsed.data.webhook_type !== 'status.updated') return
    const { session_id: sessionId, status, vendor_data: memberId } = parsed.data
    if (!memberId || !UUID.test(memberId) || statusFromDidit(status) === null) return
    const current = await this.load(memberId)
    if (!current || current.diditSessionId !== sessionId || !this.didit) return

    // The webhook is a signal, not the truth. Didit retries and resends old events with a fresh
    // timestamp and a valid signature, so an old "Approved" could undo a later "Declined". What
    // the body says is therefore not used: Didit is asked what the session's decision is now.
    let decision: DiditDecision
    try {
      decision = await this.didit.getDecision(sessionId)
    } catch (err) {
      this.logger.warn(`Didit decision could not be read for a webhook: ${err instanceof Error ? err.message : String(err)}`)
      // A failure answer makes Didit retry; a 2xx would drop the event for good.
      throw new WebhookUpstreamError()
    }
    if (decision.vendorData !== memberId || decision.sessionId !== sessionId) return
    await this.apply(memberId, decision)
  }

  /**
   * What Didit's decision means for this member, by the state rules, plus the duplicate-
   * document rule: an approval by document check is keyed on the document (person-key.ts)
   * and the unique index on that key lets one document hold one verified account.
   * An approval with no usable document number cannot be told from anyone else's, so it
   * is not counted. An age-estimation approval has no document: no key, no dedupe.
   */
  private async apply(memberId: string, decision: DiditDecision): Promise<void> {
    let status = decision.status
    let personKey: string | null = null
    let outcome: string | null = decision.duplicate && status === 'Approved' ? 'duplicate_flagged' : null
    if (status === 'Approved' && !decision.duplicate && decision.method === 'document') {
      const secret = this.config?.personKeySecret
      personKey = secret ? documentPersonKey(secret, decision.document) : null
      if (!personKey) {
        status = 'Declined'
        outcome = 'no_document_number'
      }
    }
    const event: DiditStatusEvent = { sessionId: decision.sessionId, status, method: decision.method, duplicate: decision.duplicate, personKey }

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const current = await this.load(memberId)
      const change = transition(current, event, new Date())
      if (change.change === 'none' || !current) return
      const set = {
        status: change.status,
        method: change.method,
        verifiedAt: change.verifiedAt,
        personKey: change.personKey ?? null,
        // Why a result is declined, for support; nothing for any other status.
        outcome: change.status === 'declined' ? outcome : null,
        updatedAt: new Date(),
      }
      // Only if nothing changed it since it was read; otherwise read again and decide again.
      const where = and(eq(ageVerifications.memberId, memberId), eq(ageVerifications.diditSessionId, decision.sessionId), eq(ageVerifications.status, current.status))
      let updated: unknown[]
      try {
        updated = await this.db.update(ageVerifications).set(set).where(where).returning({ memberId: ageVerifications.memberId })
      } catch (err) {
        if (!isPersonKeyConflict(err)) throw err
        // The document is already some other account's verified one (including a race with
        // that account being approved at this moment). This account is declined. Nothing
        // that identifies the person or the other account goes in the log or the outcome.
        this.logger.warn('A document that is already verified on another account was used again; the second account was declined')
        updated = await this.db
          .update(ageVerifications)
          .set({ status: 'declined', method: null, verifiedAt: null, personKey: null, outcome: 'duplicate_person', updatedAt: new Date() })
          .where(where)
          .returning({ memberId: ageVerifications.memberId })
      }
      if (updated.length > 0) return
    }
    this.logger.warn(`Age verification result for ${memberId} kept changing; one event was dropped`)
  }

  /**
   * The adult gate for calls: `undefined` while the flag is off for this member (the
   * old rule applies), otherwise whether a verified result is on record. Reads the
   * row every time; nothing is cached across requests.
   */
  async adultGate(memberId: string): Promise<boolean | undefined> {
    if (!(await this.flags.isEnabled('ageVerification', memberId))) return undefined
    return isVerifiedAdult(await this.load(memberId))
  }
}
