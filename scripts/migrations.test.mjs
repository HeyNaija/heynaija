import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

test('NOT VALID only excuses CHECK and FOREIGN KEY; UNIQUE, PRIMARY KEY and EXCLUDE cannot be NOT VALID', () => {
  for (const sql of [
    'ALTER TABLE "p" ADD CONSTRAINT "u" UNIQUE ("a") NOT VALID;',
    'ALTER TABLE "p" ADD CONSTRAINT "u" UNIQUE ("a");',
    'ALTER TABLE "p" ADD PRIMARY KEY ("a");',
    'ALTER TABLE "p" ADD CONSTRAINT "e" EXCLUDE USING gist ("a" WITH =);',
  ]) {
    const [why] = risks(sql)
    assert.ok(why, sql)
    assert.doesNotMatch(why, /then VALIDATE/, sql)
    assert.match(why, /allow-breaking/, sql)
  }
  const [fk] = risks('ALTER TABLE "p" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "m"("id");')
  assert.match(fk, /NOT VALID/)
  assert.deepEqual(risks('ALTER TABLE "p" ADD CONSTRAINT "c" CHECK ("a" > 0) NOT VALID;'), [])
  assert.deepEqual(risks('ALTER TABLE "p" ADD CONSTRAINT "u" UNIQUE USING INDEX "u_idx";'), [])
})

test('comments, DO blocks, escaped strings and CTE-led writes cannot hide a statement', () => {
  for (const sql of [
    '/* x; */ DROP TABLE posts;',
    '/* multi\nline; */\nDROP TABLE posts;',
    'DO $$ BEGIN DROP TABLE posts; END $$;',
    "SELECT E'it\\'s'; DROP TABLE posts;",
    'WITH x AS (SELECT 1) UPDATE a SET b = 1;',
    'WITH x AS (SELECT 1) DELETE FROM a;',
    'WITH x AS (SELECT 1) INSERT INTO a SELECT * FROM x;',
  ])
    assert.equal(risks(sql).length, 1, sql)
  assert.deepEqual(risks('/* DROP TABLE posts; */ SELECT 1;'), [])
  assert.deepEqual(risks('WITH x AS (SELECT 1) SELECT * FROM x;'), [])
})

test('every action of an ALTER TABLE is judged, not just the first', () => {
  const found = risks('ALTER TABLE "p" ADD CONSTRAINT c CHECK (x > 0) NOT VALID, DROP COLUMN b;')
  assert.equal(found.length, 1)
  assert.match(found[0], /removes/)
  assert.equal(risks('ALTER TABLE "p" DROP COLUMN a, DROP COLUMN b;').length, 2)
  assert.deepEqual(risks('ALTER TABLE "p" ADD COLUMN "a" numeric(10,2), ADD COLUMN "b" text;'), [])
})

test('a waiver at the end of a line covers only the statement it follows', () => {
  const found = risks('UPDATE a SET x = 1; DROP TABLE posts; -- allow-breaking: x')
  assert.equal(found.length, 1)
  assert.match(found[0], /backfill/)
  assert.deepEqual(risks('UPDATE a SET x = 1 -- allow-breaking: x\n;'), [])
  assert.equal(risks('-- allow-breaking: x\nUPDATE a SET x = 1; DROP TABLE posts;').length, 1)
})

test('only the serial TYPE is volatile; generated and inline UNIQUE columns are flagged', () => {
  assert.deepEqual(risks('ALTER TABLE "p" ADD COLUMN "serial" text;'), [])
  assert.deepEqual(risks("ALTER TABLE \"p\" ADD COLUMN \"note\" text DEFAULT 'serial';"), [])
  for (const sql of [
    'ALTER TABLE "p" ADD COLUMN "x" serial;',
    'ALTER TABLE "p" ADD COLUMN "x" smallserial;',
    'ALTER TABLE "p" ADD COLUMN x int GENERATED ALWAYS AS (1 + 1) STORED;',
    'ALTER TABLE "p" ADD COLUMN x int GENERATED ALWAYS AS IDENTITY;',
    'ALTER TABLE "p" ADD COLUMN x int UNIQUE;',
    'ALTER TABLE "p" ADD COLUMN x int PRIMARY KEY;',
  ])
    assert.equal(risks(sql).length, 1, sql)
})

test('dropping a unique index an earlier migration made is flagged; a plain one is not', (t) => {
  const made = {
    '0000_a': 'CREATE TABLE "s" ("e" text, "m" uuid);--> statement-breakpoint\nCREATE UNIQUE INDEX "s_e_idx" ON "s" USING btree ("e");--> statement-breakpoint\nCREATE INDEX "s_m_idx" ON "s" ("m");',
  }
  const [why, ...more] = check(folder(t, { ...made, '0001_b': 'DROP INDEX "s_e_idx";' }, [1, 2]), 0)
  assert.match(why, /0001_b\.sql: drops the unique index s_e_idx/)
  assert.deepEqual(more, [])
  assert.deepEqual(check(folder(t, { ...made, '0001_b': 'DROP INDEX "s_m_idx";' }, [1, 2]), 0), [])
  assert.deepEqual(check(folder(t, { ...made, '0001_b': '-- allow-breaking: nothing upserts on it\nDROP INDEX "s_e_idx";' }, [1, 2]), 0), [])
  // Once dropped, a later migration dropping the same name again (IF EXISTS) has nothing left to break.
  assert.deepEqual(check(folder(t, { ...made, '0001_b': '-- allow-breaking: x\nDROP INDEX "s_e_idx";', '0002_c': 'DROP INDEX IF EXISTS "s_e_idx";' }, [1, 2, 3]), 0), [])

  const unique = new Set(['push_subscriptions_endpoint_idx', 'identity_verifications_person_idx'])
  for (const sql of [
    'DROP INDEX "push_subscriptions_endpoint_idx";',
    'DROP INDEX IF EXISTS "restricted"."identity_verifications_person_idx" CASCADE;',
    'DROP INDEX "other_idx", "push_subscriptions_endpoint_idx";',
  ])
    assert.equal(risks(sql, unique).length, 1, sql)
})

test('a new migration dropping one of the repository’s unique indexes is flagged', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-repo-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  cpSync(fileURLToPath(new URL('../packages/db/drizzle', import.meta.url)), dir, { recursive: true })
  const journalFile = join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalFile, 'utf8'))
  const last = journal.entries.at(-1)
  const tag = `${String(journal.entries.length).padStart(4, '0')}_drop_endpoint`
  journal.entries.push({ ...last, idx: journal.entries.length, when: last.when + 1, tag })
  writeFileSync(journalFile, JSON.stringify(journal))
  // The push upsert's ON CONFLICT (endpoint) relies on it.
  writeFileSync(join(dir, `${tag}.sql`), 'DROP INDEX "push_subscriptions_endpoint_idx";')
  assert.match(check(dir).join('\n'), /drops the unique index push_subscriptions_endpoint_idx/)
})

test('removing what fills a column on insert is flagged; changing it is not', () => {
  for (const sql of [
    'ALTER TABLE "members" ALTER COLUMN "bio" DROP DEFAULT;',
    'ALTER TABLE "p" ALTER COLUMN "id" DROP IDENTITY IF EXISTS;',
    'ALTER TABLE "p" ALTER COLUMN "total" DROP EXPRESSION;',
  ])
    assert.equal(risks(sql).length, 1, sql)
  assert.deepEqual(risks(`ALTER TABLE "members" ALTER COLUMN "bio" SET DEFAULT 'x';`), [])
})

test('statements that cannot run in the migration transaction are refused, waiver or not', () => {
  for (const sql of [
    'DROP INDEX CONCURRENTLY "posts_reply_parent_idx";',
    'REINDEX INDEX CONCURRENTLY "posts_pkey";',
    'VACUUM ANALYZE "posts";',
    'ALTER TABLE "p" DETACH PARTITION "p_2026" CONCURRENTLY;',
    'CREATE INDEX CONCURRENTLY "i" ON "posts" ("id");',
    'CREATE TABLE "n" ("id" uuid);\nCREATE INDEX CONCURRENTLY "i" ON "n" ("id");',
  ]) {
    const found = risks(sql)
    assert.equal(found.length, 1, sql)
    assert.match(found[0], /cannot run/, sql)
  }
  assert.equal(risks('-- allow-breaking: we know\nCREATE INDEX CONCURRENTLY "i" ON "posts" ("id");').length, 1)
  assert.equal(risks('DROP INDEX CONCURRENTLY "i"; -- allow-breaking: we know').length, 1)
  assert.deepEqual(risks('REFRESH MATERIALIZED VIEW CONCURRENTLY "v";'), [])
})

test('quoted and $-bearing names start no string, comment or dollar quote', () => {
  for (const sql of [
    'ALTER TABLE "a$x$b" ADD COLUMN "c" text;\nDROP TABLE "posts";',
    'ALTER TABLE "it\'s" ADD COLUMN "c" text;\nDROP TABLE "posts";\nCOMMENT ON TABLE "a" IS \'x\';',
    'ALTER TABLE "a--b" ADD COLUMN "c" text; DROP TABLE "posts";',
    'ALTER TABLE "a/*b" ADD COLUMN "c" text; DROP TABLE "posts";',
    'ALTER TABLE foo$x$ ADD COLUMN c text;\nDROP TABLE posts;',
    'ALTER TABLE "say ""hi""" ADD COLUMN c text;\nDROP TABLE posts;',
  ])
    assert.deepEqual(risks(sql).map((why) => why.split(':')[0]), ['removes something the previous release may still use'], sql)
  assert.equal(risks('ALTER TABLE "a;b" DROP COLUMN "x";').length, 1)
  assert.deepEqual(risks('CREATE TABLE "a;b" ("id" uuid);\nCREATE INDEX "i" ON "a;b" ("id");'), [])
})
