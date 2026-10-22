// Post-deployment stage 5 identity migration.
//
// Safe preview:
//   pnpm identity:backfill
// Schema-migration preflight (used by deployment before db:migrate):
//   node dist/cli/identity-migrate.js --preflight
// Apply the post-deployment backfill (the deployment already applies the
// committed schema migration):
//   pnpm identity:backfill -- --apply --backup-ref <backup-id> --confirm APPLY_IDENTITY_MIGRATION
// Verify:
//   pnpm identity:backfill -- --verify
// Mark the irreversible application cutover:
//   pnpm identity:backfill -- --cutover <run-id> --confirm MARK_IDENTITY_CUTOVER
// Roll back only mappings created by one completed run:
//   pnpm identity:backfill -- --rollback <run-id> --confirm ROLLBACK_IDENTITY_MIGRATION
//
// This command never rewrites existing member IDs or social foreign keys. The
// schema migration is applied by the deployment's migrate service; the data
// backfill is the only application-level mutation performed here.
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { and, asc, eq } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import {
  createDb,
  identityMigrationRows,
  identityMigrationRuns,
  members,
  providerIdentities,
  schema,
} from '@heynaija/db'

const PROVIDER = 'kratos'
const APPLY_CONFIRMATION = 'APPLY_IDENTITY_MIGRATION'
const ROLLBACK_CONFIRMATION = 'ROLLBACK_IDENTITY_MIGRATION'
const CUTOVER_CONFIRMATION = 'MARK_IDENTITY_CUTOVER'
const LOCK_KEY = 2026101901

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    preflight: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    rollback: { type: 'string' },
    cutover: { type: 'string' },
    confirm: { type: 'string' },
    'backup-ref': { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
  },
})

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')

const operationCount = Number(Boolean(values.apply)) + Number(Boolean(values.preflight)) + Number(Boolean(values.verify)) + Number(Boolean(values.rollback)) + Number(Boolean(values.cutover))
if (operationCount > 1) refuse('choose only one of --preflight, --apply, --verify, --cutover or --rollback')
if (values.rollback && !/^[0-9a-f-]{36}$/i.test(values.rollback)) refuse('--rollback must be a UUID')
if (values.cutover && !/^[0-9a-f-]{36}$/i.test(values.cutover)) refuse('--cutover must be a UUID')
if (values.apply && values.confirm !== APPLY_CONFIRMATION) refuse(`--apply requires --confirm ${APPLY_CONFIRMATION}`)
if (values.apply && !values['backup-ref']) refuse('--apply requires --backup-ref pointing to a completed database backup')
if (values.preflight && (values.confirm || values['backup-ref'])) refuse('--preflight does not accept confirmation or backup arguments')
if (values.rollback && values.confirm !== ROLLBACK_CONFIRMATION) refuse(`--rollback requires --confirm ${ROLLBACK_CONFIRMATION}`)
if (values.cutover && values.confirm !== CUTOVER_CONFIRMATION) refuse(`--cutover requires --confirm ${CUTOVER_CONFIRMATION}`)
if (values.verify && values.confirm) refuse('--verify does not accept --confirm')

const parsedUrl = new URL(databaseUrl)
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname)
if (!loopback && !values['allow-remote']) {
  refuse(`refusing non-loopback database ${parsedUrl.hostname}; pass --allow-remote only after confirming the target and backup`)
}

const { pool } = createDb(databaseUrl, { max: 2 })
type MigrationDb = NodePgDatabase<typeof schema>

function refuse(message: string): never {
  throw new Error(`identity migration refused: ${message}`)
}

async function withLock<T>(work: (db: MigrationDb) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY])
    return await work(drizzle(client, { schema }) as unknown as MigrationDb)
  } finally {
    try { await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]) } finally { client.release() }
  }
}

async function duplicateHandles(): Promise<{ handle: string; count: number }[]> {
  const table = await pool.query<{ exists: boolean }>(
    "select to_regclass('public.members') is not null as exists",
  )
  if (!table.rows[0]?.exists) return []
  const result = await pool.query<{ handle: string; count: string }>(
    'select handle, count(*)::text as count from members group by handle having count(*) > 1 order by handle',
  )
  return result.rows.map((row) => ({ handle: row.handle, count: Number(row.count) }))
}

async function inspect(db: MigrationDb) {
  const existingMembers = await db.select({ id: members.id }).from(members).orderBy(asc(members.id))
  const mappings = await db.select({
    providerId: providerIdentities.providerId,
    subject: providerIdentities.subject,
    memberId: providerIdentities.memberId,
  }).from(providerIdentities).where(eq(providerIdentities.providerId, PROVIDER))
  const bySubject = new Map(mappings.map((mapping) => [mapping.subject, mapping]))
  const missing = existingMembers.filter((member) => !bySubject.has(member.id))
  const conflicts = existingMembers.filter((member) => {
    const mapping = bySubject.get(member.id)
    return mapping !== undefined && mapping.memberId !== member.id
  })
  const memberIds = new Set(existingMembers.map((member) => member.id))
  const foreign = mappings.filter((mapping) => !memberIds.has(mapping.memberId))
  return { existingMembers, mappings, bySubject, missing, conflicts, foreign }
}

async function verify(db: MigrationDb): Promise<void> {
  const duplicates = await duplicateHandles()
  const result = await inspect(db)
  const report = {
    provider: PROVIDER,
    members: result.existingMembers.length,
    mappings: result.mappings.length,
    missing: result.missing.length,
    conflicts: result.conflicts.length,
    mappingsForMissingMembers: result.foreign.length,
    duplicateHandles: duplicates,
    ok: result.missing.length === 0 && result.conflicts.length === 0 && result.foreign.length === 0 && duplicates.length === 0,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

async function preview(db: MigrationDb): Promise<void> {
  const duplicates = await duplicateHandles()
  const result = await inspect(db)
  if (result.conflicts.length || result.foreign.length) refuse('existing provider mappings are inconsistent; no changes were made')
  console.log(JSON.stringify({
    mode: 'dry-run',
    provider: PROVIDER,
    members: result.existingMembers.length,
    alreadyMapped: result.existingMembers.length - result.missing.length,
    wouldInsert: result.missing.length,
    duplicateHandles: duplicates,
    note: 'No rows were written. --apply requires a backup reference and explicit confirmation.',
  }, null, 2))
}

async function apply(db: MigrationDb, backupRef: string): Promise<void> {
  const duplicates = await duplicateHandles()
  if (duplicates.length) refuse(`duplicate current handles must be resolved first: ${duplicates.map((row) => `@${row.handle}`).join(', ')}`)
  const before = await inspect(db)
  if (before.conflicts.length || before.foreign.length) refuse('existing provider mappings are inconsistent; no changes were made')

  const runId = randomUUID()
  const startedAt = new Date()
  let inserted = 0
  await db.transaction(async (tx) => {
    await tx.insert(identityMigrationRuns).values({
      id: runId,
      providerId: PROVIDER,
      status: 'completed',
      backupRef,
      startedAt,
    })
    for (const member of before.existingMembers) {
      if (before.bySubject.has(member.id)) continue
      const created = await tx.insert(providerIdentities).values({
        providerId: PROVIDER,
        subject: member.id,
        memberId: member.id,
        createdAt: startedAt,
      }).onConflictDoNothing().returning({ subject: providerIdentities.subject })
      if (created.length === 0) {
        // The unique provider/subject key serializes a concurrent runtime
        // insert. A same-owner row is not this run's provenance; a different
        // owner is a hard conflict and rolls back the whole backfill.
        const [existing] = await tx.select({ memberId: providerIdentities.memberId })
          .from(providerIdentities)
          .where(and(
            eq(providerIdentities.providerId, PROVIDER),
            eq(providerIdentities.subject, member.id),
          ))
        if (!existing || existing.memberId !== member.id) {
          refuse(`provider subject ${member.id} maps to a different member; refusing backfill`)
        }
        continue
      }
      await tx.insert(identityMigrationRows).values({
        runId,
        providerId: PROVIDER,
        subject: member.id,
        memberId: member.id,
        createdAt: startedAt,
      })
      inserted++
    }
    await tx.update(identityMigrationRuns)
      .set({ insertedCount: inserted, completedAt: new Date() })
      .where(eq(identityMigrationRuns.id, runId))
  })
  console.log(JSON.stringify({ mode: 'apply', provider: PROVIDER, runId, inserted, backupRef }, null, 2))
}

async function rollback(db: MigrationDb, runId: string): Promise<void> {
  const [run] = await db.select().from(identityMigrationRuns).where(eq(identityMigrationRuns.id, runId))
  if (!run) refuse(`migration run ${runId} was not found`)
  if (run.status !== 'completed') refuse(`migration run ${runId} is already rolled back`)
  if (run.providerId !== PROVIDER) refuse(`migration run ${runId} belongs to provider ${run.providerId}`)
  if (run.cutoverAt) refuse(`migration run ${runId} has crossed application cutover; restore or forward-fix instead of deleting mappings`)
  const rows = await db.select().from(identityMigrationRows).where(eq(identityMigrationRows.runId, runId))
  const current = await db.select({
    providerId: providerIdentities.providerId,
    subject: providerIdentities.subject,
    memberId: providerIdentities.memberId,
  }).from(providerIdentities).where(eq(providerIdentities.providerId, PROVIDER))
  const bySubject = new Map(current.map((mapping) => [mapping.subject, mapping]))
  const changed = rows.filter((row) => bySubject.get(row.subject)?.memberId !== row.memberId)
  if (changed.length) refuse(`${changed.length} recorded mappings no longer match; refusing rollback`)

  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.delete(providerIdentities).where(and(
        eq(providerIdentities.providerId, row.providerId),
        eq(providerIdentities.subject, row.subject),
        eq(providerIdentities.memberId, row.memberId),
      ))
    }
    await tx.update(identityMigrationRuns)
      .set({ status: 'rolled_back', rolledBackAt: new Date() })
      .where(eq(identityMigrationRuns.id, runId))
  })
  console.log(JSON.stringify({ mode: 'rollback', provider: run.providerId, runId, removed: rows.length }, null, 2))
}

async function markCutover(db: MigrationDb, runId: string): Promise<void> {
  const [run] = await db.select().from(identityMigrationRuns).where(eq(identityMigrationRuns.id, runId))
  if (!run) refuse(`migration run ${runId} was not found`)
  if (run.status !== 'completed') refuse(`migration run ${runId} is not completed`)
  if (run.cutoverAt) refuse(`migration run ${runId} is already marked as cut over`)
  const result = await inspect(db)
  if (result.missing.length || result.conflicts.length || result.foreign.length) {
    refuse('cannot mark cutover while provider mappings are incomplete or inconsistent')
  }
  await db.update(identityMigrationRuns).set({ cutoverAt: new Date() }).where(eq(identityMigrationRuns.id, runId))
  console.log(JSON.stringify({ mode: 'cutover', provider: run.providerId, runId }, null, 2))
}

try {
  if (values.preflight) {
    const duplicates = await duplicateHandles()
    if (duplicates.length) refuse(`duplicate current handles must be resolved before schema migration: ${duplicates.map((row) => `@${row.handle}`).join(', ')}`)
    console.log(JSON.stringify({ mode: 'preflight', duplicateHandles: [], ok: true }, null, 2))
  } else {
    if (values.apply) {
    // The generated migration adds the unique current-handle index. Check the
    // live data before deployment so a conflict stops before schema changes.
      const duplicates = await duplicateHandles()
      if (duplicates.length) refuse(`duplicate current handles must be resolved first: ${duplicates.map((row) => `@${row.handle}`).join(', ')}`)
    }
    await withLock(async (db) => {
      if (values.verify) await verify(db)
      else if (values.cutover) await markCutover(db, values.cutover)
      else if (values.rollback) await rollback(db, values.rollback)
      else if (values.apply) await apply(db, values['backup-ref']!)
      else await preview(db)
    })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await pool.end()
}
