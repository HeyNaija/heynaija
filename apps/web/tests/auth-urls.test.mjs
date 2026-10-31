import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLogoutUrl, reauthUrl } from '../lib/auth/providers/kratos/urls.ts'

test('signing in again keeps the session and comes back to the page that asked', () => {
  const url = new URL(reauthUrl('http://127.0.0.1:3000/settings/delete?signed_in=1'), 'http://127.0.0.1:3000')
  assert.equal(url.pathname, '/kratos/self-service/login/browser')
  assert.equal(url.searchParams.get('refresh'), 'true')
  assert.equal(url.searchParams.get('return_to'), 'http://127.0.0.1:3000/settings/delete?signed_in=1')
})

test('/logout follows only Kratos’s own token-bearing logout URL', () => {
  assert.equal(isLogoutUrl('/kratos/self-service/logout?token=opaque'), true)
  for (const url of [
    '', '/', 'https://evil.test/kratos/self-service/logout?token=opaque',
    '//evil.test/kratos/self-service/logout?token=opaque',
    '/kratos/self-service/logout/browser?token=opaque',
    '/kratos/self-service/logout-other?token=opaque',
  ]) assert.equal(isLogoutUrl(url), false, url)
})
