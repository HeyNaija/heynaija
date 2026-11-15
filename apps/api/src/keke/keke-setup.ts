import { type Db, members, profileBadges } from '@heynaija/db'
import type { Logger } from '@nestjs/common'
import { and, eq, ne } from 'drizzle-orm'
import { KEKE_BIO, KEKE_FALLBACK_HANDLE, KEKE_HANDLE, KEKE_ID } from './keke-ids.js'

/**
 * Makes Keke's account and gives it the automated badge, if they are not there
 * yet: the same way as The Arbiter (docs/adr/0028), so every environment gets it
 * without a seed. Safe to run any number of times, and never changes anything a
 * person has: if someone already holds `keke`, Keke takes `keke_hn`.
 */
export async function ensureKeke(db: Db, logger?: Pick<Logger, 'warn'>): Promise<void> {
  const [existing] = await db.select({ id: members.id }).from(members).where(eq(members.id, KEKE_ID))
  if (!existing) {
    const [taken] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.handle, KEKE_HANDLE), ne(members.id, KEKE_ID)))
    if (taken) logger?.warn(`a member already has @${KEKE_HANDLE}; Keke is @${KEKE_FALLBACK_HANDLE}`)
    await db
      .insert(members)
      .values({
        id: KEKE_ID,
        handle: taken ? KEKE_FALLBACK_HANDLE : KEKE_HANDLE,
        displayName: 'Keke',
        bio: KEKE_BIO,
        onboardedAt: new Date(),
        emailNotifications: false,
      })
      .onConflictDoNothing()
  }
  await db.insert(profileBadges).values({ memberId: KEKE_ID, kind: 'automated' }).onConflictDoNothing()
  // An older Keke keeps its bio in step with what it now does.
  await db.update(members).set({ bio: KEKE_BIO }).where(eq(members.id, KEKE_ID))
}
