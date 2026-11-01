import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageVerifications, members } from '@heynaija/db'
import { Logger } from '@nestjs/common'
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
const config: DiditConfig = {
  apiKey: 'k',
  workflowId: 'wf',
  webhookSecret: SECRET,
  personKeySecret: 'p'.repeat(32),
  callbackUrl: 'https://heynaija.test/settings/age-verification',
}
/** A number the tests look for in rows, logs and errors, and must never find. */
const RAW_NUMBER = 'SECRET-DOC-777'

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
  didit.decisions.set(body.session_id, {
    sessionId: body.session_id,
    status: body.status,
    vendorData: body.vendor_data,
    method: 'document',
    duplicate: false,
    // Each member has a document of their own unless a test says otherwise.
    document: { issuingState: 'NGA', number: `DOC-${body.vendor_data}` },
    ...truth,
  })
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
  assert.deepEqual(Object.keys(row ?? {}).sort(), ['createdAt', 'diditSessionId', 'memberId', 'method', 'outcome', 'personKey', 'status', 'updatedAt', 'verifiedAt'])
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
  didit.decisions.set('sess-1', { sessionId: 'sess-1', status: 'Approved', vendorData: ada, method: 'age_estimation', duplicate: false, document: null })
  assert.deepEqual(await service.refresh(ada), { available: true, status: 'verified', verified: true })
  assert.equal((await rowOf(ada))?.method, 'age_estimation')
})

test('polling ignores a decision that is not about this member, and survives Didit being down', async () => {
  await service.start(ada)
  didit.decisions.set('sess-1', { sessionId: 'sess-1', status: 'Approved', vendorData: bayo, method: 'document', duplicate: false, document: null })
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
  didit.decisions.set('sess-1', { sessionId: 'sess-1', status: 'Approved', vendorData: ada, method: 'document', duplicate: true, document: null })
  assert.equal((await service.refresh(ada)).status, 'declined')
})

/** Both members have a started session; ada's is sess-1 and bayo's sess-2. */
const startBoth = async () => {
  await service.start(ada)
  await service.start(bayo)
}
const sameDocument = { issuingState: 'NGA', number: RAW_NUMBER }
const approve = (session: string, member: string, truth: Partial<DiditDecision> = {}) =>
  deliver(delivery({ session_id: session, vendor_data: member, status: 'Approved' }), truth)

test('the same document verifying a second account ends that account declined, without saying whose document it was', async () => {
  await startBoth()
  await approve('sess-1', ada, { document: sameDocument })
  await approve('sess-2', bayo, { document: sameDocument })
  assert.equal((await rowOf(ada))?.status, 'verified')
  const second = await rowOf(bayo)
  assert.equal(second?.status, 'declined')
  assert.equal(second?.outcome, 'duplicate_person')
  assert.equal(second?.verifiedAt, null)
  assert.equal(second?.personKey, null)
  assert.equal(await service.adultGate(bayo), false)
  // What the member is told: a status and nothing about a person or another member.
  const told = JSON.stringify(await service.status(bayo))
  assert.equal(told, JSON.stringify({ available: true, status: 'declined', verified: false }))
})

test('the same rule applies when the second account is found by polling', async () => {
  await startBoth()
  await approve('sess-1', ada, { document: sameDocument })
  didit.decisions.set('sess-2', { sessionId: 'sess-2', status: 'Approved', vendorData: bayo, method: 'document', duplicate: false, document: sameDocument })
  assert.equal((await service.refresh(bayo)).status, 'declined')
  assert.equal((await rowOf(bayo))?.outcome, 'duplicate_person')
})

test('different documents both verify', async () => {
  await startBoth()
  await approve('sess-1', ada, { document: { issuingState: 'NGA', number: 'A111' } })
  await approve('sess-2', bayo, { document: { issuingState: 'NGA', number: 'A222' } })
  assert.equal((await rowOf(ada))?.status, 'verified')
  assert.equal((await rowOf(bayo))?.status, 'verified')
})

test('the same number in another country is another document', async () => {
  await startBoth()
  await approve('sess-1', ada, { document: { issuingState: 'NGA', number: 'A111' } })
  await approve('sess-2', bayo, { document: { issuingState: 'GHA', number: 'A111' } })
  assert.equal((await rowOf(bayo))?.status, 'verified')
})

test('case and spacing of a number do not make it another document', async () => {
  await startBoth()
  await approve('sess-1', ada, { document: { issuingState: 'NGA', number: 'ab 12-34' } })
  await approve('sess-2', bayo, { document: { issuingState: 'nga', number: 'AB1234' } })
  assert.equal((await rowOf(ada))?.status, 'verified')
  assert.equal((await rowOf(bayo))?.status, 'declined')
})

test('two members verifying one document at the same moment: one wins, the other declines, nobody gets an error', async () => {
  await startBoth()
  const results = await Promise.allSettled([approve('sess-1', ada, { document: sameDocument }), approve('sess-2', bayo, { document: sameDocument })])
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled'])
  const statuses = [(await rowOf(ada))?.status, (await rowOf(bayo))?.status].sort()
  assert.deepEqual(statuses, ['declined', 'verified'])
  const keys = (await db.select().from(ageVerifications)).filter((r) => r.personKey !== null)
  assert.equal(keys.length, 1)
})

test('a declined account frees nothing it never held, and the winner keeps the key', async () => {
  await startBoth()
  await approve('sess-1', ada, { document: sameDocument })
  await approve('sess-2', bayo, { document: sameDocument })
  // Ada's approval is later reversed in Didit's console: the key is free again for a fresh attempt.
  await deliver(delivery({ session_id: 'sess-1', vendor_data: ada, status: 'Declined' }), { document: sameDocument })
  assert.equal((await rowOf(ada))?.personKey, null)
  await service.start(bayo)
  await approve('sess-3', bayo, { document: sameDocument })
  assert.equal((await rowOf(bayo))?.status, 'verified')
})

test('an age-estimation approval has no document, so no key is stored and no duplicate check is made', async () => {
  await startBoth()
  await approve('sess-1', ada, { method: 'age_estimation', document: null })
  await approve('sess-2', bayo, { method: 'age_estimation', document: null })
  assert.equal((await rowOf(ada))?.status, 'verified')
  assert.equal((await rowOf(bayo))?.status, 'verified')
  assert.equal((await rowOf(ada))?.personKey, null)
})

test('a document approval with no readable number is not counted: nothing to tell one person from another', async () => {
  await service.start(ada)
  await approve('sess-1', ada, { document: null })
  const row = await rowOf(ada)
  assert.equal(row?.status, 'declined')
  assert.equal(row?.outcome, 'no_document_number')
})

test('a resent Approved with no readable document leaves an already verified member verified, key kept', async () => {
  await service.start(ada)
  await approve('sess-1', ada, { document: sameDocument })
  const before = await rowOf(ada)
  assert.equal(before?.status, 'verified')
  assert.ok(before?.personKey)
  await approve('sess-1', ada, { document: null })
  const after = await rowOf(ada)
  assert.equal(after?.status, 'verified')
  assert.equal(after?.personKey, before?.personKey)
  assert.equal(after?.outcome, null)
  assert.equal(await service.adultGate(ada), true)
})

test('a keyless Approved that read the row as pending cannot demote it when it became verified in between', async () => {
  await service.start(ada)
  const stale = await rowOf(ada) // pending
  assert.equal(stale?.status, 'pending')
  await approve('sess-1', ada, { document: sameDocument })
  const verified = await rowOf(ada)
  assert.equal(verified?.status, 'verified')
  // The second read the keyless delivery makes (the first is the webhook's own session check) returns what it would have seen before the other
  // delivery verified the row; every later read is the real one. (A stubbed read, not a real
  // interleaving, so that the order is the same every run.)
  const internals = service as unknown as { load: (id: string) => Promise<unknown> }
  const real = internals.load.bind(service)
  let reads = 0
  internals.load = async (id) => (reads++ === 1 ? stale : real(id))
  await approve('sess-1', ada, { document: null })
  internals.load = real
  const after = await rowOf(ada)
  assert.equal(after?.status, 'verified')
  assert.equal(after?.personKey, verified?.personKey)
  assert.equal(after?.outcome, null)
  assert.equal(await service.adultGate(ada), true)
})

test('a reviewer-approved session whose ID item is not approved, still open in review, is declined as having no document number', async () => {
  await service.start(ada)
  await deliver(delivery({ status: 'In Review' }))
  assert.equal((await rowOf(ada))?.status, 'in_review')
  await approve('sess-1', ada, { document: null })
  assert.equal((await rowOf(ada))?.status, 'declined')
  assert.equal((await rowOf(ada))?.outcome, 'no_document_number')
})

test('a duplicate-flagged approval records why, and stores no key', async () => {
  await service.start(ada)
  await approve('sess-1', ada, { duplicate: true })
  assert.equal((await rowOf(ada))?.outcome, 'duplicate_flagged')
  assert.equal((await rowOf(ada))?.personKey, null)
})

test('the raw document number is in no row, no log line and no error', async () => {
  const lines: string[] = []
  const capture = { log: (m: unknown) => lines.push(String(m)), error: (m: unknown) => lines.push(String(m)), warn: (m: unknown) => lines.push(String(m)), debug: (m: unknown) => lines.push(String(m)), verbose: (m: unknown) => lines.push(String(m)) }
  Logger.overrideLogger(capture)
  try {
    await startBoth()
    await approve('sess-1', ada, { document: sameDocument })
    await approve('sess-2', bayo, { document: sameDocument }) // the duplicate path
    didit.failing = true
    const failing = delivery({ session_id: 'sess-2', vendor_data: bayo, status: 'Approved' })
    await service.handleWebhook(failing.body, failing.headers).catch((err: unknown) => lines.push(String(err), (err as Error).stack ?? ''))
    didit.failing = false
    await service.refresh(bayo)
  } finally {
    Logger.overrideLogger(['error', 'warn', 'log'])
  }
  const rows = JSON.stringify(await db.select().from(ageVerifications))
  for (const text of [rows, lines.join('\n')]) {
    assert.doesNotMatch(text, /SECRET-DOC-777/i)
    assert.doesNotMatch(text, /SECRETDOC777/i)
  }
})

test('a result stays on record when the flag is turned off', async () => {
  await service.start(ada)
  await deliver(delivery())
  build(config, 'production')
  assert.equal((await rowOf(ada))?.status, 'verified')
  assert.equal(await service.adultGate(ada), undefined)
})
