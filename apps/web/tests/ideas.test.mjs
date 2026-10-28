import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boardHref, ideaIdFrom, ideaNews } from '../lib/ideas.ts'

test('the board’s address leaves out what is the default', () => {
  assert.equal(boardHref({ group: 'open', kind: 'all', sort: 'top' }), '/ideas')
  assert.equal(boardHref({ group: 'closed', kind: 'problem', sort: 'new' }, 50), '/ideas?group=closed&kind=problem&sort=new&cursor=50')
})

test('a notification says whose idea it is and what it is now', () => {
  assert.equal(ideaNews({ kind: 'idea', yours: true }, 'planned'), 'Your idea is now planned')
  assert.equal(ideaNews({ kind: 'problem', yours: false }, 'in_progress'), 'A problem you voted for is now in progress')
  assert.equal(ideaNews({ kind: 'idea', yours: false }, 'nonsense'), 'An idea you voted for has a new status')
})

test('an idea is named by its link or its ID', () => {
  const id = '0b8c3f9e-1d2a-4c5b-9e7f-1234567890ab'
  assert.equal(ideaIdFrom(`https://heynaija.ng/p/${id}`), id)
  assert.equal(ideaIdFrom(id.toUpperCase()), id)
  assert.equal(ideaIdFrom('the other one'), null)
})
