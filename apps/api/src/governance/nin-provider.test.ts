import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DisabledNinProvider, VerificationUnavailableError } from './nin-provider.js'
import { TestNinProvider } from './test-nin-provider.js'

test('the disabled provider never starts or completes a verification', async () => {
  const provider = new DisabledNinProvider()
  assert.throws(
    () => provider.authorizationUrl({ state: 's', codeChallenge: 'c', redirectUri: 'https://heynaija.ng/cb' }),
    VerificationUnavailableError,
  )
  await assert.rejects(provider.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://heynaija.ng/cb' }), VerificationUnavailableError)
})

test('the test provider cannot be created outside a test run or under NODE_ENV=production', (t) => {
  const context = process.env.NODE_TEST_CONTEXT
  const nodeEnv = process.env.NODE_ENV
  t.after(() => {
    process.env.NODE_TEST_CONTEXT = context
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
  })

  assert.ok(new TestNinProvider({}))
  process.env.NODE_ENV = 'production'
  assert.throws(() => new TestNinProvider({}), /only for automated tests/)
  delete process.env.NODE_ENV
  delete process.env.NODE_TEST_CONTEXT
  assert.throws(() => new TestNinProvider({}), /only for automated tests/)
})

test('the test provider sends PKCE and state, and honours each code once', async () => {
  const provider = new TestNinProvider({
    good: { subject: 'person-1', over18: true, verifiedAt: new Date(), expiresAt: null },
  })
  const url = provider.authorizationUrl({ state: 'st', codeChallenge: 'ch', redirectUri: 'https://heynaija.ng/cb' })
  assert.equal(url.searchParams.get('state'), 'st')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')

  const result = await provider.exchange({ code: 'good', codeVerifier: 'v', redirectUri: 'https://heynaija.ng/cb' })
  assert.equal(result.provider, 'test-ninauth')
  await assert.rejects(provider.exchange({ code: 'good', codeVerifier: 'v', redirectUri: 'https://heynaija.ng/cb' }), VerificationUnavailableError)
  await assert.rejects(provider.exchange({ code: 'unknown', codeVerifier: 'v', redirectUri: 'https://heynaija.ng/cb' }), VerificationUnavailableError)
})
