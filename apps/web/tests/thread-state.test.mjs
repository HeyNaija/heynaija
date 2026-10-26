import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendReplyPage, canRenderThreadChildren, emptyBranch, insertConfirmedReply, nextThreadPath, pruneCollapsedBranches, THREAD_MAX_DEPTH, THREAD_MAX_GAPS } from '../lib/thread-state.ts'

const row = (id) => ({ id, node: id, lead: id.startsWith('lead') })
const loaded = (items = [], cursor = null) => ({ ...emptyBranch('root'), items: items.map(row), cursor, loaded: true, open: true })
const ids = (rows) => rows.map((item) => item.id)

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
  assert.equal(THREAD_MAX_DEPTH, 3)
  assert.equal(canRenderThreadChildren(0, 1), true)
  assert.equal(canRenderThreadChildren(2, 3), true)
  assert.equal(canRenderThreadChildren(3, 4), false)
  assert.equal(canRenderThreadChildren(1, 5), false)
  assert.equal(canRenderThreadChildren(7, 2), false)
})

test('a deleted post may open past the cap, up to a bound, so the replies behind it stay reachable', () => {
  assert.equal(canRenderThreadChildren(3, 4, true), true)
  assert.equal(canRenderThreadChildren(THREAD_MAX_DEPTH + THREAD_MAX_GAPS - 1, THREAD_MAX_DEPTH + THREAD_MAX_GAPS, true), true)
  assert.equal(canRenderThreadChildren(THREAD_MAX_DEPTH + THREAD_MAX_GAPS, THREAD_MAX_DEPTH + THREAD_MAX_GAPS + 1, true), false)
  assert.equal(canRenderThreadChildren(1, THREAD_MAX_DEPTH + THREAD_MAX_GAPS + 1, true), false)
})

test('a confirmed reply stays separate from an incomplete oldest-first page and cannot move its cursor', () => {
  const branch = insertConfirmedReply(loaded(['a', 'b'], 'after-b'), row('new'), 'oldest')
  assert.deepEqual(branch.items.map((item) => item.id), ['a', 'b'])
  assert.deepEqual(branch.recent.map((item) => item.id), ['new'])
  assert.equal(branch.cursor, 'after-b')
  assert.equal(insertConfirmedReply(branch, row('new'), 'oldest'), branch)
})

test('pagination deduplicates a confirmed reply when the server reaches it, while preserving a remaining gap', () => {
  const branch = insertConfirmedReply(loaded(['a'], 'after-a'), row('new'), 'oldest')
  const next = appendReplyPage(branch, [row('b'), row('new')], 'after-new')
  assert.deepEqual(next.items.map((item) => item.id), ['a', 'b', 'new'])
  assert.deepEqual(next.recent, [])
  assert.equal(next.cursor, 'after-new')
})

test('a final page joins a newer confirmed reply into the complete sibling list once', () => {
  const branch = insertConfirmedReply(loaded(['a'], 'after-a'), row('new'), 'oldest')
  const next = appendReplyPage(branch, [row('a'), row('b')], null)
  assert.deepEqual(next.items.map((item) => item.id), ['a', 'b', 'new'])
  assert.deepEqual(next.recent, [])
  assert.equal(next.cursor, null)
})

test('oldest first, new replies append normally only to a complete loaded branch', () => {
  const complete = insertConfirmedReply(loaded(['a']), row('new'), 'oldest')
  assert.deepEqual(complete.items.map((item) => item.id), ['a', 'new'])
  for (const order of ['oldest', 'newest']) {
    const unopened = insertConfirmedReply(emptyBranch('root'), row('new'), order)
    assert.equal(unopened.loaded, false)
    assert.deepEqual(unopened.items, [])
    assert.deepEqual(unopened.recent.map((item) => item.id), ['new'])
  }
})

test("newest first, a new reply goes to the top of its group: the author's, or everyone else's after them", () => {
  assert.deepEqual(ids(insertConfirmedReply(loaded(['lead-b', 'lead-a', 'b', 'a'], 'after-a'), row('new'), 'newest').items), ['lead-b', 'lead-a', 'new', 'b', 'a'])
  assert.deepEqual(ids(insertConfirmedReply(loaded(['lead-b', 'b'], 'after-b'), row('lead-new'), 'newest').items), ['lead-new', 'lead-b', 'b'])
  assert.deepEqual(ids(insertConfirmedReply(loaded(['a'], 'after-a'), row('new'), 'newest').items), ['new', 'a'])
  assert.deepEqual(ids(insertConfirmedReply(loaded([]), row('new'), 'newest').items), ['new'])
  // The author may have more replies on the next page, so where everyone else's start is not known yet.
  const gap = insertConfirmedReply(loaded(['lead-b', 'lead-a'], 'after-lead-a'), row('new'), 'newest')
  assert.deepEqual(ids(gap.items), ['lead-b', 'lead-a'])
  assert.deepEqual(ids(gap.recent), ['new'])
  // The next page reaches it at its place, and it shows once.
  assert.deepEqual(ids(appendReplyPage(gap, [row('new'), row('a')], null).items), ['lead-b', 'lead-a', 'new', 'a'])
})

test("oldest first, the author's new reply ends their group once everyone else's have begun", () => {
  assert.deepEqual(ids(insertConfirmedReply(loaded(['lead-a', 'lead-b', 'a'], 'after-a'), row('lead-new'), 'oldest').items), ['lead-a', 'lead-b', 'lead-new', 'a'])
  assert.deepEqual(ids(insertConfirmedReply(loaded(['lead-a'], null), row('lead-new'), 'oldest').items), ['lead-a', 'lead-new'])
  assert.deepEqual(ids(insertConfirmedReply(loaded(['lead-a'], 'after-lead-a'), row('lead-new'), 'oldest').recent), ['lead-new'])
  assert.deepEqual(ids(insertConfirmedReply(loaded(['lead-a', 'a'], 'after-a'), row('new'), 'oldest').recent), ['new'])
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
