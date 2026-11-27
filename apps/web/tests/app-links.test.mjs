import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ANDROID_PACKAGE, IOS_APP_ID, PAGES, PLAY_SIGNING_SHA256, appleAppSiteAssociation, assetLinks, certFingerprints, websiteOnly } from '../lib/app-links.ts'

const print = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89'

const here = dirname(fileURLToPath(import.meta.url))

/** Every page and route under app/, by its folder path without route groups, as PAGES names them. */
function sitePages() {
  const found = []
  const walk = (dir, parts) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Private folders (_components) and parallel slots (@modal) are not addresses.
        if (entry.name.startsWith('_') || entry.name.startsWith('@')) continue
        const group = /^\(.+\)$/.test(entry.name)
        walk(join(dir, entry.name), group ? parts : [...parts, entry.name])
      } else if (/^(page|route)\.(tsx?|jsx?|mdx)$/.test(entry.name)) {
        found.push(`/${parts.join('/')}`)
      }
    }
  }
  walk(join(here, '../app'), [])
  return [...new Set(found)].sort()
}

test('every page of the site says where it opens on a phone with the app', () => {
  const pages = sitePages()
  const listed = Object.keys(PAGES)
  const missing = pages.filter((page) => !listed.includes(page))
  assert.deepEqual(
    missing,
    [],
    `Add ${missing.join(', ')} to PAGES in apps/web/lib/app-links.ts as 'app', 'browser' or 'website' (docs/deployment/app-links.md). ` +
      'Then a link to it from WhatsApp or an email does what the app can do with it.',
  )
  const gone = listed.filter((page) => !pages.includes(page))
  assert.deepEqual(gone, [], `PAGES in apps/web/lib/app-links.ts lists pages that are no longer in app/: ${gone.join(', ')}`)
  for (const [page, opens] of Object.entries(PAGES)) assert.ok(['app', 'browser', 'website'].includes(opens), page)
})

/** A real address for a page's folder path. */
const example = (page) => page.replace(/\[[^\]]+\]/g, (param) => (param === '[number]' ? '42' : param === '[handle]' ? 'ada' : '0b5f0c1e-6d0f-4a43-9b8e-1b9a2b3c4d5e'))

/**
 * Apple's matching: the first pattern a path matches decides; `*` is any run, `?` any
 * one character. Read here as iOS was seen to behave (iPhone simulator, 20 November
 * 2026): a pattern ending in `/*` also matches the path without it. The old file's
 * `/u/*\/*` left out `/u/ada` that way, so profile links never opened the app.
 */
function opensInApp(path) {
  const { components } = appleAppSiteAssociation().applinks.details[0]
  for (const c of components) {
    const glob = c['/'].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '.')
    const source = glob.endsWith('/*') && glob !== '/*' ? `${glob.slice(0, -2).replace(/\*/g, '.*')}(/.*)?` : glob.replace(/\*/g, '.*')
    if (new RegExp(`^${source}$`).test(path)) return !c.exclude
  }
  return false
}

/** Android 15's dynamic rules, read the same way: the first that matches decides, and none means the browser. */
function opensInAndroidApp(path) {
  const [statement] = assetLinks()
  const rules = statement.relation_extensions['delegate_permission/common.handle_all_urls'].dynamic_app_link_components
  for (const rule of rules) {
    const pattern = new RegExp(`^${rule['/'].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
    if (pattern.test(path)) return !rule.exclude
  }
  return false
}

test('the iOS app is named once, and is given every page but the website-only ones', () => {
  const [details] = appleAppSiteAssociation().applinks.details
  assert.deepEqual(details.appIDs, [IOS_APP_ID])
  assert.equal(IOS_APP_ID, 'P6YA592CLG.ng.heynaija.app')
  // The pages left out come first: Apple goes by the first pattern a path matches.
  assert.deepEqual(details.components.at(-1), { '/': '/*', comment: 'Every other page: the app opens its screen, or hands it to the browser' })
  assert.ok(details.components.slice(0, -1).every((c) => c.exclude === true))
  assert.deepEqual(details.components.slice(0, -1).map((c) => c['/']), websiteOnly())
})

test('a page the app has a screen for, or might have one for, goes to the app; a website-only page never does', () => {
  for (const [page, opens] of Object.entries(PAGES)) {
    const path = example(page)
    assert.equal(opensInApp(path), opens !== 'website', `iOS: ${path}`)
    assert.equal(opensInAndroidApp(path), opens !== 'website', `Android 15: ${path}`)
  }
  for (const path of ['/', '/p/abc/anything', '/a-page-made-after-this-release', '/u/ada/followers']) {
    assert.equal(opensInApp(path), true, path)
    assert.equal(opensInAndroidApp(path), true, path)
  }
  // Sign-in steps, their callbacks, the API and pictures stay with the browser, whatever their query.
  for (const path of [
    '/login',
    '/kratos/self-service/methods/oidc/callback/google',
    '/api/v1/me',
    '/media/images/a.webp',
    '/_next/static/chunk.js',
    '/games/keno/rounds/42',
    '/games/chess/callback',
    '/lichess/return',
    '/settings/export',
    '/.well-known/assetlinks.json',
  ]) {
    assert.equal(opensInApp(path), false, path)
    assert.equal(opensInAndroidApp(path), false, path)
  }
})

test('fingerprints are read with or without colons, in any case, and anything else is reported', () => {
  const bare = print.replace(/:/g, '').toLowerCase()
  assert.deepEqual(certFingerprints(`${print}, ${bare}`), { valid: [print], invalid: [] })
  assert.deepEqual(certFingerprints(` ${print}\n12:34 `), { valid: [print], invalid: ['12:34'] })
  assert.deepEqual(certFingerprints(undefined), { valid: [], invalid: [] })
  assert.deepEqual(certFingerprints(''), { valid: [], invalid: [] })
})

test("Android is told about the app signed with Play's key, and any more given, and which pages stay in the browser", () => {
  const rules = [...websiteOnly().map((path) => ({ '/': path, exclude: true })), { '/': '*' }]
  const statement = (prints) => [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      relation_extensions: { 'delegate_permission/common.handle_all_urls': { dynamic_app_link_components: rules } },
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: prints },
    },
  ]
  // Play Console's own snippet for the app (Test and release → App integrity).
  assert.equal(PLAY_SIGNING_SHA256, '1C:55:B3:F9:4A:D6:55:54:A5:9F:F5:47:A3:0F:98:09:52:94:EA:8C:57:EB:C1:31:13:98:DA:1A:6B:35:3C:51')
  assert.deepEqual(assetLinks(), statement([PLAY_SIGNING_SHA256]))
  assert.deepEqual(assetLinks([print]), statement([PLAY_SIGNING_SHA256, print]))
  // Play's again in the setting is not listed twice.
  assert.deepEqual(assetLinks(certFingerprints(PLAY_SIGNING_SHA256.toLowerCase()).valid), statement([PLAY_SIGNING_SHA256]))
  // Android drops every rule when one has an empty or unknown field: only paths, no comments.
  for (const rule of rules) {
    assert.ok(typeof rule['/'] === 'string' && rule['/'].length > 0)
    assert.deepEqual(Object.keys(rule).filter((key) => key !== '/' && key !== 'exclude'), [])
  }
})
