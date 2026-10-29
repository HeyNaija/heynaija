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
//    BASELINE that is not additive needs `-- allow-breaking: <reason>` on the
//    line before the statement (or on its line), which makes the author say why
//    it is safe. The waiver covers that one statement only.
//
//    Drizzle runs all pending migrations in one transaction, so statements that
//    cannot run in a transaction (CREATE INDEX CONCURRENTLY) are not an option.

import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Migrations up to here were written before this check and are left as they are.
export const BASELINE = 27

// The reason must be on the same line; `\s` would reach over the newline into the SQL.
const MARKER = /--[ \t]*allow-breaking:[ \t]*\S+/i

/**
 * The statements of one migration: comments removed, `$$ ... $$` bodies and
 * string literals blanked (their `;` and words are not statements), whitespace
 * collapsed. `waived` is true when a `-- allow-breaking: <reason>` sits on the
 * line of its own right before the statement starts, or on the line it starts on.
 */
function statementsOf(sql) {
  const lines = sql.split('\n')
  const waivedAt = (line) => MARKER.test(lines[line] ?? '')
  const out = []
  let text = ''
  let startLine = -1
  let line = 0
  const add = (chunk) => {
    if (startLine < 0 && chunk.trim()) startLine = line
    text += chunk
  }
  const flush = () => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t) out.push({ text: t, waived: (/^\s*--/.test(lines[startLine - 1] ?? '') && waivedAt(startLine - 1)) || waivedAt(startLine) })
    text = ''
    startLine = -1
  }
  for (let i = 0; i < sql.length; ) {
    const rest = sql.slice(i)
    let m
    if (sql[i] === '\n') { add('\n'); line++; i++ }
    else if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i)
      const comment = sql.slice(i, end < 0 ? sql.length : end)
      if (/^-->\s*statement-breakpoint/.test(comment)) flush()
      i += comment.length
    } else if ((m = /^\$([A-Za-z_]\w*)?\$/.exec(rest))) {
      const close = sql.indexOf(m[0], i + m[0].length)
      const stop = close < 0 ? sql.length : close + m[0].length
      add(' $$ $$ ')
      line += sql.slice(i, stop).split('\n').length - 1
      i = stop
    } else if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1
      add(" '' ")
      line += sql.slice(i, j + 1).split('\n').length - 1
      i = j + 1
    } else if (sql[i] === ';') { flush(); i++ }
    else { add(sql[i]); i++ }
  }
  flush()
  return out
}

// A table name as written: bare, quoted, or schema-qualified with either part quoted.
const IDENT = String.raw`(?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?`
/** `"restricted"."X"` and restricted.x are the same table; `public.` is implied. */
const normalise = (name) => name.replace(/"/g, '').replace(/\s+/g, '').toLowerCase().replace(/^public\./, '')

const VOLATILE = /\bDEFAULT\b.*\b(gen_random_uuid|uuid_generate_v[14]|uuidv[47]|random|clock_timestamp|timeofday|nextval|setseed)\s*\(|\b(big|small)?serial\b/i

const WAIVER = 'if it is intended, waive it with "-- allow-breaking: <why this is safe>" on the line before'

/** Why each statement in `sql` that has no waiver is not safe to run beside the previous release's code, or [] if all are. */
export function risks(sql) {
  const statements = statementsOf(sql)
  // Tables this same migration creates: nobody reads or writes them yet.
  const created = new Set(
    statements.flatMap(({ text }) => {
      const m = new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?(${IDENT})`, 'i').exec(text)
      return m ? [normalise(m[1])] : []
    }),
  )
  const found = []
  for (const { text: s, waived } of statements) {
    if (waived) continue
    const head = s.slice(0, 70)
    const index = new RegExp(`^CREATE (?:UNIQUE )?INDEX (CONCURRENTLY )?(?:IF NOT EXISTS )?(?:${IDENT} )?ON (?:ONLY )?(${IDENT})`, 'i').exec(s)
    const alter = new RegExp(`^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(${IDENT})`, 'i').exec(s)
    if (index) {
      if (created.has(normalise(index[2]))) continue
      const table = normalise(index[2])
      found.push(
        index[1]
          ? `CREATE INDEX CONCURRENTLY cannot run: migrations run in one transaction and Postgres refuses it there. A plain index blocks writes to ${table} while it builds; ${WAIVER}: ${head}`
          : `CREATE INDEX blocks writes to ${table} while it builds (CONCURRENTLY cannot be used inside the migration transaction); ${WAIVER}: ${head}`,
      )
    } else if (alter && /\bADD (?:CONSTRAINT \S+ )?(?:UNIQUE|CHECK|FOREIGN KEY|PRIMARY KEY|EXCLUDE)\b/i.test(s)) {
      if (!created.has(normalise(alter[1])) && !/\bNOT VALID\b/i.test(s))
        found.push(`adding a constraint scans ${normalise(alter[1])} under lock and the previous release may break it (use NOT VALID, then VALIDATE in a later release): ${head}`)
    } else if (/^DROP (TABLE|COLUMN|CONSTRAINT|TYPE|SCHEMA|TRIGGER|FUNCTION|VIEW|MATERIALIZED VIEW|SEQUENCE|EXTENSION)\b/i.test(s) || /\bDROP COLUMN\b/i.test(s) || /\bDROP CONSTRAINT\b/i.test(s))
      found.push(`removes something the previous release may still use: ${head}`)
    else if (/\bRENAME\b/i.test(s)) found.push(`renames something the previous release may still use: ${head}`)
    else if (/\bALTER COLUMN\b.*\b(TYPE|SET DATA TYPE|SET NOT NULL|DROP NOT NULL)\b/i.test(s))
      found.push(`changes a column the previous release writes to: ${head}`)
    else if (/\bADD COLUMN\b/i.test(s) && VOLATILE.test(s)) {
      if (!(alter && created.has(normalise(alter[1])))) found.push(`a volatile default rewrites the whole table under an exclusive lock: ${head}`)
    } else if (/\bADD COLUMN\b.*\bNOT NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s))
      found.push(`NOT NULL column with no default fails the previous release's inserts: ${head}`)
    else if (/^TRUNCATE\b/i.test(s)) found.push(`TRUNCATE takes an exclusive lock and empties the table: ${head}`)
    else if (/^INSERT INTO\b.*\bSELECT\b/i.test(s)) found.push(`backfill holds row locks until the migration ends: ${head}`)
    else if (/^(UPDATE|DELETE FROM)\b/i.test(s)) found.push(`backfill holds row locks until the migration ends: ${head}`)
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
    for (const why of risks(sql)) problems.push(`${file}: ${why}`)
  }
  return problems
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL('../packages/db/drizzle', import.meta.url))
  const problems = check(dir)
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) process.exit(1)
  console.log('migrations ok')
}
