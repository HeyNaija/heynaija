import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLogoutUrl } from '../lib/auth/providers/kratos/urls.ts'

test('/logout follows only Kratos’s own token-bearing logout URL', () => {
  assert.equal(isLogoutUrl('/kratos/self-service/logout?token=opaque'), true)
  for (const url of [
    '', '/', 'https://evil.test/kratos/self-service/logout?token=opaque',
    '//evil.test/kratos/self-service/logout?token=opaque',
    '/kratos/self-service/logout/browser?token=opaque',
    '/kratos/self-service/logout-other?token=opaque',
  ]) assert.equal(isLogoutUrl(url), false, url)
})
