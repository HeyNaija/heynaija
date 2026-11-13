import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANDROID_PACKAGE, IOS_APP_ID, PLAY_SIGNING_SHA256, appleAppSiteAssociation, assetLinks, certFingerprints } from '../lib/app-links.ts'

const print = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89'

test('the iOS app is named once, with the pages the apps have a screen for', () => {
  const [details] = appleAppSiteAssociation().applinks.details
  assert.deepEqual(details.appIDs, [IOS_APP_ID])
  assert.equal(IOS_APP_ID, 'P6YA592CLG.ng.heynaija.app')
  const included = details.components.filter((c) => !c.exclude).map((c) => c['/'])
  assert.deepEqual(included, [
    '/p/????????-????-????-????-????????????',
    '/gists/????????-????-????-????-????????????',
    '/u/*',
    '/c/*',
    '/hashtag/*',
    '/notifications',
    '/bookmarks',
  ])
})

/** Apple's matching: the first pattern a path matches decides; `*` is any run, `?` any one character. */
function opensInApp(path) {
  const { components } = appleAppSiteAssociation().applinks.details[0]
  for (const c of components) {
    const pattern = new RegExp(`^${c['/'].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
    if (pattern.test(path)) return !c.exclude
  }
  return false
}

test('a post, Gist, profile, community or hashtag opens in the app, and the pages under them do not', () => {
  const id = '0b5f0c1e-6d0f-4a43-9b8e-1b9a2b3c4d5e'
  for (const path of [`/p/${id}`, `/gists/${id}`, '/u/ada', '/c/lagos-tech', '/hashtag/jollof', '/notifications', '/bookmarks']) {
    assert.equal(opensInApp(path), true, path)
  }
  for (const path of ['/', '/rules', '/settings', '/signup', `/p/${id}/quote`, `/p/${id}/votes`, '/gists/new', '/u/ada/followers', '/c', '/p/abc']) {
    assert.equal(opensInApp(path), false, path)
  }
})

test('fingerprints are read with or without colons, in any case, and anything else is reported', () => {
  const bare = print.replace(/:/g, '').toLowerCase()
  assert.deepEqual(certFingerprints(`${print}, ${bare}`), { valid: [print], invalid: [] })
  assert.deepEqual(certFingerprints(` ${print}\n12:34 `), { valid: [print], invalid: ['12:34'] })
  assert.deepEqual(certFingerprints(undefined), { valid: [], invalid: [] })
  assert.deepEqual(certFingerprints(''), { valid: [], invalid: [] })
})

test("Android is told about the app signed with Play's key, and any more given", () => {
  const statement = (prints) => [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: prints },
    },
  ]
  // Play Console's own snippet for the app (Test and release → App integrity).
  assert.equal(PLAY_SIGNING_SHA256, '1C:55:B3:F9:4A:D6:55:54:A5:9F:F5:47:A3:0F:98:09:52:94:EA:8C:57:EB:C1:31:13:98:DA:1A:6B:35:3C:51')
  assert.deepEqual(assetLinks(), statement([PLAY_SIGNING_SHA256]))
  assert.deepEqual(assetLinks([print]), statement([PLAY_SIGNING_SHA256, print]))
  // Play's again in the setting is not listed twice.
  assert.deepEqual(assetLinks(certFingerprints(PLAY_SIGNING_SHA256.toLowerCase()).valid), statement([PLAY_SIGNING_SHA256]))
})
