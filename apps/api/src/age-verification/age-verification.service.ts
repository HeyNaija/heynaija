import { type Db, ageVerifications } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { FeatureFlags } from '../flags/feature-flags.js'
import { DB } from '../tokens.js'
import type { DiditConfig } from './config.js'
import { DIDIT_CLIENT, type DiditClient } from './didit-client.js'
import { verifyDiditSignature } from './signature.js'
import { type DiditStatusEvent, type StoredVerification, type VerificationStatus, isVerifiedAdult, methodFromDecision, sessionAction, transition } from './state.js'

export const DIDIT_CONFIG = Symbol('DIDIT_CONFIG')

export class AgeVerificationError extends Error {
  constructor(readonly code: 'unavailable' | 'upstream') {
    super(code)
  }
}

/** The webhook is not accepted: not configured, or not signed by Didit. Say no more than that to the caller. */
export class WebhookRejectedError extends Error {}

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
  decision: z.unknown().optional(),
})

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
          await this.apply(memberId, { sessionId: decision.sessionId, status: decision.status, method: decision.method })
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
    const { session_id: sessionId, status, vendor_data: memberId, decision } = parsed.data
    if (!memberId || !UUID.test(memberId)) return
    await this.apply(memberId, { sessionId, status, method: status === 'Approved' ? methodFromDecision(decision) : undefined })
  }

  private async apply(memberId: string, event: DiditStatusEvent): Promise<void> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const current = await this.load(memberId)
      const change = transition(current, event, new Date())
      if (change.change === 'none' || !current) return
      const updated = await this.db
        .update(ageVerifications)
        .set({ status: change.status, method: change.method, verifiedAt: change.verifiedAt, updatedAt: new Date() })
        .where(
          and(
            eq(ageVerifications.memberId, memberId),
            eq(ageVerifications.diditSessionId, event.sessionId),
            // Only if nothing changed it since it was read; otherwise read again and decide again.
            eq(ageVerifications.status, current.status),
          ),
        )
        .returning({ memberId: ageVerifications.memberId })
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
