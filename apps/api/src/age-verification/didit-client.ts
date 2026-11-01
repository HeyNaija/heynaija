import { DIDIT_API_URL, type DiditConfig } from './config.js'
import { type DocumentRef, documentFromDecision } from './person-key.js'
import { methodFromDecision } from './state.js'

export const DIDIT_CLIENT = Symbol('DIDIT_CLIENT')

/** What we read from a decision: Didit's status for the session, whose it is and how it was approved. Nothing else is passed on. */
export type DiditDecision = {
  sessionId: string
  status: string
  vendorData: string
  method: string
  /** The decision carries a duplicated-face or duplicated-document risk. */
  duplicate: boolean
  /** The approved ID document, if there is one: handed on only to be turned into a key at once, never stored or logged. */
  document: DocumentRef | null
}

/** Didit's risk codes for one person appearing on several accounts or documents. */
const DUPLICATE_RISKS = new Set(['DUPLICATED_FACE', 'POSSIBLE_DUPLICATED_FACE', 'FRONT_CAMERA_DUPLICATED_FACE', 'DUPLICATED_DOCUMENT'])

/** Whether any string anywhere in the decision is one of those codes. They sit in per-feature warnings, so the whole thing is scanned. */
export function hasDuplicateRisk(value: unknown): boolean {
  if (typeof value === 'string') return DUPLICATE_RISKS.has(value)
  if (Array.isArray(value)) return value.some(hasDuplicateRisk)
  if (value !== null && typeof value === 'object') return Object.values(value).some(hasDuplicateRisk)
  return false
}

export interface DiditClient {
  /** Starts a hosted check for a member; `url` is where to send them. */
  createSession(input: { memberId: string; callbackUrl: string }): Promise<{ sessionId: string; url: string }>
  /** The authoritative state of a session, for polling when a webhook did not arrive. */
  getDecision(sessionId: string): Promise<DiditDecision>
}

const TIMEOUT_MS = 10_000

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/** Didit's REST API (https://docs.didit.me/sessions-api/create-session). Never called from tests: they pass a fetch of their own. */
export class HttpDiditClient implements DiditClient {
  constructor(
    private readonly config: Pick<DiditConfig, 'apiKey' | 'workflowId'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${DIDIT_API_URL}${path}`, {
      ...init,
      headers: { 'x-api-key': this.config.apiKey, accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // The body of an error is not put in the message: it could echo a credential.
    if (!res.ok) throw new Error(`Didit answered ${res.status}`)
    const body: unknown = await res.json().catch(() => null)
    if (body === null || typeof body !== 'object') throw new Error('Didit sent an answer that is not JSON')
    return body as Record<string, unknown>
  }

  async createSession(input: { memberId: string; callbackUrl: string }): Promise<{ sessionId: string; url: string }> {
    const body = await this.call('/v3/session/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflow_id: this.config.workflowId, vendor_data: input.memberId, callback: input.callbackUrl }),
    })
    const sessionId = str(body.session_id)
    const url = str(body.url)
    // The member is redirected to this address, so it must be an https one.
    if (!sessionId || !url || !/^https:\/\//i.test(url)) throw new Error('Didit did not return a session and a hosted address')
    return { sessionId, url }
  }

  async getDecision(sessionId: string): Promise<DiditDecision> {
    const body = await this.call(`/v3/session/${encodeURIComponent(sessionId)}/decision/`, { method: 'GET' })
    const id = str(body.session_id)
    const status = str(body.status)
    if (!id || !status) throw new Error('Didit did not return a decision')
    return { sessionId: id, status, vendorData: str(body.vendor_data) ?? '', method: methodFromDecision(body), duplicate: hasDuplicateRisk(body), document: documentFromDecision(body) }
  }
}
