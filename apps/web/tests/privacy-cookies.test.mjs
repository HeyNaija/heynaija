import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const lib = new URL('../lib/', import.meta.url)
const privacy = readFileSync(new URL('../app/(main)/privacy/page.tsx', import.meta.url), 'utf8')

test('the privacy page lists every cookie the site sets', () => {
  const names = new Set()
  for (const file of readdirSync(lib, { recursive: true })) {
    if (!String(file).endsWith('.ts')) continue
    for (const [, name] of readFileSync(new URL(String(file), lib), 'utf8').matchAll(/['"`](hn_[a-z_]+)['"`]/g)) names.add(name)
  }
  assert.ok(names.has('hn_session'), 'found the cookie names')
  const missing = [...names].filter((name) => !privacy.includes(`<code>${name}</code>`))
  assert.deepEqual(missing, [])
})
