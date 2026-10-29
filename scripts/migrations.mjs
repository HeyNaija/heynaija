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
 * collapsed. `waived` is true when a `-- allow-breaking: <reason>` sits on a
 * line of its own right before the statement (it covers the first statement
 * starting on the next line), or directly after the statement's end on the
 * same line (`DROP ...; -- allow-breaking: why`), or inside it. It never
 * covers a second statement.
 */
function statementsOf(sql) {
  const out = []
  let text = ''
  let curWaived = false
  let pending = false // a marker line seen, waiting for the statement on the next line
  let markerLine = false // the line being read is that marker line
  let justEnded = -1 // index of the statement that ended earlier on this line, with nothing since
  const flush = () => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t) {
      out.push({ text: t, waived: curWaived })
      justEnded = out.length - 1
    }
    text = ''
    curWaived = false
  }
  const add = (chunk) => {
    if (chunk.trim()) {
      if (!text.trim()) {
        curWaived = pending
        pending = false
      }
      justEnded = -1
    }
    text += chunk
  }
  const newline = () => {
    if (!markerLine) pending = false
    markerLine = false
    justEnded = -1
    text += '\n'
  }
  for (let i = 0; i < sql.length; ) {
    const rest = sql.slice(i)
    let m
    if (sql[i] === '\n') {
      newline()
      i++
    } else if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i)
      const comment = sql.slice(i, end < 0 ? sql.length : end)
      if (/^-->\s*statement-breakpoint/.test(comment)) flush()
      else if (MARKER.test(comment)) {
        if (text.trim()) curWaived = true
        else if (justEnded >= 0) out[justEnded].waived = true
        else {
          pending = true
          markerLine = true
        }
      }
      i += comment.length
    } else if (rest.startsWith('/*')) {
      // Block comments nest in Postgres.
      let depth = 0
      let j = i
      do {
        if (sql.startsWith('/*', j)) {
          depth++
          j += 2
        } else if (sql.startsWith('*/', j)) {
          depth--
          j += 2
        } else {
          if (sql[j] === '\n') newline()
          j++
        }
      } while (depth > 0 && j < sql.length)
      text += ' '
      i = j
    } else if ((m = /^\$([A-Za-z_]\w*)?\$/.exec(rest))) {
      const close = sql.indexOf(m[0], i + m[0].length)
      const stop = close < 0 ? sql.length : close + m[0].length
      add(' $$ $$ ')
      for (const ch of sql.slice(i, stop)) if (ch === '\n') newline()
      i = stop
    } else if (sql[i] === "'") {
      // E'...' lets a backslash escape the next character; a plain string only doubles its quotes.
      const escapes = /(^|[^\w])[eE]$/.test(text)
      let j = i + 1
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') j += 2
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j++
      }
      if (escapes) text = text.replace(/[eE]$/, '')
      add(" '' ")
      for (const ch of sql.slice(i, j + 1)) if (ch === '\n') newline()
      i = j + 1
    } else if (sql[i] === ';') {
      flush()
      i++
    } else {
      add(sql[i])
      i++
    }
  }
  flush()
  return out
}

// A table name as written: bare, quoted, or schema-qualified with either part quoted.
const IDENT = String.raw`(?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?`
/** `"restricted"."X"` and restricted.x are the same table; `public.` is implied. */
const normalise = (name) => name.replace(/"/g, '').replace(/\s+/g, '').toLowerCase().replace(/^public\./, '')

const VOLATILE_DEFAULT = /\bDEFAULT\b.*\b(gen_random_uuid|uuid_generate_v[14]|uuidv[47]|random|clock_timestamp|timeofday|nextval|setseed)\s*\(/i
// The type position only: a column that is merely named "serial" is fine.
const SERIAL_COLUMN = new RegExp(String.raw`\bADD COLUMN (?:IF NOT EXISTS )?${IDENT} (?:big|small)?serial\b`, 'i')
const REWRITES = /\bGENERATED (?:ALWAYS|BY DEFAULT) AS IDENTITY\b|\bGENERATED ALWAYS AS \(.*\) STORED\b/i

const WAIVER = 'if it is intended, waive it with "-- allow-breaking: <why this is safe>" on the line before'

/** `ALTER TABLE t a, b` as one piece per action: `ALTER TABLE t a`, `ALTER TABLE t b`. Other statements are one piece. */
function piecesOf(s) {
  const alter = new RegExp(`^(ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(${IDENT})) (.*)$`, 'i').exec(s)
  if (!alter) return [{ text: s }]
  const actions = []
  let depth = 0
  let from = 0
  const rest = alter[3]
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '(') depth++
    else if (rest[i] === ')') depth--
    else if (rest[i] === ',' && depth === 0) {
      actions.push(rest.slice(from, i))
      from = i + 1
    }
  }
  actions.push(rest.slice(from))
  return actions.map((a) => ({ text: `${alter[1]} ${a.trim()}`, table: normalise(alter[2]) }))
}

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
  for (const { text: whole, waived } of statements) {
    if (waived) continue
    for (const { text: s, table } of piecesOf(whole)) {
      const head = s.slice(0, 70)
      const fresh = table !== undefined && created.has(table)
      const index = new RegExp(`^CREATE (?:UNIQUE )?INDEX (CONCURRENTLY )?(?:IF NOT EXISTS )?(?:${IDENT} )?ON (?:ONLY )?(${IDENT})`, 'i').exec(s)
      if (index && !created.has(normalise(index[2]))) {
        const on = normalise(index[2])
        found.push(
          index[1]
            ? `CREATE INDEX CONCURRENTLY cannot run: migrations run in one transaction and Postgres refuses it there. A plain index blocks writes to ${on} while it builds; ${WAIVER}: ${head}`
            : `CREATE INDEX blocks writes to ${on} while it builds (CONCURRENTLY cannot be used inside the migration transaction); ${WAIVER}: ${head}`,
        )
      }
      const constraint = /\bADD (?:CONSTRAINT \S+ )?(UNIQUE|CHECK|FOREIGN KEY|PRIMARY KEY|EXCLUDE)\b/i.exec(s)
      if (table !== undefined && constraint && !fresh) {
        const kind = constraint[1].toUpperCase()
        const cheap = /\bUSING INDEX\b/i.test(s) || (/\bNOT VALID\b/i.test(s) && (kind === 'CHECK' || kind === 'FOREIGN KEY'))
        if (!cheap)
          found.push(
            kind === 'CHECK' || kind === 'FOREIGN KEY'
              ? `adding a ${kind} constraint scans ${table} under lock and the previous release may break it (add it NOT VALID, then VALIDATE CONSTRAINT in a later release): ${head}`
              : `adding a ${kind} constraint builds an index on ${table} under lock, and ${kind} cannot be NOT VALID; ${WAIVER}, with a plan (for instance a unique index built beforehand, outside this tool): ${head}`,
          )
      }
      if (
        /^DROP (TABLE|COLUMN|CONSTRAINT|TYPE|SCHEMA|TRIGGER|FUNCTION|VIEW|MATERIALIZED VIEW|SEQUENCE|EXTENSION)\b/i.test(s) ||
        /\bDROP COLUMN\b/i.test(s) ||
        /\bDROP CONSTRAINT\b/i.test(s)
      )
        found.push(`removes something the previous release may still use: ${head}`)
      if (/\bRENAME\b/i.test(s)) found.push(`renames something the previous release may still use: ${head}`)
      if (/\bALTER COLUMN\b.*\b(TYPE|SET DATA TYPE|SET NOT NULL|DROP NOT NULL)\b/i.test(s)) found.push(`changes a column the previous release writes to: ${head}`)
      if (/\bADD COLUMN\b/i.test(s)) {
        if (!fresh && (VOLATILE_DEFAULT.test(s) || SERIAL_COLUMN.test(s) || REWRITES.test(s)))
          found.push(`a volatile, serial, identity or stored-generated column rewrites the whole table under an exclusive lock: ${head}`)
        if (!fresh && /\b(UNIQUE|PRIMARY KEY)\b/i.test(s)) found.push(`a UNIQUE or PRIMARY KEY column builds an index under lock; ${WAIVER}: ${head}`)
        if (/\bNOT NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s) && !SERIAL_COLUMN.test(s) && !REWRITES.test(s))
          found.push(`NOT NULL column with no default fails the previous release's inserts: ${head}`)
      }
      if (/^TRUNCATE\b/i.test(s)) found.push(`TRUNCATE takes an exclusive lock and empties the table: ${head}`)
      if (/^(UPDATE|DELETE FROM)\b/i.test(s) || /^INSERT INTO\b.*\bSELECT\b/i.test(s) || /^WITH\b.*\b(UPDATE|DELETE FROM|INSERT INTO)\b/i.test(s))
        found.push(`backfill holds row locks until the migration ends: ${head}`)
      if (/^DO\b/i.test(s)) found.push(`a DO block can run anything and is not inspected: ${head}`)
    }
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
