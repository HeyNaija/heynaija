import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DiditConfig } from './config.js'
import { HttpDiditClient } from './didit-client.js'

const config: DiditConfig = { apiKey: 'key-123', workflowId: 'wf-9', webhookSecret: 's', callbackUrl: 'https://heynaija.test/settings/age-verification' }

type Call = { url: string; init: RequestInit }
const fakeFetch = (reply: { status?: number; body: unknown }) => {
  const calls: Call[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, impl }
}

test('a session is created as the docs describe: POST /v3/session/ with x-api-key, workflow_id, vendor_data and callback', async () => {
  const { calls, impl } = fakeFetch({
    status: 201,
    body: { session_id: 'sess-1', url: 'https://verify.didit.me/session/abc', status: 'Not Started', session_token: 'secret-token' },
  })
  const made = await new HttpDiditClient(config, impl).createSession({ memberId: 'm-1', callbackUrl: config.callbackUrl })
  assert.deepEqual(made, { sessionId: 'sess-1', url: 'https://verify.didit.me/session/abc' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://verification.didit.me/v3/session/')
  assert.equal(calls[0]?.init.method, 'POST')
  const headers = calls[0]?.init.headers as Record<string, string>
  assert.equal(headers['x-api-key'], 'key-123')
  assert.equal(headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    workflow_id: 'wf-9',
    vendor_data: 'm-1',
    callback: 'https://heynaija.test/settings/age-verification',
  })
})

test('a reply without a session id or a hosted https url is refused', async () => {
  for (const body of [{}, { session_id: 'x' }, { session_id: 'x', url: 'javascript:alert(1)' }, { session_id: 'x', url: 'http://verify.didit.me/s' }, { url: 'https://verify.didit.me/s' }]) {
    const { impl } = fakeFetch({ status: 201, body })
    await assert.rejects(() => new HttpDiditClient(config, impl).createSession({ memberId: 'm', callbackUrl: 'x' }), /Didit/)
  }
})

test('an error status from Didit is an error, and its body is not echoed', async () => {
  const { impl } = fakeFetch({ status: 403, body: { detail: 'Invalid API key sk-live-leak' } })
  await assert.rejects(
    () => new HttpDiditClient(config, impl).createSession({ memberId: 'm', callbackUrl: 'x' }),
    (err: Error) => /403/.test(err.message) && !/sk-live-leak/.test(err.message),
  )
})

test('a decision is read from GET /v3/session/{id}/decision/ and cut down to status, member and method', async () => {
  const { calls, impl } = fakeFetch({
    body: {
      session_id: 'sess-1',
      status: 'Approved',
      vendor_data: 'm-1',
      features: ['ID_VERIFICATION'],
      id_verifications: [{ status: 'Approved', full_name: 'Ada Obi', date_of_birth: '1990-01-01', front_image: 'https://x/y.jpg' }],
    },
  })
  const decision = await new HttpDiditClient(config, impl).getDecision('sess-1')
  assert.deepEqual(decision, { sessionId: 'sess-1', status: 'Approved', vendorData: 'm-1', method: 'document' })
  assert.equal(calls[0]?.url, 'https://verification.didit.me/v3/session/sess-1/decision/')
  assert.equal(calls[0]?.init.method ?? 'GET', 'GET')
  assert.equal((calls[0]?.init.headers as Record<string, string>)['x-api-key'], 'key-123')
})

test('the session id is encoded into the path, and a decision with no status is refused', async () => {
  const { calls, impl } = fakeFetch({ body: { session_id: 'a/b' } })
  await assert.rejects(() => new HttpDiditClient(config, impl).getDecision('a/../b'), /Didit/)
  assert.equal(calls[0]?.url, 'https://verification.didit.me/v3/session/a%2F..%2Fb/decision/')
})
