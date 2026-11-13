import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { memberOfUnsubscribeToken, unsubscribeKey, unsubscribeToken } from './unsubscribe-token.js'

const key = unsubscribeKey('a'.repeat(32))

test('a token leads back to the member it was made for', () => {
  const id = randomUUID()
  const token = unsubscribeToken(key, id)
  assert.equal(memberOfUnsubscribeToken(key, token), id)
  // Safe to put in an address as it is.
  assert.match(token, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/)
  // Always the same for the same member, so the link in an old email keeps working.
  assert.equal(unsubscribeToken(key, id), token)
})

test('a token for one member is not a token for another', () => {
  const [ada, bayo] = [randomUUID(), randomUUID()]
  const [, adaSignature] = unsubscribeToken(key, ada).split('.')
  assert.equal(memberOfUnsubscribeToken(key, `${bayo}.${adaSignature}`), null)
})

test('anything that is not exactly one of ours is refused', () => {
  const id = randomUUID()
  const [, signature] = unsubscribeToken(key, id).split('.')
  const flipped = `${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`
  for (const bad of [
    '',
    '.',
    id,
    `${id}.`,
    `.${signature}`,
    `${id}.${flipped}`,
    `${id}.${signature}.${signature}`,
    `${id}.${signature}x`,
    `${id.toUpperCase()}.${signature}`,
    `not-a-uuid.${signature}`,
    `${id} .${signature}`,
  ]) {
    assert.equal(memberOfUnsubscribeToken(key, bad), null, JSON.stringify(bad))
  }
})

test('a different secret makes different tokens, and cannot read the first one’s', () => {
  const id = randomUUID()
  const other = unsubscribeKey('b'.repeat(32))
  assert.notEqual(unsubscribeToken(other, id), unsubscribeToken(key, id))
  assert.equal(memberOfUnsubscribeToken(other, unsubscribeToken(key, id)), null)
})

test('the signing key is not the secret it is derived from', () => {
  assert.notEqual(key.toString(), 'a'.repeat(32))
  assert.equal(key.length, 32)
})

test('a link that turns off weekly highlights is not a link that turns off email, and the other way round', () => {
  const id = randomUUID()
  const email = unsubscribeToken(key, id)
  const highlights = unsubscribeToken(key, id, 'highlights')
  assert.notEqual(email, highlights)
  assert.equal(memberOfUnsubscribeToken(key, highlights, 'highlights'), id)
  assert.equal(memberOfUnsubscribeToken(key, highlights), null)
  assert.equal(memberOfUnsubscribeToken(key, email, 'highlights'), null)
  // The first kind keeps the signature it has always had, so links in old emails still work.
  assert.equal(unsubscribeToken(key, id, 'unsubscribe'), email)
})
