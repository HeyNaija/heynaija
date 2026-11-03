import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NOTIFICATION_SETTINGS, preferencesFromForm, settingsFor } from '../lib/notification-preferences.ts'

const form = (...on) => {
  const data = new FormData()
  for (const kind of on) data.append('on', kind)
  return data
}

test('the Settings form saves every kind: ticked boxes on, the rest off', () => {
  assert.deepEqual(preferencesFromForm(form('reply', 'mention')), {
    email: false,
    reply: true,
    mention: true,
    like: false,
    repost: false,
    quote: false,
    follow: false,
    chess_challenge: false,
  })
  // No boxes ticked turns everything off, rather than changing nothing.
  assert.ok(Object.values(preferencesFromForm(form())).every((on) => on === false))
})

test('the email box is saved on its own: ticking it does not turn any kind on', () => {
  const data = form('like')
  data.append('email', 'on')
  const sent = preferencesFromForm(data)
  assert.equal(sent.email, true)
  assert.equal(sent.like, true)
  assert.equal(sent.reply, false)
  assert.equal(preferencesFromForm(form('like')).email, false)
})

test('a kind that cannot be turned off is never sent, even if a form names it', () => {
  const sent = preferencesFromForm(form('like', 'post_removed', 'report_resolved'))
  assert.deepEqual(Object.keys(sent).sort(), ['email', ...NOTIFICATION_SETTINGS.map(({ kind }) => kind)].sort())
  assert.equal(sent.like, true)
})

test('only other members’ activity is offered, each with a plain label', () => {
  assert.deepEqual(NOTIFICATION_SETTINGS.map(({ kind }) => kind).sort(), ['chess_challenge', 'follow', 'like', 'mention', 'quote', 'reply', 'repost'])
  for (const { label } of NOTIFICATION_SETTINGS) assert.match(label, /^Someone .+ (you|your post|you to chess)$/)
})

test('the chess box shows only to members with Games; for others it keeps its setting through a hidden field', () => {
  assert.ok(settingsFor({ games: true }).shown.some(({ kind }) => kind === 'chess_challenge'))
  assert.deepEqual(settingsFor({ games: true }).hidden, [])
  const without = settingsFor({})
  assert.ok(!without.shown.some(({ kind }) => kind === 'chess_challenge'))
  assert.deepEqual(without.hidden, ['chess_challenge'])
})
