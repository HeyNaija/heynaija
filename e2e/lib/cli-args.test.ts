import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileFilter, isFileArg, withFileFilters } from './cli-args.ts'

// Playwright's own reading of a name: a case-insensitive regex, after any :line is cut off.
const matches = (name: string, file: string) => new RegExp(fileFilter(name).replace(/(:\d+){1,2}$/, ''), 'i').test(file)

const worktree = '/Users/a/heynaija/.claude/worktrees/gists/e2e/tests'

test('a bare name matches spec files by their own name, never the folders above them', () => {
  assert.equal(matches('gists', `${worktree}/gists.spec.ts`), true)
  assert.equal(matches('gists', `${worktree}/gists-dark.spec.ts`), true)
  assert.equal(matches('gists', `${worktree}/posting.spec.ts`), false)
  assert.equal(matches('posting', `${worktree}/posting.spec.ts`), true)
  // Part of a name still does, as docs/e2e.md says.
  assert.equal(matches('reply', `${worktree}/polls-reply-controls.spec.ts`), true)
  // On Windows the separators are backslashes.
  assert.equal(matches('gists', 'C:\\work\\gists\\e2e\\tests\\posting.spec.ts'), false)
  assert.equal(matches('posting', 'C:\\work\\gists\\e2e\\tests\\posting.spec.ts'), true)
})

test('a name with .spec, :line or regex characters still means that file', () => {
  assert.equal(matches('posting.spec', `${worktree}/posting.spec.ts`), true)
  assert.match(fileFilter('posting:15'), /:15$/)
  assert.match(fileFilter('posting:15:3'), /:15:3$/)
  assert.equal(matches('a+b', `${worktree}/a+b.spec.ts`), true)
  assert.equal(matches('a+b', `${worktree}/aab.spec.ts`), false)
})

test('paths and .ts names pass through unchanged', () => {
  for (const name of ['tests/posting.spec.ts', 'posting.spec.ts', 'posting.spec.ts:15', 'e2e\\tests\\posting.spec.ts']) {
    assert.equal(fileFilter(name), name)
  }
})

test('options and their values are left alone; only file names are rewritten', () => {
  const args = ['posting', '-g', 'two words', '--project', 'mobile', '--workers=1', 'threads', '--last-failed']
  assert.deepEqual(
    args.map((_, i) => isFileArg(args, i)),
    [true, false, false, false, false, false, true, false],
  )
  const out = withFileFilters(args)
  assert.equal(out[1], '-g')
  assert.equal(out[2], 'two words')
  assert.equal(out[3], '--project')
  assert.equal(out[4], 'mobile')
  assert.equal(out[5], '--workers=1')
  assert.notEqual(out[0], 'posting')
  assert.notEqual(out[6], 'threads')
})
