import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, mock, test } from 'node:test'
import { AuthProviderError } from './auth-session.provider.js'
import { KratosAdmin } from './kratos-admin.js'

// Kratos's admin API is stubbed with fetch. What the stubs answer is what the
// patched Kratos on the dev stack answered when tried on 29 October 2026.
const ADMIN = 'http://kratos-admin.test'
const admin = new KratosAdmin({ KRATOS_ADMIN_URL: ADMIN })
const memberId = randomUUID()

afterEach(() => mock.restoreAll())

const answer = (response: () => Response) =>
  mock.method(globalThis, 'fetch', async (_url: string, _init: RequestInit) => response())
const isProviderError = (kind: 'unavailable' | 'protocol') => (error: unknown) =>
  error instanceof AuthProviderError && error.kind === kind

const deletions = [
  ['revokeAllSessions', `${ADMIN}/admin/identities/${memberId}/sessions`],
  ['deleteIdentity', `${ADMIN}/admin/identities/${memberId}`],
] as const

test('ending sessions and deleting the identity each send one DELETE to the admin API', async () => {
  for (const [operation, url] of deletions) {
    const fetch = answer(() => new Response(null, { status: 204 }))
    assert.equal(await admin[operation](memberId), undefined)
    assert.equal(fetch.mock.callCount(), 1)
    const [calledUrl, init] = fetch.mock.calls[0]!.arguments
    assert.equal(calledUrl, url)
    assert.equal(init?.method, 'DELETE')
    mock.restoreAll()
  }
})

test('both are safe to repeat: a 404 means there is nothing left to end or delete', async () => {
  // Kratos answers 404 for an identity with no sessions left as well as for one that is gone.
  for (const [operation] of deletions) {
    answer(() => Response.json({ error: { code: 404 } }, { status: 404 }))
    assert.equal(await admin[operation](memberId), undefined, operation)
    mock.restoreAll()
  }
})

test('a Kratos that is down, refuses or cannot be reached is an error to retry, never done', async () => {
  for (const [operation] of deletions) {
    for (const response of [
      () => new Response(null, { status: 500 }),
      () => new Response(null, { status: 503 }),
      () => new Response(null, { status: 401 }),
      () => { throw new TypeError('fetch failed') },
    ]) {
      answer(response)
      await assert.rejects(admin[operation](memberId), isProviderError('unavailable'), operation)
      mock.restoreAll()
    }
  }
})

test('the member ID is escaped into the path', async () => {
  const fetch = answer(() => new Response(null, { status: 204 }))
  await admin.deleteIdentity('a/../b?c')
  assert.equal(fetch.mock.calls[0]!.arguments[0], `${ADMIN}/admin/identities/a%2F..%2Fb%3Fc`)
})

const identity = (email: string | undefined, id = randomUUID()) => ({ id, traits: { handle: 'ada', ...(email ? { email } : {}) } })

test('an account is found by its email, in any case, with the address trimmed and escaped', async () => {
  const id = randomUUID()
  const fetch = answer(() => Response.json([identity('Ada+news@Example.test', id)]))
  assert.equal(await admin.identityIdByEmail('  ADA+news@example.TEST '), id)
  const [url, init] = fetch.mock.calls[0]!.arguments
  assert.equal(url, `${ADMIN}/admin/identities?credentials_identifier=ada%2Bnews%40example.test`)
  assert.equal(init?.method, 'GET')
})

test('nobody with that email is null, including an account Kratos matched by its handle instead', async () => {
  for (const found of [[], [identity('someone-else@example.test')], [identity(undefined)]]) {
    answer(() => Response.json(found))
    assert.equal(await admin.identityIdByEmail('ada@example.test'), null)
    mock.restoreAll()
  }
})

test('an answer that cannot be right is a protocol error, not a guess', async () => {
  for (const response of [
    // Sign-in identifiers are unique, so two accounts with one email is not believable.
    () => Response.json([identity('ada@example.test'), identity('ada@example.test')]),
    () => Response.json({ identities: [] }),
    () => Response.json([{ id: 'not-a-uuid', traits: { email: 'ada@example.test' } }]),
    () => new Response('not json'),
  ]) {
    answer(response)
    await assert.rejects(admin.identityIdByEmail('ada@example.test'), isProviderError('protocol'))
    mock.restoreAll()
  }
})

test('looking up an email while Kratos is down is unavailable', async () => {
  for (const response of [() => new Response(null, { status: 500 }), () => { throw new TypeError('fetch failed') }]) {
    answer(response)
    await assert.rejects(admin.identityIdByEmail('ada@example.test'), isProviderError('unavailable'))
    mock.restoreAll()
  }
})
