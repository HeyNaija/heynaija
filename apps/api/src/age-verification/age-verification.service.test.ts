import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageVerifications, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { FeatureFlags } from '../flags/feature-flags.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { AgeVerificationError, AgeVerificationService, WebhookRejectedError, WebhookUpstreamError } from './age-verification.service.js'
import type { DiditConfig } from './config.js'
import type { DiditClient, DiditDecision } from './didit-client.js'
import { signDiditBody } from './signature.js'

const ada = randomUUID()
const bayo = randomUUID()
const SECRET = 'whsec_test'
const config: DiditConfig = { apiKey: 'k', workflowId: 'wf', webhookSecret: SECRET, callbackUrl: 'https://heynaija.test/settings/age-verification' }

class FakeDidit implements DiditClient {
  created: { memberId: string; callbackUrl: string }[] = []
  decisions = new Map<string, DiditDecision>()
  failing = false
  private n = 0
  async createSession(input: { memberId: string; callbackUrl: string }) {
    if (this.failing) throw new Error('Didit is down')
    this.created.push(input)
    return { sessionId: `sess-${++this.n}`, url: `https://verify.didit.test/session/${this.n}` }
  }
  async getDecision(sessionId: string): Promise<DiditDecision> {
    if (this.failing) throw new Error('Didit is down')
    const found = this.decisions.get(sessionId)
    if (!found) throw new Error('no such session')
    return found
  }
}

let didit: FakeDidit
let flags: FeatureFlags
let service: AgeVerificationService
const build = (cfg: DiditConfig | null = config, env: 'development' | 'production' = 'development') => {
  flags = new FeatureFlags(db, env)
  service = new AgeVerificationService(db, flags, cfg, cfg ? didit : null)
}

before(migrate)
beforeEach(async () => {
  await reset()
  didit = new FakeDidit()
  build()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
  ])
})
after(() => pool.end())

const rowOf = async (id: string) => (await db.select().from(ageVerifications).where(eq(ageVerifications.memberId, id)))[0]

/** A delivery as Didit sends it, signed the documented way a moment ago. */
const delivery = (over: Record<string, unknown> = {}, secret = SECRET) => {
  const ts = Math.floor(Date.now() / 1000)
  const body = {
    webhook_type: 'status.updated',
    session_id: 'sess-1',
    status: 'Approved',
    vendor_data: ada,
    created_at: 1,
    timestamp: ts,
    decision: { features: ['ID_VERIFICATION'], id_verifications: [{ status: 'Approved', full_name: 'Ada Obi', date_of_birth: '1990-01-01' }] },
    ...over,
  }
  return {
    body,
    headers: { 'x-timestamp': String(ts), 'x-signature-v2': signDiditBody(body, secret) },
  }
}
/**
 * Delivers a webhook. What Didit would answer if asked about the session defaults to what
 * the body says; pass `truth` for when the two differ (a retried or resent old event).
 */
const deliver = (d: ReturnType<typeof delivery>, truth: Partial<DiditDecision> = {}) => {
  const body = d.body as { session_id: string; status: string; vendor_data: string }
  didit.decisions.set(body.session_id, { sessionId: body.session_id, status: body.status, vendorData: body.vendor_data, method: 'document', duplicate: false, ...truth })
  return service.handleWebhook(d.body, d.headers)
}

test('starting a check creates a Didit session for the member and keeps only its id', async () => {
  const started = await service.start(ada)
  assert.deepEqual(started, { status: 'pending', url: 'https://verify.didit.test/session/1' })
  assert.deepEqual(didit.created, [{ memberId: ada, callbackUrl: config.callbackUrl }])
  const row = await rowOf(ada)
  assert.equal(row?.status, 'pending')
  assert.equal(row?.diditSessionId, 'sess-1')
  assert.equal(row?.verifiedAt, null)
  assert.equal(row?.method, null)
})

test('without Didit settings nothing is offered or created, and nothing crashes', async () => {
  build(null)
  assert.equal((await service.status(ada)).available, false)
  await assert.rejects(() => service.start(ada), (err) => err instanceof AgeVerificationError && err.code === 'unavailable')
  assert.equal(await rowOf(ada), undefined)
})

test('with the flag off nothing is offered', async () => {
  build(config, 'production')
  assert.equal((await service.status(ada)).available, false)
})

test('the status says what is on record, and offers a check only when it is configured and on', async () => {
  assert.deepEqual(await service.status(ada), { available: true, status: 'none', verified: false })
  await service.start(ada)
  assert.deepEqual(await service.status(ada), { available: true, status: 'pending', verified: false })
})

test('a verified member is not sent through it again', async () => {
  await service.start(ada)
  await deliver(delivery())
  const again = await service.start(ada)
  assert.deepEqual(again, { status: 'verified', url: null })
  assert.equal(didit.created.length, 1)
})

test('an approved delivery sets verified with a method and a date, and nothing else of it is kept', async () => {
  await service.start(ada)
  await deliver(delivery())
  const row = await rowOf(ada)
  assert.equal(row?.status, 'verified')
  assert.equal(row?.method, 'document')
  assert.ok(row?.verifiedAt instanceof Date)
  assert.deepEqual(Object.keys(row ?? {}).sort(), ['createdAt', 'diditSessionId', 'memberId', 'method', 'status', 'updatedAt', 'verifiedAt'])
  assert.doesNotMatch(JSON.stringify(row), /Ada Obi|1990/)
  assert.deepEqual(await service.status(ada), { available: true, status: 'verified', verified: true })
})

test('declined and expired deliveries are recorded; the member may then start again', async () => {
  await service.start(ada)
  await deliver(delivery({ status: 'Declined' }))
  assert.equal((await rowOf(ada))?.status, 'declined')
  assert.equal((await rowOf(ada))?.verifiedAt, null)

  const second = await service.start(ada)
  assert.equal(second.status, 'pending')
  assert.equal((await rowOf(ada))?.diditSessionId, 'sess-2')
  // The first session's late approval no longer counts: only the current session can change the result.
  await deliver(delivery({ status: 'Approved' }))
  assert.equal((await rowOf(ada))?.status, 'pending')

  await deliver(delivery({ session_id: 'sess-2', status: 'Expired' }))
  assert.equal((await rowOf(ada))?.status, 'expired')
})

test('a delivery with a bad signature, a wrong secret or a stale time changes nothing', async () => {
  await service.start(ada)
  const forged = delivery({}, 'whsec_not_ours')
  await assert.rejects(() => deliver(forged), WebhookRejectedError)
  const tampered = delivery()
  await assert.rejects(() => service.handleWebhook({ ...tampered.body, status: 'Approved', vendor_data: bayo }, tampered.headers), WebhookRejectedError)
  const stale = delivery()
  await assert.rejects(
    () => service.handleWebhook(stale.body, { ...stale.headers, 'x-timestamp': String(Math.floor(Date.now() / 1000) - 3600) }),
    WebhookRejectedError,
  )
  assert.equal((await rowOf(ada))?.status, 'pending')
})

test('without a webhook secret every delivery is refused, even one signed with an empty key', async () => {
  build(null)
  await assert.rejects(() => deliver(delivery({}, '')), WebhookRejectedError)
})

test('a verified delivery for a session we do not know, or about nobody, or of another kind, is accepted and ignored', async () => {
  await service.start(ada)
  await deliver(delivery({ session_id: 'unknown' }))
  await deliver(delivery({ vendor_data: randomUUID() }))
  await deliver(delivery({ vendor_data: 'not-a-uuid' }))
  await deliver(delivery({ webhook_type: 'data.updated' }))
  await deliver(delivery({ status: 'In Progress' }))
  assert.equal((await rowOf(ada))?.status, 'pending')
})

test('an out-of-order delivery cannot undo an approval', async () => {
  await service.start(ada)
  await deliver(delivery())
  await deliver(delivery({ status: 'In Review' }))
  assert.equal((await rowOf(ada))?.status, 'verified')
})

test('a delivery is not trusted for someone else: the member in vendor_data must own the session', async () => {
  await service.start(ada)
  await service.start(bayo) // sess-2
  await deliver(delivery({ session_id: 'sess-2', vendor_data: ada }))
  assert.equal((await rowOf(bayo))?.status, 'pending')
  assert.equal((await rowOf(ada))?.status, 'pending')
})

test('polling fetches the decision and records an approval', async () => {
  await service.start(ada)
  didit.decisions.set('sess-1', { sessionId: 'sess-1', status: 'Approved', vendorData: ada, method: 'age_estimation', duplicate: false })
  assert.deepEqual(await service.refresh(ada), { available: true, status: 'verified', verified: true })
  assert.equal((await rowOf(ada))?.method, 'age_estimation')
})

test('polling ignores a decision that is not about this member, and survives Didit being down', async () => {
  await service.start(ada)
  didit.decisions.set('sess-1', { sessionId: 'sess-1', status: 'Approved', vendorData: bayo, method: 'document', duplicate: false })
  assert.equal((await service.refresh(ada)).status, 'pending')
  didit.failing = true
  assert.equal((await service.refresh(ada)).status, 'pending')
})

test('polling asks Didit only while a result is open', async () => {
  assert.equal((await service.refresh(ada)).status, 'none')
  await service.start(ada)
  await deliver(delivery({ status: 'Declined' }))
  didit.failing = true // would throw if asked
  assert.equal((await service.refresh(ada)).status, 'declined')
})

test('the adult gate: not in force with the flag off, otherwise the table decides', async () => {
  build(config, 'production')
  assert.equal(await service.adultGate(ada), undefined)

  build(config, 'development')
  assert.equal(await service.adultGate(ada), false)
  await service.start(ada)
  assert.equal(await service.adultGate(ada), false)
  await deliver(delivery())
  assert.equal(await service.adultGate(ada), true)
  assert.equal(await service.adultGate(bayo), false)
})

test('the adult gate follows the flag allow-list: members off it keep the old rule', async () => {
  build(config, 'production')
  await service.start(ada)
  await deliver(delivery())
  await flags.set(ada, 'ageVerification', { enabled: null, handles: ['ada'] })
  assert.equal(await service.adultGate(ada), true)
  assert.equal(await service.adultGate(bayo), undefined)
})

test('a reversed approval is not brought back by a retried or resent Approved event', async () => {
  await service.start(ada)
  await deliver(delivery({ status: 'Approved' }))
  assert.equal((await rowOf(ada))?.status, 'verified')
  await deliver(delivery({ status: 'Declined' }))
  assert.equal((await rowOf(ada))?.status, 'declined')
  // The old Approved is delivered again, freshly signed. Didit's own record says declined.
  await deliver(delivery({ status: 'Approved' }), { status: 'Declined' })
  assert.equal((await rowOf(ada))?.status, 'declined')
  assert.equal((await rowOf(ada))?.verifiedAt, null)
})

test('the decision fetched from Didit decides, not the status in the body', async () => {
  await service.start(ada)
  await deliver(delivery({ status: 'Approved' }), { status: 'Declined' })
  assert.equal((await rowOf(ada))?.status, 'declined')
})

test('when the decision cannot be fetched the delivery fails (so Didit retries) and nothing changes', async () => {
  await service.start(ada)
  didit.failing = true
  const d = delivery({ status: 'Approved' })
  await assert.rejects(() => service.handleWebhook(d.body, d.headers), WebhookUpstreamError)
  assert.equal((await rowOf(ada))?.status, 'pending')
})

test('a decision about another member is not applied', async () => {
  await service.start(ada)
  await deliver(delivery({ status: 'Approved' }), { vendorData: bayo })
  assert.equal((await rowOf(ada))?.status, 'pending')
})

test('an approval whose decision flags a duplicated face or document is recorded as declined', async () => {
  await service.start(ada)
  await deliver(delivery({ status: 'Approved' }), { duplicate: true })
  assert.equal((await rowOf(ada))?.status, 'declined')
  assert.equal((await rowOf(ada))?.verifiedAt, null)
  assert.equal(await service.adultGate(ada), false)
})

test('polling applies the same duplicate rule', async () => {
  await service.start(ada)
  didit.decisions.set('sess-1', { sessionId: 'sess-1', status: 'Approved', vendorData: ada, method: 'document', duplicate: true })
  assert.equal((await service.refresh(ada)).status, 'declined')
})

test('a result stays on record when the flag is turned off', async () => {
  await service.start(ada)
  await deliver(delivery())
  build(config, 'production')
  assert.equal((await rowOf(ada))?.status, 'verified')
  assert.equal(await service.adultGate(ada), undefined)
})
