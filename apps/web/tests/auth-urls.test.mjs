import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLogoutUrl } from '../lib/auth/providers/kratos/urls.ts'

test('logout accepts only the existing local provider endpoint', () => {
  assert.equal(isLogoutUrl('/api/v1/auth/logout?token=opaque'), true)
  for (const url of [
    '', '/', 'https://evil.test/api/v1/auth/logout?token=opaque',
    '//evil.test/api/v1/auth/logout?token=opaque',
    '/api/v1/auth/logout/browser?token=opaque',
    '/api/v1/auth/logout-other?token=opaque',
  ]) assert.equal(isLogoutUrl(url), false, url)
})
