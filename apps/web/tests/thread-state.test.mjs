import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendReplyPage, canRenderThreadChildren, emptyBranch, insertConfirmedReply, nextThreadPath, pruneCollapsedBranches } from '../lib/thread-state.ts'

const row = (id) => ({ id, node: id })
const loaded = (items = [], cursor = null) => ({ ...emptyBranch('root'), items: items.map(row), cursor, loaded: true, open: true })

test('a corrupt branch cycle stops at the repeated ancestor without suppressing unrelated paths', () => {
  const root = nextThreadPath([], 'root')
  const child = nextThreadPath(root, 'child')
  assert.deepEqual(child, ['root', 'child'])
  assert.equal(nextThreadPath(child, 'root'), null)
  assert.equal(nextThreadPath(child, 'child'), null)
  assert.deepEqual(nextThreadPath(['another-root'], 'child'), ['another-root', 'child'])
  assert.deepEqual(root, ['root'])
})

test('cached children cannot bypass the rendered depth cap even if their saved depth is shallow', () => {
  assert.equal(canRenderThreadChildren(0, 1), true)
  assert.equal(canRenderThreadChildren(5, 6), true)
  assert.equal(canRenderThreadChildren(6, 7), false)
  assert.equal(canRenderThreadChildren(3, 7), false)
  assert.equal(canRenderThreadChildren(7, 2), false)
})

test('a confirmed reply stays separate from an incomplete oldest-first page and cannot move its cursor', () => {
  const branch = insertConfirmedReply(loaded(['a', 'b'], 'after-b'), row('new'))
  assert.deepEqual(branch.items.map((item) => item.id), ['a', 'b'])
  assert.deepEqual(branch.recent.map((item) => item.id), ['new'])
  assert.equal(branch.cursor, 'after-b')
  assert.equal(insertConfirmedReply(branch, row('new')), branch)
})

test('pagination deduplicates a confirmed reply when the server reaches it, while preserving a remaining gap', () => {
  const branch = insertConfirmedReply(loaded(['a'], 'after-a'), row('new'))
  const next = appendReplyPage(branch, [row('b'), row('new')], 'after-new')
  assert.deepEqual(next.items.map((item) => item.id), ['a', 'b', 'new'])
  assert.deepEqual(next.recent, [])
  assert.equal(next.cursor, 'after-new')
})

test('a final page joins a newer confirmed reply into the complete sibling list once', () => {
  const branch = insertConfirmedReply(loaded(['a'], 'after-a'), row('new'))
  const next = appendReplyPage(branch, [row('a'), row('b')], null)
  assert.deepEqual(next.items.map((item) => item.id), ['a', 'b', 'new'])
  assert.deepEqual(next.recent, [])
  assert.equal(next.cursor, null)
})

test('new replies append normally only to a complete loaded branch', () => {
  const complete = insertConfirmedReply(loaded(['a']), row('new'))
  assert.deepEqual(complete.items.map((item) => item.id), ['a', 'new'])
  const unopened = insertConfirmedReply(emptyBranch('root'), row('new'))
  assert.equal(unopened.loaded, false)
  assert.deepEqual(unopened.items, [])
  assert.deepEqual(unopened.recent.map((item) => item.id), ['new'])
})

test('an in-flight page finishing after collapse does not reopen its branch', () => {
  const collapsed = { ...loaded(['a'], 'after-a'), open: false }
  assert.equal(appendReplyPage(collapsed, [row('b')], null).open, false)
})

test('collapsed cache eviction keeps active branches and the editor ancestry', () => {
  const cache = {
    root: { ...loaded(['a', 'b', 'active']), parentId: null },
    a: { ...loaded(['a1', 'a2']), open: false, touched: 1 },
    a1: { ...loaded(['a1child']), parentId: 'a', touched: 1 },
    b: { ...loaded(['b1', 'b2']), open: false, touched: 2 },
    active: { ...loaded(['c1', 'c2']), touched: 3 },
  }
  const target = { id: 'b1', parentId: 'b', handle: 'bayo', depth: 2 }
  const pruned = pruneCollapsedBranches(cache, 'root', target, 1)
  assert.equal(pruned.a, undefined)
  assert.equal(pruned.a1, undefined)
  assert.equal(pruned.b, cache.b)
  assert.equal(pruned.active, cache.active)
  assert.equal(pruned.root, cache.root)
})
