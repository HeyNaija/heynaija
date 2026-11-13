import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NOTIFICATION_SETTINGS, OPTIONAL_KINDS, preferencesFromForm, settingsFor } from '../lib/notification-preferences.ts'

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
    story_update: false,
    chess_challenge: false,
    chess_game_started: false,
    community_announcement: false,
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

test('weekly highlights are saved only by a form that offered the box', () => {
  // No box on the form: the choice is left as it is, not turned off.
  assert.ok(!('highlights' in preferencesFromForm(form('like'))))
  const stray = form('like')
  stray.append('highlights', 'on')
  assert.ok(!('highlights' in preferencesFromForm(stray)))

  const unticked = form('like')
  unticked.append('highlights-offered', '1')
  assert.equal(preferencesFromForm(unticked).highlights, false)
  const ticked = form('like')
  ticked.append('highlights-offered', '1')
  ticked.append('highlights', 'on')
  assert.equal(preferencesFromForm(ticked).highlights, true)
  // On its own: it does not touch email or any kind.
  assert.equal(preferencesFromForm(ticked).email, false)
  assert.equal(preferencesFromForm(ticked).reply, false)
})

test('a kind that cannot be turned off is never sent, even if a form names it', () => {
  const sent = preferencesFromForm(form('like', 'post_removed', 'report_resolved'))
  assert.deepEqual(Object.keys(sent).sort(), ['email', ...OPTIONAL_KINDS].sort())
  assert.equal(sent.like, true)
})

test('only other members’ activity is offered, each with a plain label', () => {
  assert.deepEqual(NOTIFICATION_SETTINGS.map(({ kind }) => kind).sort(), ['chess_challenge', 'community_announcement', 'follow', 'like', 'mention', 'quote', 'reply', 'repost', 'story_update'])
  for (const { label } of NOTIFICATION_SETTINGS) assert.match(label, /^Someone .+ (you|your post|a story you follow|a community you joined|your game starts)$/)
})

test('the chess box shows only to members with Games; for others it keeps its setting through a hidden field', () => {
  const all = { games: true, communityAnnouncements: true }
  assert.ok(settingsFor(all).shown.some(({ kind }) => kind === 'chess_challenge'))
  assert.deepEqual(settingsFor(all).hidden, [])
  const without = settingsFor({ communityAnnouncements: true })
  assert.ok(!without.shown.some(({ kind }) => kind === 'chess_challenge'))
  assert.deepEqual(without.hidden, ['chess_challenge', 'chess_game_started'])
})

test('the announcements box shows only while community announcements are switched on, and keeps its setting otherwise', () => {
  assert.ok(settingsFor({ communityAnnouncements: true }).shown.some(({ kind }) => kind === 'community_announcement'))
  const without = settingsFor({ games: true })
  assert.ok(!without.shown.some(({ kind }) => kind === 'community_announcement'))
  assert.deepEqual(without.hidden, ['community_announcement'])
})

test('the chess box turns both chess kinds on or off together', () => {
  assert.deepEqual([preferencesFromForm(form('chess_challenge')).chess_game_started, preferencesFromForm(form()).chess_game_started], [true, false])
})
