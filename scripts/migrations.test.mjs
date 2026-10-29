import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { check, risks } from './migrations.mjs'

/** A migrations folder: `files` maps a tag to its SQL, `whens` gives each journal entry's timestamp. */
function folder(files, whens) {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
  mkdirSync(join(dir, 'meta'))
  const tags = Object.keys(files)
  for (const tag of tags) writeFileSync(join(dir, `${tag}.sql`), files[tag])
  const entries = tags.map((tag, idx) => ({ idx, version: '7', when: whens[idx], tag, breakpoints: true }))
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries }))
  return dir
}

test('the migrations in the repository pass', () => {
  assert.deepEqual(check(fileURLToPath(new URL('../packages/db/drizzle', import.meta.url))), [])
})

test('additive changes are fine', () => {
  assert.deepEqual(risks('CREATE TABLE "a" ("id" uuid);--> statement-breakpoint\nCREATE INDEX "a_idx" ON "a" ("id");'), [])
  assert.deepEqual(risks('ALTER TABLE "posts" ADD COLUMN "x" boolean DEFAULT true NOT NULL;'), [])
  assert.deepEqual(risks('ALTER TABLE "posts" ADD COLUMN "x" text;'), [])
  assert.deepEqual(risks('CREATE INDEX CONCURRENTLY "p_idx" ON "posts" ("id");'), [])
  assert.deepEqual(risks('-- UPDATE in a comment\nDROP INDEX "gone";'), [])
})

test('what the previous release could trip on is flagged', () => {
  for (const sql of [
    'ALTER TABLE "posts" DROP COLUMN "x";',
    'DROP TABLE "x";',
    'ALTER TABLE "posts" RENAME COLUMN "a" TO "b";',
    'ALTER TABLE "reports" ALTER COLUMN "reporter_id" DROP NOT NULL;',
    'ALTER TABLE "posts" ALTER COLUMN "a" SET DATA TYPE text;',
    'ALTER TABLE "posts" ADD COLUMN "x" text NOT NULL;',
    'CREATE INDEX "p_idx" ON "posts" ("id");',
    'CREATE UNIQUE INDEX "p_idx" ON "posts" ("id");',
    'UPDATE "members" SET "x" = 1;',
    'DELETE FROM "members";',
  ])
    assert.equal(risks(sql).length, 1, sql)
})

test('new migrations must say why a risky change is safe, old ones are left alone', () => {
  const risky = 'UPDATE "members" SET "x" = 1;'
  assert.deepEqual(check(folder({ '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': risky }, [1, 2]), 0).length, 1)
  assert.deepEqual(check(folder({ '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': risky }, [1, 2]), 1), [])
  assert.deepEqual(check(folder({ '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': `-- allow-breaking: small table\n${risky}` }, [1, 2]), 0), [])
  assert.equal(check(folder({ '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': `-- allow-breaking:\n${risky}` }, [1, 2]), 0).length, 1)
})

test('the journal must be in order, with one entry per file', () => {
  const sql = 'CREATE TABLE "a" ("id" uuid);'
  assert.match(check(folder({ '0000_a': sql, '0001_b': sql }, [2, 1]), 99)[0], /timestamp not after 0000_a/)
  assert.match(check(folder({ '0000_a': sql, '0002_c': sql }, [1, 2]), 99)[0], /0002_c is entry 1/)

  const dir = folder({ '0000_a': sql }, [1])
  writeFileSync(join(dir, '0001_extra.sql'), sql)
  assert.match(check(dir, 99)[0], /0001_extra\.sql is not in meta\/_journal\.json/)
})
