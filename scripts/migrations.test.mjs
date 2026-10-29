import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { check, risks } from './migrations.mjs'

/** A migrations folder: `files` maps a tag to its SQL, `whens` gives each journal entry's timestamp. */
function folder(t, files, whens) {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
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
    'CREATE INDEX CONCURRENTLY "p_idx" ON "posts" ("id");',
    'CREATE UNIQUE INDEX "p_idx" ON "posts" ("id");',
    'UPDATE "members" SET "x" = 1;',
    'DELETE FROM "members";',
  ])
    assert.equal(risks(sql).length, 1, sql)
})

test('new migrations must say why a risky change is safe, old ones are left alone', (t) => {
  const risky = 'UPDATE "members" SET "x" = 1;'
  assert.deepEqual(check(folder(t, { '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': risky }, [1, 2]), 0).length, 1)
  assert.deepEqual(check(folder(t, { '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': risky }, [1, 2]), 1), [])
  assert.deepEqual(check(folder(t, { '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': `-- allow-breaking: small table\n${risky}` }, [1, 2]), 0), [])
  assert.equal(check(folder(t, { '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': `-- allow-breaking:\n${risky}` }, [1, 2]), 0).length, 1)
})

test('the journal must be in order, with one entry per file', (t) => {
  const sql = 'CREATE TABLE "a" ("id" uuid);'
  assert.match(check(folder(t, { '0000_a': sql, '0001_b': sql }, [2, 1]), 99)[0], /timestamp not after 0000_a/)
  assert.match(check(folder(t, { '0000_a': sql, '0002_c': sql }, [1, 2]), 99)[0], /0002_c is entry 1/)

  const dir = folder(t, { '0000_a': sql }, [1])
  writeFileSync(join(dir, '0001_extra.sql'), sql)
  assert.match(check(dir, 99)[0], /0001_extra\.sql is not in meta\/_journal\.json/)
})

test('an index on an existing table points at the waiver, not at CONCURRENTLY, which cannot run in a migration transaction', () => {
  const [plain] = risks('CREATE INDEX "p_idx" ON "posts" ("id");')
  assert.match(plain, /allow-breaking/)
  assert.doesNotMatch(plain, /use CONCURRENTLY|without CONCURRENTLY/i)
  const [concurrently] = risks('CREATE INDEX CONCURRENTLY "p_idx" ON "posts" ("id");')
  assert.match(concurrently, /transaction/)
  assert.match(concurrently, /allow-breaking/)
})

test('constraints that scan an existing table are flagged unless NOT VALID or the table is new', () => {
  for (const sql of [
    'ALTER TABLE "posts" ADD CONSTRAINT "u" UNIQUE ("a");',
    'ALTER TABLE "posts" ADD CONSTRAINT "c" CHECK ("a" > 0);',
    'ALTER TABLE "posts" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "members"("id") ON DELETE cascade;',
    'ALTER TABLE "restricted"."x" ADD FOREIGN KEY ("a") REFERENCES "members"("id");',
  ])
    assert.equal(risks(sql).length, 1, sql)
  assert.deepEqual(risks('ALTER TABLE "posts" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "members"("id") NOT VALID;'), [])
  assert.deepEqual(
    risks('CREATE TABLE "n" ("a" uuid);--> statement-breakpoint\nALTER TABLE "n" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "members"("id");'),
    [],
  )
  // The foreign key of an existing table to a new one still scans the existing table.
  assert.equal(risks('CREATE TABLE "n" ("a" uuid);\nALTER TABLE "posts" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "n"("id");').length, 1)
})

test('TRUNCATE, INSERT ... SELECT backfills and dropping views, sequences and extensions are flagged', () => {
  for (const sql of [
    'TRUNCATE "posts";',
    'INSERT INTO "a" ("x") SELECT "x" FROM "b";',
    'DROP VIEW "v";',
    'DROP MATERIALIZED VIEW "v";',
    'DROP SEQUENCE "s";',
    'DROP EXTENSION pgcrypto;',
  ])
    assert.equal(risks(sql).length, 1, sql)
  assert.deepEqual(risks(`INSERT INTO "a" ("x") VALUES ('y');`), [])
})

test('a volatile default rewrites the table; a stable one does not', () => {
  for (const sql of [
    'ALTER TABLE "posts" ADD COLUMN "x" uuid DEFAULT gen_random_uuid() NOT NULL;',
    'ALTER TABLE "posts" ADD COLUMN "x" double precision DEFAULT random();',
    'ALTER TABLE "posts" ADD COLUMN "x" timestamptz DEFAULT clock_timestamp() NOT NULL;',
    'ALTER TABLE "posts" ADD COLUMN "x" bigserial;',
  ])
    assert.equal(risks(sql).length, 1, sql)
  assert.deepEqual(risks('ALTER TABLE "posts" ADD COLUMN "x" timestamptz DEFAULT now() NOT NULL;'), [])
  assert.deepEqual(risks('CREATE TABLE "n" ("id" uuid);\nALTER TABLE "n" ADD COLUMN "x" uuid DEFAULT gen_random_uuid() NOT NULL;'), [])
})

test('a waiver covers only the statement after it, or on its line', () => {
  const waived = '-- allow-breaking: tiny table\nUPDATE "a" SET "x" = 1;'
  assert.deepEqual(risks(waived), [])
  assert.deepEqual(risks('UPDATE "a" SET "x" = 1; -- allow-breaking: tiny table'), [])
  assert.equal(risks('UPDATE "a" SET "x" = 1; -- allow-breaking: tiny table\nDELETE FROM "b";').length, 1)
  assert.equal(risks(`${waived}\nALTER TABLE "posts" DROP COLUMN "x";`).length, 1)
  assert.equal(risks(`${waived}\n\nDELETE FROM "b";`).length, 1)
  assert.equal(risks('-- allow-breaking:\nDELETE FROM "b";').length, 1)
})

test('a waiver in the file does not hide a later drop', (t) => {
  const sql = '-- allow-breaking: small\nUPDATE "a" SET "x" = 1;\nALTER TABLE "posts" DROP COLUMN "x";'
  assert.equal(check(folder(t, { '0000_a': 'CREATE TABLE "a" ("id" uuid);', '0001_b': sql }, [1, 2]), 0).length, 1)
})

test('schema-qualified and quoted table names are told apart', () => {
  const sql = 'CREATE TABLE "restricted"."new_table" ("id" uuid);\nCREATE INDEX "i" ON "restricted"."identity_verifications" ("id");'
  assert.equal(risks(sql).length, 1)
  assert.deepEqual(risks('CREATE TABLE "restricted"."new_table" ("id" uuid);\nCREATE INDEX "i" ON restricted.new_table ("id");'), [])
  assert.deepEqual(risks('CREATE TABLE IF NOT EXISTS "public"."t" ("id" uuid);\nCREATE INDEX "i" ON "t" ("id");'), [])
})

test('semicolons inside $$ bodies and string literals do not split a statement', () => {
  const fn = `CREATE OR REPLACE FUNCTION bump() RETURNS trigger AS $$
BEGIN
  UPDATE posts SET reply_count = reply_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER t AFTER INSERT ON replies FOR EACH ROW EXECUTE FUNCTION bump();`
  assert.deepEqual(risks(fn), [])
  assert.deepEqual(risks(`CREATE FUNCTION f() RETURNS void AS $body$ DROP COLUMN; $body$ LANGUAGE sql;`), [])
  assert.deepEqual(risks(`COMMENT ON TABLE "a" IS 'x; DELETE FROM b';`), [])
})

test('the command line checks the repository when started through a symlink', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-link-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const link = join(dir, 'scripts-link')
  symlinkSync(fileURLToPath(new URL('.', import.meta.url)), link)
  const run = spawnSync(process.execPath, ['--experimental-strip-types', join(link, 'migrations.mjs')], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /migrations ok/)
})
