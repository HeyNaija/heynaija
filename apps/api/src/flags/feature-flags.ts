import { type Db, featureFlagChanges, featureFlagMembers, featureFlags, members } from '@heynaija/db'
import { Logger } from '@nestjs/common'
import { desc, eq, sql } from 'drizzle-orm'
import type { AppEnv } from '../env.js'
import { FLAGS, type FlagDefinition, type FlagKey, type FlagOverride, flagKeys, isFlagKey, resolveFlag } from './registry.js'

/** What the database holds, by registry key. Keys the registry does not know are not in it. */
export type Snapshot = Map<string, FlagOverride>

/**
 * How long one process reuses what it read. A change made by an admin through this
 * API process is seen by that process at once, and by every other instance within
 * this long (plus the time a read takes): that is the staleness bound.
 */
export const FLAG_CACHE_TTL_MS = 5_000

export type FlagChangeReason = 'unknown_flag' | 'unknown_handles' | 'conflict'

/** A change an admin asked for that cannot be made; the message is safe to show them. */
export class FlagChangeError extends Error {
  constructor(
    readonly reason: FlagChangeReason,
    message: string,
  ) {
    super(message)
  }
}

export type FlagChange = { enabled: boolean | null; handles?: string[] }

/** An override as shown to admins and recorded in the audit table. */
export type OverrideView = { enabled: boolean | null; handles: string[] }

export type FlagView = {
  key: FlagKey
  description: string
  owner: string
  defaults: FlagDefinition['defaults']
  /** The default for this deployment's environment. */
  default: boolean
  /** Null when there is nothing to follow but the default. */
  override: OverrideView | null
  updatedBy: string | null
  updatedAt: Date | null
}

export type ChangeView = { flagKey: string; actorHandle: string; before: OverrideView; after: OverrideView; createdAt: Date }

type Options = {
  ttlMs?: number
  now?: () => number
  /** Replaces the database read, for tests. */
  load?: () => Promise<Snapshot>
  /** Where a failed read is reported; the log by default. */
  onError?: (err: unknown) => void
  /** Replaces the registry, for tests that need a flag whose production default is off. */
  registry?: Record<FlagKey, FlagDefinition>
}

const log = new Logger('FeatureFlags')

/**
 * Feature flags: the registry's defaults for this environment, overridden by rows
 * an admin has written (docs/feature-flags.md).
 *
 * Reads come from an in-process snapshot refreshed at most every `ttlMs`, with one
 * read shared by concurrent callers. Fail closed: when the database cannot be read
 * the last good snapshot keeps answering, and if there never was one the
 * PRODUCTION defaults answer (never staging's), with no overrides, until a read works.
 */
export class FeatureFlags {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly loader: () => Promise<Snapshot>
  private readonly onError: (err: unknown) => void
  private readonly registry: Record<FlagKey, FlagDefinition>

  private snapshot: Snapshot | null = null
  private freshUntil = 0
  private inflight: Promise<void> | null = null
  /** Bumped by every write, so a read that began before it is not stored. */
  private generation = 0

  constructor(
    private readonly db: Db,
    private readonly appEnv: AppEnv,
    options: Options = {},
  ) {
    this.ttlMs = options.ttlMs ?? FLAG_CACHE_TTL_MS
    this.now = options.now ?? Date.now
    this.registry = options.registry ?? FLAGS
    this.loader = options.load ?? (() => this.readDatabase())
    this.onError = options.onError ?? ((err) => log.error(`could not read feature flags; using ${this.snapshot ? 'the last good values' : 'production defaults'}`, err instanceof Error ? err.stack : String(err)))
  }

  /** Whether a flag is on for the viewer (a member id), or for a signed-out visitor when there is none. */
  async isEnabled(key: FlagKey, viewerId?: string | null): Promise<boolean> {
    if (!isFlagKey(key)) return false
    const snapshot = await this.current()
    return snapshot ? resolveFlag(key, this.appEnv, snapshot.get(key), viewerId, this.registry) : resolveFlag(key, 'production', undefined, viewerId, this.registry)
  }

  /** Every flag for the viewer, keyed by registry key. */
  async all(viewerId?: string | null): Promise<Record<FlagKey, boolean>> {
    const snapshot = await this.current()
    const env: AppEnv = snapshot ? this.appEnv : 'production'
    return Object.fromEntries(flagKeys.map((key) => [key, resolveFlag(key, env, snapshot?.get(key), viewerId, this.registry)])) as Record<FlagKey, boolean>
  }

  /** Makes the next read go to the database. Called after every write. */
  invalidate(): void {
    this.generation++
    this.freshUntil = 0
    this.inflight = null
  }

  private async current(): Promise<Snapshot | null> {
    if (this.now() >= this.freshUntil) {
      if (!this.inflight) {
        const generation = this.generation
        const run: Promise<void> = this.refresh(generation).finally(() => {
          if (this.inflight === run) this.inflight = null
        })
        this.inflight = run
      }
      await this.inflight
    }
    return this.snapshot
  }

  private async refresh(generation: number): Promise<void> {
    try {
      const loaded = await this.loader()
      if (generation !== this.generation) return // a write happened meanwhile: read again next time
      this.snapshot = loaded
      this.freshUntil = this.now() + this.ttlMs
    } catch (err) {
      if (generation !== this.generation) return
      // Keep what we had, and do not retry on every call.
      this.freshUntil = this.now() + this.ttlMs
      this.onError(err)
    }
  }

  private async readDatabase(): Promise<Snapshot> {
    const [rows, allowed] = await Promise.all([this.db.select().from(featureFlags), this.db.select().from(featureFlagMembers)])
    const snapshot: Snapshot = new Map()
    for (const row of rows) {
      if (!isFlagKey(row.key)) continue
      snapshot.set(row.key, { enabled: row.enabled, allow: new Set(allowed.filter((a) => a.flagKey === row.key).map((a) => a.memberId)) })
    }
    return snapshot
  }

  // --- Admin ---

  /** Every flag with its default and override, and the latest changes. Read from the database, not the cache. */
  async describe(changeLimit = 30): Promise<{ env: AppEnv; flags: FlagView[]; changes: ChangeView[] }> {
    const rows = await this.db
      .select({ key: featureFlags.key, enabled: featureFlags.enabled, updatedAt: featureFlags.updatedAt, updatedBy: members.handle })
      .from(featureFlags)
      .leftJoin(members, eq(members.id, featureFlags.updatedBy))
    const listed = await this.db
      .select({ flagKey: featureFlagMembers.flagKey, handle: members.handle })
      .from(featureFlagMembers)
      .innerJoin(members, eq(members.id, featureFlagMembers.memberId))
      .orderBy(members.handle)
    const changes = await this.db.select().from(featureFlagChanges).orderBy(desc(featureFlagChanges.createdAt)).limit(changeLimit)

    const flags = flagKeys.map((key): FlagView => {
      const row = rows.find((r) => r.key === key)
      const handles = listed.filter((l) => l.flagKey === key).map((l) => l.handle)
      const set = row && (row.enabled !== null || handles.length > 0)
      return {
        key,
        description: this.registry[key].description,
        owner: this.registry[key].owner,
        defaults: this.registry[key].defaults,
        default: this.registry[key].defaults[this.appEnv],
        override: set ? { enabled: row.enabled, handles } : null,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ?? null,
      }
    })
    return {
      env: this.appEnv,
      flags,
      changes: changes.map((c) => ({
        flagKey: c.flagKey,
        actorHandle: c.actorHandle,
        before: c.before as OverrideView,
        after: c.after as OverrideView,
        createdAt: c.createdAt,
      })),
    }
  }

  /**
   * Sets a flag's override: `enabled` true or false for everyone, or null with a
   * list of handles for those members only, or null with none to follow the
   * default again. Audited in the same transaction. The caller has already
   * checked that `actorId` may do this.
   */
  async set(actorId: string, key: string, change: FlagChange): Promise<void> {
    if (!isFlagKey(key)) throw new FlagChangeError('unknown_flag', `no feature flag called ${key}`)
    const wanted = [...new Set((change.handles ?? []).map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))]
    if (change.enabled !== null && wanted.length > 0) {
      throw new FlagChangeError('conflict', 'turn a flag on or off for everyone, or list the members it is on for, not both')
    }

    await this.db.transaction(async (tx) => {
      const ids: { id: string; handle: string }[] = []
      const missing: string[] = []
      for (const handle of wanted) {
        const [found] = await tx
          .select({ id: members.id, handle: members.handle })
          .from(members)
          .where(eq(sql`lower(${members.handle})`, handle))
          .orderBy(sql`${members.lastSeenAt} desc nulls last`)
          .limit(1)
        if (found) ids.push(found)
        else missing.push(handle)
      }
      if (missing.length > 0) throw new FlagChangeError('unknown_handles', `no member called ${missing.map((h) => `@${h}`).join(', ')}`)

      const [actor] = await tx.select({ handle: members.handle }).from(members).where(eq(members.id, actorId))
      // Serialises two admins changing the same flag, so each audit row's "before" is the other's "after".
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`feature_flag:${key}`}))`)
      const before = await this.override(tx, key)

      await tx
        .insert(featureFlags)
        .values({ key, enabled: change.enabled, updatedBy: actorId })
        .onConflictDoUpdate({ target: featureFlags.key, set: { enabled: change.enabled, updatedBy: actorId, updatedAt: sql`now()` } })
      await tx.delete(featureFlagMembers).where(eq(featureFlagMembers.flagKey, key))
      if (ids.length > 0) await tx.insert(featureFlagMembers).values(ids.map((m) => ({ flagKey: key, memberId: m.id })))

      const after: OverrideView = { enabled: change.enabled, handles: ids.map((m) => m.handle).sort() }
      await tx.insert(featureFlagChanges).values({ flagKey: key, actorId, actorHandle: actor?.handle ?? 'unknown', before, after })
    })
    this.invalidate()
  }

  private async override(tx: Pick<Db, 'select'>, key: string): Promise<OverrideView> {
    const [row] = await tx.select({ enabled: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, key))
    const listed = await tx
      .select({ handle: members.handle })
      .from(featureFlagMembers)
      .innerJoin(members, eq(members.id, featureFlagMembers.memberId))
      .where(eq(featureFlagMembers.flagKey, key))
    return { enabled: row?.enabled ?? null, handles: listed.map((l) => l.handle).sort() }
  }
}
