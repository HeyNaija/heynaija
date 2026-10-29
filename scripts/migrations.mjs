// Checks the database migrations in packages/db/drizzle before they merge.
//
//   node --experimental-strip-types scripts/migrations.mjs
//
// Two things go wrong with migrations that nothing else catches:
//
// 1. Drizzle decides what still has to run by comparing each migration's
//    `when` in meta/_journal.json with the newest one already applied. A
//    migration whose `when` is older than that is silently skipped, which is
//    what a branch merged late looks like. So the journal must be in order, one
//    entry per file.
// 2. Deploys start the new migration while the old release is still serving
//    (infra/deploy/deploy.sh), and a rollback runs old code on the new schema.
//    That only works for additive changes, so a migration newer than
//    BASELINE that is not additive needs `-- allow-breaking: <reason>` in it,
//    which makes the author say why it is safe.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Migrations up to here were written before this check and are left as they are.
export const BASELINE = 27

// The reason must be on the same line; `\s` would reach over the newline into the SQL.
const MARKER = /--[ \t]*allow-breaking:[ \t]*\S+/i

/** The statements of one migration, comments removed. */
const statementsOf = (sql) =>
  sql
    .replace(/--[^\n]*/g, '')
    .split(/-->\s*statement-breakpoint|;/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

/** Why each statement in `sql` is not safe to run beside the previous release's code, or [] if all are. */
export function risks(sql) {
  const statements = statementsOf(sql)
  // An index on a table this same migration creates blocks nobody.
  const created = new Set(
    statements.flatMap((s) => {
      const m = /^CREATE TABLE (?:IF NOT EXISTS )?"?([\w.]+)"?/i.exec(s)
      return m ? [m[1]] : []
    }),
  )
  const found = []
  for (const s of statements) {
    const index = /^CREATE (?:UNIQUE )?INDEX (?!CONCURRENTLY)(?:IF NOT EXISTS )?\S+ ON "?([\w.]+)"?/i.exec(s)
    if (index && !created.has(index[1])) found.push(`CREATE INDEX without CONCURRENTLY blocks writes to ${index[1]} while it builds: ${s.slice(0, 70)}`)
    else if (/^DROP (TABLE|COLUMN|CONSTRAINT|TYPE|SCHEMA|TRIGGER|FUNCTION)\b/i.test(s) || /\bDROP COLUMN\b/i.test(s) || /\bDROP CONSTRAINT\b/i.test(s))
      found.push(`removes something the previous release may still use: ${s.slice(0, 70)}`)
    else if (/\bRENAME\b/i.test(s)) found.push(`renames something the previous release may still use: ${s.slice(0, 70)}`)
    else if (/\bALTER COLUMN\b.*\b(TYPE|SET DATA TYPE|SET NOT NULL|DROP NOT NULL)\b/i.test(s))
      found.push(`changes a column the previous release writes to: ${s.slice(0, 70)}`)
    else if (/\bADD COLUMN\b.*\bNOT NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s))
      found.push(`NOT NULL column with no default fails the previous release's inserts: ${s.slice(0, 70)}`)
    else if (/^(UPDATE|DELETE FROM)\b/i.test(s)) found.push(`backfill holds row locks until the migration ends: ${s.slice(0, 70)}`)
  }
  return found
}

/** Problems with the migrations in `dir` (a folder with the .sql files and meta/_journal.json), as sentences. */
export function check(dir, baseline = BASELINE) {
  const problems = []
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')).entries

  const tags = new Set(journal.map((e) => e.tag))
  for (const file of files) if (!tags.has(file.replace(/\.sql$/, ''))) problems.push(`${file} is not in meta/_journal.json, so it would never run.`)
  for (const tag of tags) if (!files.includes(`${tag}.sql`)) problems.push(`The journal lists ${tag}, which has no .sql file.`)

  journal.forEach((entry, i) => {
    const number = Number(/^(\d+)_/.exec(entry.tag)?.[1])
    if (number !== i) problems.push(`${entry.tag} is entry ${i} in the journal; numbers must run 0000, 0001, ... with no gap or repeat.`)
    if (i > 0 && !(entry.when > journal[i - 1].when))
      problems.push(`${entry.tag} has a timestamp not after ${journal[i - 1].tag}'s. Drizzle would skip it on any database that already ran the later one; regenerate it.`)
  })

  for (const file of files) {
    const number = Number(/^(\d+)_/.exec(file)?.[1])
    if (!(number > baseline)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    if (MARKER.test(sql)) continue
    for (const why of risks(sql)) problems.push(`${file}: ${why}. Add "-- allow-breaking: <why this is safe>" if it is intended.`)
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL('../packages/db/drizzle', import.meta.url))
  const problems = check(dir)
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) process.exit(1)
  console.log('migrations ok')
}
