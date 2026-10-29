import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Kratos sends these; the API never renders them, so this checks the files themselves.
const dir = new URL('../../../../infra/kratos/courier-templates/', import.meta.url)
const read = (kind: string, file: string) => readFileSync(new URL(`${kind}/valid/${file}`, dir), 'utf8')

for (const kind of ['login_code', 'registration_code']) {
  test(`${kind}: the code stays out of the subject and preview, and the wording says sign in`, () => {
    assert.ok(!/\{\{/.test(read(kind, 'email.subject.gotmpl')), 'no code in the subject, which shows on lock screens')
    const html = read(kind, 'email.body.gotmpl')
    const preheader = /mso-hide:all">(.*?)<\/div>/.exec(html)?.[1]
    assert.ok(preheader, 'a hidden preheader with mso-hide')
    assert.ok(!/\.(Login|Registration)Code/.test(preheader), 'no code in the preview')
    assert.ok(!html.includes('<!--'), 'html/template strips comments, so none belong here')
    for (const file of ['email.subject.gotmpl', 'email.body.gotmpl', 'email.body.plaintext.gotmpl']) {
      assert.ok(!/log in/i.test(read(kind, file)), `${file} says sign in, never log in`)
    }
  })
}

test('login_code says sign in in its subject, title and plaintext', () => {
  assert.match(read('login_code', 'email.subject.gotmpl'), /sign-in/)
  assert.match(read('login_code', 'email.body.gotmpl'), /<title>Sign in to HeyNaija/)
  assert.match(read('login_code', 'email.body.plaintext.gotmpl'), /sign in/)
})
